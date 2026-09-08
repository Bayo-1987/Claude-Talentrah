# Applying migrations to production — a proposal

**Status: proposal. Nothing here is built. Nothing was applied to production
while writing it.** Pick an option, then it gets built.

Written 2026-09-08, after the day's two incidents. Every factual claim below
was checked against live state rather than inferred; where a claim is an
inference, it says so.

---

## 1. There were TWO failures, and conflating them picks the wrong fix

The brief describes this as a concurrency problem. Concurrency is the *smaller*
half. Separating them changes the recommendation.

### Failure A — the outages. An ORDERING problem.

`#286` and `#287` each merged, Vercel deployed the new code, and the migrations
that code depends on were applied **afterwards, by hand**. In the window
between, production ran code referencing columns that did not exist:

| PR | window | what broke |
|---|---|---|
| `#286` | merge → manual apply | CAC submit action + admin CAC-review queue, `42501`/`42703` |
| `#287` | merge → manual apply | employer **Jobs Posted** page (`src/app/employer/jobs/page.tsx:31`) 500ing, `42703` |

Verified, not assumed: `select … admin_review_requested_at … from job_postings`
returned `42703: column "admin_review_requested_at" does not exist` against
production at the time.

**No amount of mutual exclusion between appliers prevents this.** One applier,
perfectly serialized, still leaves the same window. This is the failure that
reached users.

### Failure B — the duplicate row. A concurrency problem, and a mild one.

Two sessions applied `0118`/`0119` minutes apart. What actually happened:

- Session A applied `0118` (12:23:51) and `0119` (12:25:14). Both succeeded.
- Session B's `0119` failed with `42701: column already exists` — **Postgres
  serialized the DDL correctly and refused the second one.** No corruption, no
  partial apply; B's failed apply recorded no ledger row at all.
- Session B's `0118` was `alter type … add value if not exists`, genuinely
  idempotent, so it succeeded as a no-op — and inserted a **second ledger row**
  named `0118_job_review_permission`.

So the database was never at risk. The damage was one cosmetic duplicate row
and a confusing failure. Worth fixing; not worth much.

It is also worth being precise that the duplicate had **no functional effect**:
`scripts/migration-drift-compare.ts` loads applied names into a `Set`, so a
duplicate name collapses. Drift detection was never wrong.

---

## 2. What already exists (so this complements rather than duplicates)

| stage | mechanism | verdict |
|---|---|---|
| PR-time number collision | `ci.yml`'s `migration-collisions` job + `scripts/check-migration-collisions.ts` (`#294`) | works |
| merge-time staleness | branch protection, `strict: true` | works |
| post-merge drift | `.github/workflows/migration-drift.yml` (`#223`) — `push` to main, `06:23 UTC` schedule, **and `workflow_dispatch`** | works; detects after the fact |

The drift check is what caught both of today's incidents. It is not broken and
should not be replaced — the gap is that detection happens after the deploy.

**Two properties of it matter to what follows:**

1. **It is one-directional.** `check-migration-drift.ts` reports migrations
   committed on main but absent from production. Production being *ahead* of
   main is invisible to it. That is convenient for option (c′) below and is a
   real blind spot regardless.
2. **It reaches production with no service-role key.** `0096` defines
   `list_applied_migrations()` — `security definer`, granted only to `anon`,
   gated on a JWT `purpose` claim of `migration-status-reader`. GitHub holds a
   scoped JWT, not an admin credential. **This is the pattern any future
   production automation should copy.**

---

## 3. Verified facts that constrain the options

Checked live against `nytwbbzfpytctjsoczzq`, read-only:

**The ledger's primary key is `version`, not `name`.**
`PRIMARY KEY (version)` — which is exactly why two rows named
`0118_job_review_permission` could coexist under versions `20260908122351` and
`20260908122607`. Each applier mints its own timestamp version.

**There is already a `UNIQUE (idempotency_key)` constraint — and it is dead.**
All 126 rows have `idempotency_key IS NULL`, and Postgres permits unlimited
NULLs in a unique index, so it constrains nothing. The column and constraint are
Supabase-provided and currently unused. The MCP connector's `apply_migration`
exposes only `project_id`, `name`, `query` — it has no way to set it.

**A session-scoped advisory lock cannot span connector calls.** Two consecutive
`execute_sql` calls reported backend PIDs `1574392` and `1574393` —
`application_name = mgmt-api`, a different backend each time. So
`pg_advisory_lock()` taken in a "claim" call is released the moment that call
returns, before any apply happens. **This defeats option (a) as literally
described**; any claim mechanism has to be a row with a TTL, not a lock.

**The ledger cannot tell two appliers apart.** `created_by` is populated on all
126 rows, but with a single value — the Supabase *account* that owns the MCP
connector token, identical for every row ever written. It records which account
applied, never which session or which person. So there is no existing
attribution to build coordination on, and no way to look at the ledger after the
fact and say which of two concurrent sessions wrote a row.

**CI no longer uses the hosted CI project for test runs.** Stage 2 (`#214`)
replaced it with an ephemeral per-job local stack
(`.github/actions/local-supabase`, `supabase start` + `db reset`). `ci.yml`
references no Supabase project secrets at all. The hosted project
`dozaffzgqkbarxtlclsj` still exists and is still kept current by convention,
but CI does not read it. Any proposal that assumes "CI exercises the hosted
project" is working from stale information.

**Incidental finding, security-relevant, not part of this proposal.** The repo
holds Actions secrets `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`
and `SUPABASE_JWT_SECRET`, and **no workflow references any of them** — every
match in `.github/` is a local-stack variable written at runtime from
`supabase status`, not `secrets.*`. They are leftovers from the pre-Stage-2
hosted-CI setup. I cannot read their values, so **which project that
service-role key belongs to is unknown and worth checking**; if it is
production's, it is precisely the hazard `CLAUDE.md` describes about the
deleted `.env`, relocated to GitHub. Recommend auditing and deleting them
independently of whatever is chosen here.

**Branch protection is thinner than it looks.** `required_status_checks` is
`["Migration numbering"]` only — typecheck, lint, unit tests and Playwright are
**not** required. `required_reviews` is `null` and `enforce_admins` is `false`.
Relevant because several options below assume a merge gate that does not
currently exist.

---

## 4. The options

### (a) Claim row / advisory lock

Prevents Failure B. Does nothing for Failure A.

As literally specified — an advisory lock — **it does not work**, per the
backend-PID evidence above. The workable form is a claim *row* with a TTL, e.g.
`public.migration_apply_claim(claimed_by, claimed_at, expires_at)`, taken via a
`security definer` function on the `0096` pattern, released explicitly.

Honest costs: a stale claim (a session that dies mid-apply, or an agent that
forgets to release) **blocks the next legitimate applier** — during an incident,
which is exactly when applies are urgent. TTLs trade that for a window where the
lock is meaningless. This adds a failure mode to buy protection against a
problem that Postgres already handled correctly on its own.

**Not recommended.** It is real engineering aimed at the half of the problem
that did no damage.

### (b) Auto-apply on merge

Would substantially address Failure A, and is the only option that removes human
timing from the loop entirely.

Against it, seriously:

- It needs a **production DDL credential in GitHub Actions**. `CLAUDE.md` keeps
  production credentials off disk deliberately and prefers the MCP connector for
  exactly this reason. This inverts that posture, and a public repo makes the
  blast radius of a workflow-injection bug total.
- **It does not actually close the window on its own.** The merge triggers the
  Vercel deploy and the apply workflow concurrently; a fast deploy still beats a
  workflow that has to `npm ci` first. Closing it properly means gating the
  deploy on the apply, i.e. taking over Vercel's git integration — a much larger
  change than it sounds.
- A migration that fails halfway through an automated run, unattended, on
  production, is a worse morning than any problem being solved here.

**Not recommended now.** Reconsider if apply volume rises enough that the manual
step becomes the bottleneck.

### (c) Documented convention + louder/faster drift alarm

Cheap, no new credential, no new failure mode. But as described it only shortens
the window — it accepts that production will sometimes serve 500s and tries to
notice sooner. Adding a `deployment_status` trigger to `migration-drift.yml` is
genuinely useful and roughly free.

### (c′) **The same, but inverted: apply BEFORE merge** ← recommended

Rather than shortening the window, remove it. **Apply the migration once the PR
is green and approved, then merge.** Production is then never behind the code —
at worst it is briefly ahead, which is harmless for additive DDL because nothing
reads the new columns until the deploy lands.

This is not hypothetical: `0121` was done this way earlier today (CI first,
verified, then production, then the PR opened), and it produced no window.

**The load-bearing caveat, and it must be written into the convention:** this is
safe for *additive* migrations only — new columns, new tables, new enum values,
widened policies. A **destructive** migration (dropping a column, narrowing a
policy, tightening a constraint) breaks the currently-deployed code the instant
it applies, so it must go the other way: deploy first, apply after. The repo
already has destructive migrations (`drop_admin_mfa_0071`), so this is a live
distinction, not a theoretical one. That is the standard expand/contract split,
and the convention should name it explicitly rather than leave it to judgment.

Residual gap: a migration applied for a PR that is then abandoned leaves
production ahead of main, and the one-directional drift check cannot see it.
Cheap to fix by teaching the drift script to report the reverse direction as a
warning.

### (d) Make the ledger duplicate-proof

`create unique index … on supabase_migrations.schema_migrations (name)`.

Would have turned Session B's silent duplicate insert into a clean `23505`.
Genuinely cheap and genuinely useful as a *backstop*.

Assessed carefully, as asked:
- It cannot break `supabase db push`/`db reset` on the local stack, because the
  `migration-collisions` guard already guarantees names are unique in the repo.
  A duplicate name in `supabase/migrations/` is already a hard CI failure.
- It **is** a constraint on a Supabase-managed schema, so a future platform
  change could drop or conflict with it. That is a real if low risk, and argues
  for treating it as a convenience, not a guarantee.
- It only prevents re-applying the *same name*. It does nothing about two
  different migrations racing, and nothing about Failure A.

**Recommended as a small independent add-on**, not as the answer.

---

## 5. Recommendation

**Adopt (c′): apply-before-merge, with the additive/destructive split written
down.** Optionally add (d) as a two-line backstop.

Reasoning:

1. It is the only option that closes **Failure A**, the one that actually
   reached users, and it closes it completely rather than shortening it.
2. It needs **no new credential, no new automation, no new failure mode** — it
   is a reordering of steps the project already performs.
3. It preserves the MCP-connector posture `CLAUDE.md` argues for, rather than
   inverting it as (b) would.
4. **Failure B does not need solving.** Postgres already refused the duplicate
   DDL correctly; the only residue was a cosmetic row, which (d) prevents for
   the price of one index.

The honest weakness: a convention is only as good as its adherence, and this
project runs several concurrent sessions plus a founder merging directly. That
is why (d) is worth taking alongside it and why the drift check should keep its
teeth — the convention is the fix, the drift check remains the net.

---

## 6. What it would cost

| item | change | effort |
|---|---|---|
| (c′) convention | `supabase/migrations/README.md` "Working rule" + a `CLAUDE.md` line; state the additive/destructive split and that destructive migrations invert the order | ~1h, docs only |
| (c′) blind spot | teach `check-migration-drift.ts` to also report applied-but-not-on-main as a **warning**, not a failure | ~1h + tests |
| (c) alarm | add `deployment_status` to `migration-drift.yml`'s triggers | ~15m |
| (d) backstop | one unique index on production's ledger, in a migration, with a guard proving it rejects a duplicate before it is trusted | ~1h |
| **total** | | **~3h** |

Compare: (a) is roughly a day once TTL semantics, release-on-failure and the
stale-claim escape hatch are done properly; (b) is multiple days and a standing
security decision.

## 7. Not done, deliberately

Nothing was applied to production. The unique index in (d) is described, not
created. No convention has been written into `README.md` or `CLAUDE.md` yet —
that is the first build step once an option is chosen.
