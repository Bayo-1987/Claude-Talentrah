# Talentrah — Handoff Status

Single-file record of what has shipped and how it was verified. Kept current
after every merge, so state is reconstructable from this file alone.

> **This file was created on 2026-08-25 16:00 UTC.** The priority backlog that
> asked for it to be "updated the same way it's been maintained so far"
> referred to a file that did not exist in this repo or anywhere under
> `~/Desktop`, `~/Documents` or `~/Downloads`. Neither did any of the other
> documents that backlog cites — see [Missing input documents](#missing-input-documents).
> Everything below is therefore reconstructed from the git history, the live
> Supabase project and live production probes, not copied forward from a
> previous version.

---

## Verification standard

This project has been burned by reported-but-untrue merge claims. The standard
now is: **a merge is not confirmed until it has been checked by a method a
second party could reproduce, against live state.** For every merge recorded
below that means all four of:

1. `GET /repos/:owner/:repo/pulls/:n` reporting `merged: true` with a
   `merged_at` and `merge_commit_sha`.
2. A **fresh shallow clone** of `main` — not the local working copy, which can
   be stale or dirty — with the expected files asserted present.
3. Where the change is observable from outside, a **live production probe**.
4. The full test suite run against merged `main`.

Un-pinned `raw.githubusercontent.com` fetches and cached GitHub web pages have
both served stale content in this project's history. Don't rely on either.

---

## Merged 2026-08-26 — PR #48, employer ad wallet (0046)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#48](https://github.com/Bayo-1987/Claude-Talentrah/pull/48) | `feat/employer-billing-wallet` | 10:18:12 | `ce0df13` |

**First Phase 2 roadmap work after the defect sweep, and the first genuinely new
financial model in the codebase.** Design brief:
[docs/employer-billing-plan.md](docs/employer-billing-plan.md) — written and
reviewed *before* any code, deliberately.

### The race was reproduced before the schema existed

`spend_credits_atomic` (0035) exists because a read-then-write decrement looked
correct for months. The wallet is the same shape with bigger numbers, so the
naive JS implementation was built first and run against a throwaway wallet:

```
wallet ₦5000, two concurrent debits of ₦5000
  debits that SUCCEEDED: 2 of 2
  charged for: ₦10000   actually taken: ₦5000
  => RACE: ₦5000 served free
```

`debit_ad_wallet` does the affordability check and the decrement in **one
conditional UPDATE**. Swapping a naive body back in fails four tests — both
debits succeed at `balance == cost`, **10 of 10** get through a balance
affording 3, and a decrement is lost (19,000 where 16,000 is correct).

Worth recording: the *in-database* naive version needed a `pg_sleep` to race,
while the JS version raced immediately. The realistic failure mode is someone
writing the debit in TypeScript — which is exactly what 0035 was.

### Two deviations from the plan doc, both deliberate and documented

* **Whole naira, not kobo.** The brief proposed `balance_kobo bigint` for
  precision. `payment_transactions.amount` is `integer` in whole naira and so is
  `passes.price_ngn`; a second money unit alongside an existing one is a classic
  factor-of-100 bug generator. There is no sub-naira concept in the product.
* **The 20% low-balance threshold is a PLACEHOLDER.** The mechanism
  (percentage-of-last-top-up) is decided; the number is not. It originated as
  example text in the multiple-choice question used to pick the mechanism, was
  briefly attributed to the plan doc, then to the founder. **Neither was right —
  nobody has deliberated on 20%.** Recorded as provisional in both §7.3 and the
  migration, with the concrete risk stated: if a campaign costs a meaningful
  fraction of a typical top-up, 20% remaining may be less than one campaign, and
  a warning that arrives after the employer can no longer afford anything is not
  a warning.

### Two gaps found in this work's own tests

* **No cross-org read test.** The suite covered the write lockdown thoroughly
  and never asked who could *look*. `ad_wallets` is readable through an
  `is_org_member` policy, and a subtly wrong one leaks how much every competitor
  spends on ads. Proven by loosening the policy to `using (true)`: the outsider
  read `balance_ngn: 42000`. Includes a positive control so it cannot pass by
  denying everyone.
* The attribution drift on the threshold, above.

### Verified

1. **PR API** — `merged: true`, `merge_commit_sha ce0df13e11379e558d27a758bbc7955112a10f31`.
2. **Fresh shallow clone of `main`** — merge commit `ce0df13`, two parents
   (`2d5f4bd` + `5a0712a`). Migration, tests and plan doc present; the atomic
   `set balance_ngn = w.balance_ngn - p_amount_ngn` confirmed at
   `0046_ad_wallets.sql:158`; the PLACEHOLDER correction present in both the
   migration (2 places) and the plan doc.
3. **Live** — `ad_wallets` and `ad_wallet_ledger` both RLS-enabled, **2 policies
   and both are SELECT**, zero write policies, no table-wide UPDATE for
   `authenticated`, both RPCs present. 0 live wallets (nothing funded yet).
4. **CI** — 30/30 files, **368/368 tests**, Playwright 13/13; all four checks
   green.

### Open on this, for the record

* `admin` can spend the organisation's money (§7.4's accepted trade). Narrowing
  later is easy — the RPC already takes the actor.
* Credit-only refunds (§7.1) mean over-funding has **no remedy**, which makes
  the low-balance warning and pause-at-zero load-bearing rather than polish.
* Multi-rail is scoped for but not wired: v1 is Paystack NGN only. Diaspora
  billing stays blocked on §10's legal review.

---

## Merged 2026-08-26 — PR #47, empty fetch no longer wipes a source

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#47](https://github.com/Bayo-1987/Claude-Talentrah/pull/47) | `fix/empty-fetch-mass-close` | 09:29:25 | `23755c0` |

**Closes the one item the sweep's own write-up had flagged as STILL OPEN.** The
backlog is now genuinely clear — that line was written honestly a few hours
earlier rather than rounded into "done", and this is what closes it.

The freshness sweep closes "anything I did not just see", which means
*everything* when the fetch returned nothing. A board answering 200 with an
empty array — a deploy, a rate limit answered politely, a markup change —
closed every posting for that source. The next run reopens them, so the damage
is a window rather than permanent, but during it the feed is missing real jobs
and nothing said so.

Reproduced before fixing:

```
× THE BUG: zero jobs returned closes every open posting for the source
  AssertionError: FEED WIPED: expected [ 'closed', 'closed' ] to deeply equal
  [ 'open', 'open' ]
```

### The two design calls, written down

**The rule is "any", not a threshold.** Deliberately not "…but MANY open
postings exist". The two cases a threshold would separate — a source that
genuinely emptied and one that glitched — are not distinguishable from here:
both return zero, and the only difference is what we already hold. Withholding
closure when we hold one posting costs one stale listing until the next run; a
threshold to close it faster buys nothing and adds a number nobody can justify.
A source that is *supposed* to be empty has nothing open, takes the
`openBefore === 0` branch, and is a silent no-op rather than a warning.

**Silent skipping is not enough**, because `closed: 0` is also what a healthy
run looks like. `IngestSourceResult.closureSkipped`, a `console.warn` naming the
source and the count it protected, and a `⚠` line in seed output. The warning
says a *repeat* across runs means the source itself needs looking at — one skip
is routine, a persistent one is a broken source.

### A gap found in the work's own tests

The guard covers both closure paths — greenhouse/lever scoped by company,
schema-org scoped by source — but the first round of tests only exercised
schema-org. Testing one branch and assuming the other is the same assumption
this repo keeps getting caught by, so the company-scoped case was added and
proven to fail with the guard disabled. `tests/jobs/` 24/24 across 6 files.

### Stale references removed

`ingest.ts`'s comment pointed at `test-scenarios-job-feed-matching-prompt.md`,
which is not in this repo — a fair part of why the bug sat unfixed for months.
That and the two other comments pointing at missing brief files now reference
the code that demonstrates the behaviour instead. **No comment in `src/`,
`scripts/` or `docs/` points at a file that does not exist.**

### Verified

1. **PR API** — `merged: true`, `merge_commit_sha 23755c0e5ecf2855ea6cd333e10266e5fa337982`.
2. **Fresh shallow clone of `main`** — merge commit `23755c0`, two parents
   (`922615d` + `8a66bc4`). Guard confirmed in the merged `ingest.ts`
   (`closureSkipped`, the `openBefore` count, the skip warning); both test files
   present; no remaining `test-scenarios-` references.
3. **Live** — the feed the guard protects is intact: greenhouse 126 open / 11
   closed, `schema-org:workable-nigeria` 20 open / 0 closed. No schema change in
   this PR, so the live check is the data it defends.
4. **CI** — 29/29 files, **355/355 tests**, Playwright 13/13; all four checks
   green.

---

## The 2026-08-26 sweep — what it was actually about

Four items closed in one pass (#44 dedup, #45 org-domain, #46 name-guard, plus
0041 re-confirmed). Read as four tickets they look unrelated. They are not, and
the two things they share are the part worth carrying forward.

### 1. Verify against live data BEFORE designing the fix — it changed the answer twice

Not a process nicety. In two of the four it changed what got built:

* **#44 dedup.** Ranked highest on impact *on the assumption it was firing*.
  Measured: 127 postings, 127 distinct fingerprints, **0 dropped**, and no
  company under two sources. Real mechanism, no live instance. That reframed
  the deliverable from "fix an outage" to "make an invisible failure
  discoverable", and the ranking that drove the ordering of work was simply
  wrong.
* **#45 org-domain.** The brief offered two fixes and **both would have
  failed**. `Fatishcakes` claims `fatishcakes.com` from a **gmail.com**
  address, so it can never verify and holds the domain permanently. A bare
  `unique (domain)` would have locked the genuine employer out of *both* paths
  — create rejected by the index, join rejected because
  `joinOrganizationAction` gates on `verified` server-side — and made domain
  squatting a one-line attack. The naive fix was worse than the bug, and only
  the live row showed it.

The counter-case matters too: **#46 and #41 both checked clean** (no polluted
names in production; 0041's grants intact through four later migrations). The
check is cheap and worth running even when it confirms rather than overturns.

### 2. The recurring root cause is a Postgres grant the app layer forgot about

CLAUDE.md already names this — *"RLS row policies do not restrict columns"* —
and #45 and #46 are both fresh instances of it, from opposite directions:

* **#46** is the textbook case. `signUpSchema` validated names, but `0030`
  grants `update (first_name, last_name, …)` to `authenticated`, so a client
  PATCHes the column and **never executes the validation**. Confirmed live:
  U+200B, U+2060 and a plain space all wrote successfully. The Zod fix alone
  would have changed nothing for anyone not using the signup form.
* **#45** is the same lesson worn differently: `createOrganizationAction` had
  no uniqueness check *and* no constraint behind it, so nothing anywhere
  enforced one-org-per-domain.

The rule that keeps proving itself: **if a client holds a grant on a column,
application validation is UX, not a gate.** The gate has to be in the database
— a CHECK, a constraint, a column grant, or an atomic statement. Every fix in
this sweep that mattered put it there and left the app-layer check in place
only for the error message.

### 3. Two bugs found in the tooling, not the product

Worth their own line because both would have kept costing time:

* **The CI secret scanner reported its own download failure as a leak** (#43).
  Fixed and then *validated by contrast*: on #46 gitleaks genuinely ran and
  genuinely found a hardcoded test password. The two cases are now tellable
  apart from the message alone.
* **The `e2e/employer.spec.ts` flake was concurrent CI runs sharing one
  Supabase project** (#43), not the spec. Root-caused rather than patched.

---

## Merged 2026-08-26 — PR #46, names must render something visible (0045)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#46](https://github.com/Bayo-1987/Claude-Talentrah/pull/46) | `fix/zero-width-name-guard` | 08:51:04 | `03dfdd3` |

**Correction to the brief:** `.trim()` *does* strip U+FEFF, so the BOM example
was already handled. The real offenders are U+200B/200C/200D, U+2060, U+180E —
category Cf, which the ECMAScript WhiteSpace production does not cover.

**Six call sites, three of which never trimmed at all** — `layout.tsx`'s avatar
initials and Farah greeting, and `renewals.ts`, which puts the blank straight
into a paying customer's renewal email. A literal space defeated those; zero
width was not even required.

**The JS/SQL drift was real, not hypothetical.** The rule is expressed twice
because a regex cannot cross the boundary, and the first version disagreed:
`has_visible_characters(U+FEFF)` returned TRUE while `hasVisibleName` returned
false — Postgres `\s` does not cover U+FEFF, JS `.trim()` does. That is the
SQL-accepts-what-JS-rejects direction, which puts the blank name back in the
table. Caught by running the same inputs through both rather than assuming they
agreed. The two character lists are **deliberately asymmetric**; the invariant
is identical accept/reject *behaviour*, asserted case by case.

**NULL allowed explicitly, not incidentally**, and the migration refuses to
apply while naming offending rows rather than letting `ALTER TABLE` fail bare.

### Verified

1. **PR API** — `merged: true`, `merge_commit_sha 03dfdd3c0fb3e96404f2f78130267edfbc7b06b3`.
2. **Fresh shallow clone of `main`** — merge commit `03dfdd3`, two parents
   (`e641cf7` + `0d5f2f7`). Migration, helper and test file present; the CHECK's
   `IS NULL` branches confirmed in the committed SQL; all six call sites
   confirmed routed through `visibleName`/`hasVisibleName`.
3. **Live, post-merge — both directions.** Happy path intact: `Adaeze Okonkwo`
   writes, greeting renders *"Ready to land your dream job, Adaeze?"*, initials
   `AO`, Farah `Adaeze`, renewal email *"Hi Adaeze,"*. `Ọlá`, `  Ada  `,
   `Jean-Luc`, `O'Brien` all accepted and display correctly. Rejection holds:
   U+200B, plain space and U+FEFF all `23514`. NULL still writable.
4. **CI** — 27/27 files, **349/349 tests**, Playwright 13/13; all four checks
   green on the PR head, and the secret scan verified as a genuine run
   (`1 commits scanned, no leaks found`) rather than a vacuous pass.

Proven by removal: dropping the constraint fails 9 tests, every invisible
character accepted exactly as in production.

---

## Confirm-only 2026-08-26 — premium-template gate (0041) still closed

Re-checked rather than re-diagnosed, per the brief. `0041`'s grants survive four
subsequent migrations: `resumes` has **no table-wide UPDATE** and only
`title, structured_content, source, updated_at` granted, so `template_id`
remains unwritable — the gate itself. Its regression suite passes **27/27**,
including `MONEY: cannot apply a premium template by writing template_id
directly`. The companion revokes on `farah_messages` and `referral_shares` are
also intact with no column grants.

One thing that looks alarming and is not: `resume_templates` still reports
`table_wide_update = true`. It has RLS enabled with a single `SELECT` policy and
**no write policy**, so the row policy refuses before the grant is consulted —
the inverse arrangement to `resumes`, established and pinned by tests in 0042.
Do not "fix" it.

---

## Merged 2026-08-26 — PR #45, one verified org per domain (0044)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#45](https://github.com/Bayo-1987/Claude-Talentrah/pull/45) | `fix/duplicate-org-domains` | 08:11:37 | `f1df362` |

3 files, +234/−0.

**The case where checking live data before designing changed the outcome, not
just confirmed it.** The brief offered two fixes — a unique index on
`organizations(domain)`, or an app-layer check routing the second person to a
join flow. **Both, as stated, would have failed**, and production held the row
that proved it.

`Fatishcakes` claims `fatishcakes.com` and was created by a **gmail.com** user
(`zimcresttechnologies@gmail.com`, email confirmed). `evaluateDomainVerification`
requires the claimed domain to match the creator's own confirmed email domain,
so that org can never verify — it holds the domain permanently. Under a bare
`unique (domain)` the real employer at fatishcakes.com could neither **create**
(index rejects) nor **join** — because `joinOrganizationAction` gates on
`verified = true` **server-side**, not only in the onboarding page's joinable
query. Locked out on both paths, which is worse than the duplicate, and domain
squatting becomes a one-line attack: any free mailbox permanently denies a
company its registration.

**The rule that resolves it:** verification is what establishes a claim on a
domain — exactly what 0027 and 0028 exist for. A verified org owns its domain;
an unverified one owns nothing and blocks nobody.

`0044` is therefore a partial unique index:
`(lower(domain)) where domain is not null and verified`. Four cases, each pinned
by a test: two verified → rejected; verified alongside unverified → **allowed**
(the route past a squatter); two unverified → allowed; null domain →
unconstrained.

App layer does the other half, since an index alone surfaces as a raw Postgres
error rather than sending the person to their colleagues: a pre-check for a
verified org at the domain, and `23505` handled as a genuine race by **rolling
back** rather than leaving an unverified duplicate on the domain — that leftover
would be the exact debris the index prevents, and invisible to the joinable list.

### Verified

1. **PR API** — `merged: true`, `merge_commit_sha f1df36275bbc8abc9539e064387e4468c364c1af`.
2. **Fresh shallow clone of `main`** — merge commit `f1df362`, two parents
   (`550c0b3` + `27b36cc`). Migration present with the scoped predicate; the
   pre-check (actions.ts:120), the race handler (`23505`, :175) and
   `tests/employer/duplicate-domains.test.ts` all present.
3. **Live, post-merge** — `fatishcakes.com` still resolves to exactly **one** org
   (`Fatishcakes [verified=false]`), and the happy path is intact. Verified in a
   rolled-back transaction rather than by reasoning: a fresh domain creates then
   verifies successfully, and a **verified** org can still be created alongside
   the unverifiable squatter on `fatishcakes.com` — the anti-squatting route is
   open. Production re-checked afterwards: 2 orgs, zero probe leftovers.
4. **CI** — 26/26 files, **322/322 tests**, Playwright 13/13 on the PR head; all
   four checks green.

Proven first: `SPLIT COMPANY: two verified orgs share one domain` fails against
unfixed code.

---

## Merged 2026-08-26 — PR #44, dedup key collisions

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#44](https://github.com/Bayo-1987/Claude-Talentrah/pull/44) | `fix/dedup-key-collisions` | 07:54:46 | `feedd8a` |

4 files, +230/−7. Full write-up in `docs/phase-1-summary.md`; the short version
and the verification are here.

**A correction to my own ranking.** I put this top of the backlog on impact
partly assuming it was live. It was not: 127 postings, 127 distinct
fingerprints, 0 dropped, no company under two sources. Real mechanism, not an
active outage — worth saying because the ranking drove the ordering of work.

**The bug** is the key, not the hash. `company | title | location` is UNIQUE
table-wide, so two requisitions that canonicalize alike are one job. The batch
collapse was last-one-wins and discarded the losing posting's `external_url` —
the apply link — while `upserted` still reported a plausible count.

**The fix** disambiguates by URL instead of dropping, keyed stably. Cross-source
dedup is preserved and pinned by a test; it is the feature, and the obvious
"tighten the key" fix would have broken it.

### Verified

1. **PR API** — `merged: true`, `merge_commit_sha feedd8a987d73901f76af8ee8b3ddbac07b0a312`.
2. **Fresh shallow clone of `main`** — merge commit `feedd8a`, two parents
   (`80f870f` + `ad1e7b6`). `disambiguateFingerprint` (dedup.ts:49),
   `resolveFingerprintCollisions` and the `collided` counter (ingest.ts:29, :82,
   :167), and `tests/jobs/dedup-collisions.test.ts` all present.
3. **Live** — feed intact post-merge: 161 postings, **161 distinct
   fingerprints**, 150 open, 137 greenhouse + 20 schema-org. Every one of the
   157 external postings has a non-empty `external_url`; the only 4 without one
   are `source_type: internal`, which apply in-app and legitimately have none.
   Separately, a pre-merge churn probe over the live board returned **127
   updates, 0 inserts** — the change causes no row churn.
4. **CI green on the merge commit** — unit, Playwright and secret scan. On the
   PR head: 25/25 files, **317/317 tests**, Playwright 13/13.

---

## Merged 2026-08-25 — PR #43, CI serialized against the shared database

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#43](https://github.com/Bayo-1987/Claude-Talentrah/pull/43) | `fix/ci-serialize-shared-database` | 20:11:39 | `658565e` |

**The `e2e/employer.spec.ts` flake brief is CLOSED as root-caused, not patched.
The spec needed no change of its own** — the mechanism that broke it is gone.

`ci.yml` had no `concurrency:` block, so every push and every PR run started
immediately with nothing sequencing them, while all of them read and write the
one live Supabase project. Three separate failures in this run were that single
mechanism:

* `e2e/employer.spec.ts` on merge commit `5d65e0d` — a docs push started a
  second `main` run at 19:40:12 while the merge run (19:36:52–19:41:41) was
  mid-suite; the employer publish failed at 19:41:07 and the page never left
  `/employer/jobs/new`. **The identical tree passed Playwright minutes later**
  once nothing overlapped, which is what finally identified it as contention
  rather than a defect.
* Supabase Auth rate-limit exhaustion during the PR #42 review, which surfaces
  as unrelated assertion failures in other files rather than as a rate-limit
  error.
* The `hookTimeout: 60000` bump in `vitest.config.ts` — local runs competing
  with CI, every failure pinned at exactly the 10s hook budget.

**The group key is a constant, not `${{ github.ref }}`.** The usual idiom keys
on the ref so a branch queues only against itself; that models the wrong
resource. Contention here is over the Supabase project, not git history, so a
PR's run and a push to `main` must queue against *each other*. A per-ref key
would have prevented none of the three failures above — each involved two
different refs, or a local run versus CI.

**`cancel-in-progress: false`** — queue, never cancel. Killing a run mid-suite
skips the `afterAll`/`afterEach` cleanup, so its throwaway users, orgs and
job_postings survive; with no staging database that debris lands in the real
project and breaks the *next* run's fixtures. Cancelling does not save time, it
converts one slow run into a later failing one.

### Verified by demonstration, not by reading the docs

A second commit was pushed ~45s after the first to force contention:

```
20:00:21   c847a72a  pending       created=19:59:03   <- queued
           df0980fe  in_progress   created=19:58:17   <- running

20:04:35   df0980fe  completed/success   ended  20:04:08
           c847a72a  in_progress         started 20:04:11   <- 3s later
```

The three-second handoff is the proof. Under the previous config both would have
been executing against the same project from 19:59:03. That the queued run
*ran* rather than being superseded also confirms `cancel-in-progress: false` —
had it cancelled, `c847a72a` would have gone straight from `pending` to
`completed/cancelled`. Both finished green.

### A practical rule this earned

**Do not push to `main` while its CI is still running, and do not run the full
suite locally while CI is running.** The concurrency group now handles the
first case automatically; the second is still on the operator, because a local
`vitest` run is invisible to GitHub Actions.

### Note on PR #42's verification

The standard says "CI green on the merge commit". For #42 that was **not** met on
the merge commit itself — Playwright failed there, for the contention reason
above — but all checks were green on `main` HEAD (`490220c`) immediately after,
on the same tree. Recorded as "green at HEAD with one attributed failure on the
intermediate commit" rather than rounded up, since rounding it up would be false.

---

## Merged 2026-08-25 — PR #42, Paystack timeout / decline ambiguity (0043)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#42](https://github.com/Bayo-1987/Claude-Talentrah/pull/42) | `fix/paystack-timeout-decline-ambiguity` | 19:36:49 | `5d65e0d` |

4 commits, 9 files, +1038/−66.

**The first entry in this run driven by financial-policy judgment rather than a
clear-cut defect.** 0041 was an unauthorized bypass; 0042's premium-template gap
was a product-integrity failure. Both had one right answer once the facts were
in. Here the *bug* was unambiguous but the *remedy* was not — three calls with
real trade-offs either way, recorded below so anyone changing one knows what was
weighed.

### The bug

`chargeOne` caught every failure from `chargeAuthorization` in one branch whose
comment asserted a single cause — "Paystack rejected the charge outright" — for
all of them. Timeout, DNS failure, reset connection, a 502 from Paystack's own
edge, and a genuine decline all reached `markLapsed`, which sets
`next_renewal_date = null`. The job selects on `next_renewal_date <= today`, so
that is what made it permanent: the Pass is never seen again, and the design
deliberately has no dunning. **One dropped connection ended a subscription the
customer was paying for.**

Proven before fixing, real job against the real database, only the Paystack
client mocked:

```
× a timeout leaves the Pass renewable and retries on the next run
  AssertionError: SUBSCRIPTION KILLED BY A NETWORK BLIP: a timeout lapsed a
  paying customer's Pass: expected 'lapsed' to be 'active'
```

Two corrections to the brief's framing: `markLapsed` does **not** clear
`authorization_code` (only `cancelPassAutoRenewal` does) — the token survived and
`next_renewal_date` was the casualty. But it was understated elsewhere: the run
also wrote `payment_transactions.status = 'failed'`, **a claim Talentrah cannot
support**, since a timeout can follow a successful debit. Those now record
`pending`.

### The three decisions

**1 — Three attempts.** One is what caused the bug. Unlimited leaves a Pass
promising a renewal that never comes, with no natural end. Three daily attempts
≈ three days of grace; Paystack incidents run minutes to hours, so beyond that
the failure is no longer plausibly transient. A judgment, not a derivation —
hence one exported constant (`MAX_INDETERMINATE_RENEWAL_ATTEMPTS`) so changing
it is visible and deliberate.

**2 — Verify before re-charging.** The non-obvious risk in "just retry": a
timeout can occur *after* the card was debited, so a naive retry bills twice for
one period — worse than the original bug, which only withheld a service where
this takes money. An indeterminate attempt stores its reference; the next run
verifies it before charging, and if the verify is itself indeterminate the run
backs off rather than gamble.

**3 — Safe-by-default classification.** The predicate is `isDecline`, asking "do
we have positive evidence the card was refused?", not `isIndeterminate` asking
"does this look like a network problem?". Under the second phrasing an
unrecognised error falls through to cancelling the customer — the original bug in
a new shape. **This was not theoretical: the first implementation used that
phrasing and the timeout test still failed.** The fix was wrong in the exact
direction it was meant to correct, and only the test caught it.

Also recorded: on the final give-up the design cannot rule out having stopped
while a charge of unknown outcome is outstanding. `pending_renewal_reference` is
therefore deliberately **not** cleared, the transaction stays `pending`, and the
run reports `NEEDS RECONCILIATION` naming the reference. Tidying that away would
destroy the only thread back to a refund someone may be owed.

### Backlog item closed outright

All three `fetch` calls in `paystack/client.ts` now share one `paystackFetch`
with `AbortSignal.timeout(15_000)`. **These were the last untimed external calls
in the repo** — the "no external call anywhere sets a timeout" item is done, not
narrowed.

### Two bugs found in the work itself

* **A fixture that silently retargeted its assertions.** A raw
  `admin.auth.admin.createUser` per test lost to Supabase Auth's rate limit under
  full-suite load; when it threw, the module-level `userPassId` kept the previous
  test's value and assertions ran against the wrong Pass. Symptoms — "expected 1
  transaction, got 2", a missing retry reference, intermittent, passing in
  isolation — looked exactly like a product bug. **Third of this class in this
  run**, after PR #38's `afterAll` that leaked the accounts it existed to delete
  and PR #39 review's `ledgerFor` reporting a failed query as an empty result.
  Now uses the retrying helper in `tests/support/auth.ts`, one account per file
  instead of seven, and a sentinel so partial setup fails loudly.
* **The CI secret scanner cried wolf on itself.** gitleaks 403'd on download, the
  step exited non-zero, and a bare `if: failure()` printed *"A secret-shaped
  value was found in this change."* Untrue. Now scoped to the scan step, with
  retries, and a separate notice saying what matters when the tool cannot run:
  **nothing was scanned, so nothing was cleared** — a green PR is not evidence
  the change was checked. Independent of this PR, and worth its own line: a
  security check that cries wolf on its own infrastructure is one people learn to
  dismiss.

### Verified

1. **PR API** — `merged: true`, `merged_at 2026-08-25T19:36:49Z`,
   `merge_commit_sha 5d65e0d764a6a62ff79c943574a2af93cc05709d`.
2. **Fresh shallow clone of `main`** — merge commit `5d65e0d`, two parents
   (`0e9b3cc` + `5b59851`). Present and confirmed: `0043_renewal_indeterminate_failures.sql`
   with its three `add column`s and the index; `PaystackDeclineError` (client.ts:34),
   `PaystackUnavailableError` (:46), `isDecline` (:75) and `AbortSignal.timeout` (:99);
   `MAX_INDETERMINATE_RENEWAL_ATTEMPTS = 3` (renewals.ts:18); and the CI fix
   (`steps.scan.outcome`, "Tooling failure notice").
3. **Live schema** — all three columns exist with the right types
   (`renewal_attempt_count:integer NOT NULL`, `pending_renewal_reference:text`,
   `last_renewal_failure_at:timestamptz`) and the partial index is live:
   `CREATE INDEX user_passes_pending_renewal_idx ON public.user_passes USING btree (pending_renewal_reference) WHERE (pending_renewal_reference IS NOT NULL)`.
4. **CI green on the merge commit** — unit and Playwright. On the PR head:
   24/24 files, **310/310 tests**, Playwright 13/13.

> **This one could not be probed against real data, unlike #39–#41 — and that is
> a gap in evidence, not a step that was skipped.** Production currently holds
> **zero** `user_passes` rows (0 total, 0 with auto-renew active, 0 mid-retry), so
> there is no Pass to exercise the renewal path against. What was verified live is
> the schema; the behaviour is covered by 7 tests driving the real
> `runPassRenewalJob` against the real database with only the Paystack client
> mocked. **The first real Pass with auto-renew active is the first opportunity
> for an actual live probe** — worth taking at the next verification pass rather
> than assuming this is settled.

---

## Merged 2026-08-25 — PR #41, full template library (0042)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#41](https://github.com/Bayo-1987/Claude-Talentrah/pull/41) | `feat/full-template-library` | 18:48:15 | `e120fce` |

17 files, +1557/−20. Phase 2's full-template-library milestone.

### What the previous state was

**Choosing a template changed nothing you could see.** All seven
`resume_templates` rows differed only in `name`, `industry_category`,
`is_premium` and `unlock_cost_credits`. Every resume rendered through the single
`ResumeDocument` component — `resume-builder/preview/page.tsx` did not even
`select` `template_id`. The gallery was selling a label.

### The Portfolio Grid / Pipeline fix — a product-integrity defect, NOT a 0041-class exploit

Recorded separately and in different language on purpose, because the two are
different failure modes and the severity vocabulary should not be shared:

* **0041** was an **unauthorized bypass**. A user took something they had not
  paid for and were not entitled to, by writing a column the server never meant
  them to touch. A control failed. The wronged party was Talentrah.
* **This** is the inverse. Portfolio Grid and Pipeline were premium at 10
  credits and rendered the free layout. The unlock worked *exactly as designed*
  — credits were spent, `user_template_unlocks` was written, the entitlement was
  real and correctly recorded. What the user received was a template that was
  **contractually theirs but visually indistinguishable from free**. Nothing was
  bypassed and no control failed. The wronged party was the **user**, who paid
  for a difference that did not exist.

So it is **not** a security finding and does **not** belong in the
0028/0030/0031/0041 running count. It is a promise the product did not keep.
It was outside the brief's four-new-templates scope and was fixed anyway,
because shipping a milestone that leaves paid templates empty is not a
defensible place to stop. Surfaced by the registry test:

```
× every premium template renders something distinct from the free default
  AssertionError: PAID FOR NOTHING: these premium templates render exactly
  like the free default: expected [ …(2) ] to deeply equal []
```

That assertion has **no exemption list**, unlike the free-template one below.

### What shipped

- **`slug` as the join key** (`0042`) — `text not null unique`, backfilled for
  the original seven with fixed values, not a `slugify(name)`. The registry keys
  off `slug` and nothing else: `name` is editable catalog copy with no unique
  constraint, so keying on it means a rename silently unmaps a layout with no
  error anywhere; `id` is a per-environment uuid and could not be committed to
  source. The migration raises a clear exception if any row lacks a mapping,
  rather than failing later on the `not null` with no indication of which row.
- **A component-per-slug registry**, visual-only differentiation — layout,
  density and typography change per profession; the `StructuredResume` shape
  does not, so a resume renders unchanged under any template and switching stays
  a reversible choice rather than a data migration.
- **Four new templates** — Clinical (Healthcare), Statute (Legal), Critical Path
  (Project Management, Enhancv's most popular category), Public Record
  (Government & Public Sector, deliberately chosen as a large segment neither
  competitor targets and a fit for a Nigeria-first product). Categories taken
  from Resume-Now's and Enhancv's real taxonomies, deduped against the existing
  seven. Three of the four premium; the catalog was 5-of-7 free.
- **Two premium templates rebuilt** — Portfolio Grid, Pipeline, per the above.
- **Preview wired through** the `resume_templates(slug)` join. `edit/page.tsx`
  was checked and has only a link, no preview pane, so needed no change.

Catalog is now **11 templates across 11 industry categories**, one per category.

### Bounded and visible, not silent

Four *free* templates (Structured Admin, Product & Tech, Field Notes, Ledger)
still render as clean-professional — the brief's stated fallback behaviour.
Encoded as `KNOWN_UNSTYLED_FREE_SLUGS` with two enforced rules: **it may only
shrink**, and **nothing premium may appear in it**. Stale entries and entries
that gain a component also fail. A documented list that can only shrink is the
opposite of the undocumented allowlist this repo has been right to distrust.

### The 0041 guard did not collide — checked, not assumed

`resume_templates` is catalog data: RLS enabled, exactly one `SELECT` policy,
**no write policy at all**. A write is refused by the row policy before the
table-wide grant is ever consulted — the opposite arrangement to `resumes`,
where a permissive `FOR ALL` policy let the default grant through. `slug`
carries no trust, money or identity.

Reconfirmed **live, post-merge**, with a real authenticated session:

```
update {"is_premium":false}       -> no error (row policy matched 0 rows)
update {"unlock_cost_credits":0}  -> no error (row policy matched 0 rows)
update {"slug":"hijacked"}        -> no error (row policy matched 0 rows)
insert new catalog row            -> 42501 new row violates row-level security policy
re-read: slug=statute is_premium=true cost=10
=> UNCHANGED — RLS refused first
```

The silent zero-row updates are exactly why the re-read matters: a column-level
denial errors, a row-policy denial does not, and only re-reading with the
service role tells those apart from success. `column-privileges.test.ts` now
asserts this as a standing check (27 → included in the 303).

### Verified

1. **PR API** — `merged: true`, `merged_at 2026-08-25T18:48:15Z`,
   `merge_commit_sha e120fce5ba8f7df87727a39364a405b0ee19f666`.
2. **Fresh shallow clone of `main`** — merge commit `e120fce`, two parents
   (`99751a7` + `6720409`). `0042_template_slugs_and_library.sql` present with
   its statements; all six template components present
   (`clinical`, `statute`, `critical-path`, `public-record`, `portfolio-grid`,
   `pipeline`) plus `index.tsx`; `vitest.config.ts` glob confirmed widened to
   `["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"]`.
3. **Live production check** — all **11 rows have a non-null slug**; the four
   new rows match the migration exactly (Clinical/Healthcare/free/0,
   Statute/Legal/premium/10, Critical Path/Project Management/premium/10,
   Public Record/Government & Public Sector/premium/10); catalog unwritable as
   above.
4. **Premium render spot-check** — a real resume was created on the **Statute**
   template (premium, 10 credits) and the preview page's *exact* query run
   through a real RLS-scoped authenticated session against production returned
   `joined slug: statute`, which resolves to `StatuteTemplate`, **not** the free
   default. See the honest limit on this below.
5. **CI green** — 23/23 files, **303/303 tests** (up from 272: `template-registry`
   10, `template-rendering` 19), Playwright 13/13, all four checks on the PR head.

**Honest limit on point 4.** The chain query → joined slug → matched component
is verified against production *data* through a real session. What is *not*
verified is the deployed server rendering those pixels in a browser: the
`/auth/callback` route requires a PKCE `code` and calls
`exchangeCodeForSession`, so an admin-generated magic link cannot establish a
browser session through it — correct app behaviour, not a defect — and entering
a password is not something to do here. The route is confirmed deployed and
auth-gating (`307 → /login`), and CI's Playwright exercises the real app. State
it that way rather than claiming a production screenshot that was not taken.

### Two defects found in this work's own tests

- **The tests proved mapping, not rendering.** The registry suite asserted
  component *identity* — broken markup, a crash on an empty section, or a
  copy-paste rendering the same DOM as its neighbour would all have passed.
  `template-rendering.test.tsx` now renders each template with
  `react-dom/server` and asserts content survives, `EMPTY_RESUME` renders (what
  a user sees immediately after picking a template), no two produce identical
  markup, and two concrete layout claims. Proven non-vacuous by pointing
  `statute` at `ResumeDocument`, which fails with *"statute renders
  byte-identical markup to clean-professional"*.
- **`vitest.config.ts`'s glob excluded `.tsx`**, so that entire suite was never
  collected. An uncollected file is **not reported as skipped** — it looks
  exactly like a clean run, and the only tell was the test count not moving.
  Glob widened; confirmed no other `.tsx` test file existed, so nothing
  previously-failing was hidden by it.

---

## Merged 2026-08-25 — PR #40, resumes/Farah column privileges (0041)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#40](https://github.com/Bayo-1987/Claude-Talentrah/pull/40) | `fix/resumes-column-privileges` | 18:05:42 | `a0925ab` |

3 files, +373/−0. **Two live, exploitable gaps in production — not design nits.**
Both were confirmed with a real authenticated session against the production
project *before* being fixed, and both are stated plainly here because
"review found some improvements" would misrepresent what was actually open.

### 1. Any user could unlock every premium template for free — the reported issue

`resumes` carries a correct owner-only policy —
`for all using (auth.uid() = user_id) with check (auth.uid() = user_id)` — and,
unlike `profiles`/`organizations`, had **never** had a column grant applied.
Supabase grants `UPDATE ON ALL TABLES` to `authenticated`, so the owner owned
every column on their own row. `template_id` points at `resume_templates`, whose
`is_premium` rows cost credits through `unlockTemplateAction` (checks
`user_template_unlocks`, then calls `spendCredits`). A client writing the column
reaches none of that:

```
premium template: Portfolio Grid (costs 10 credits)
unlocks owned: 0   credits: 0
update error: none
template_id now: 7704054a-6c90-40b6-a977-ef6e2e1c404f
=> BYPASSED — premium template applied, 0 credits spent
credits after: 0 (unchanged = never paid)
```

A user with no credits and no unlocks applied a paid template. Anyone who opened
the network tab had the entire premium library, and had done for as long as the
feature has shipped.

### 2. The sweep's own find — the Farah LLM spend cap was self-resettable

Found by the "what else grants the same privilege" pass CLAUDE.md makes standard
after a policy fix. `resumes` was what was reported; this was sitting next to it
and nobody had asked about it.

`/api/farah/chat` caps a user at 30 messages an hour purely as a cost safety net
on unbounded authenticated LLM spend, and counts its own rows —
`.eq("role","user").gte("created_at", oneHourAgo)`. Both columns sat inside the
same unrestricted owner-only grant, so **the counter was writable by the thing
being counted**:

```
counted toward the 30/hr cap: 1
backdate error: none
counted after backdating: 0
=> BYPASSED — quota reset, unlimited paid LLM calls
```

Of the two, this is arguably the larger exposure: the template bypass costs
Talentrah a template unlock, this one costs uncapped model spend on a free-tier
key.

### The sweep, in full

Six tables had the exploitable shape (owner/member UPDATE policy + table-wide
grant). What each turned out to be:

| Table | Verdict |
|---|---|
| `resumes` | **fixed** — `template_id` paywall bypass, plus `is_base`/`user_id` locked |
| `farah_messages` | **fixed** — UPDATE revoked outright; nothing in `src/` ever updates it |
| `referral_shares` | **revoked** — hardening, labelled as such; no exploit found, but nothing updates it either |
| `job_postings` | left alone — its `WITH CHECK` already pins `source_type='internal' AND is_org_member(...)`, so 0027's verification gate cannot be ducked and a posting cannot move orgs. The policy carries the column constraint itself. |
| `applications` | left alone — `stage` is governed by 0037's trigger; the rest is the user's own record, and CLAUDE.md is explicit that blocking mis-click corrections is a worse product than the bug |
| `scholarship_saves` | left alone — no gated column |

### The fix

Mirrors `0030` exactly, including the ordering that makes this class recur:
**revoke the table grant first**, because a table-level grant overrides a
column-level one — granting columns without revoking first changes nothing.

The grant list was re-verified against the code rather than accepted: all three
UPDATE call sites (`saveResumeAction` at `actions.ts:137`; `upsertBaseResume`'s
two paths at `:47`/`:80`) write only `title`, `source`, `structured_content`,
`updated_at`. `template_id` is legitimately set only on **INSERT**
(`actions.ts:113`), which the migration does not touch and which already gates on
an existing unlock. `scripts/seed.ts:279` does update `template_id`, but runs as
`service_role`, which column grants do not constrain. `deleteResumeAction`
(`actions.ts:203`) uses DELETE, also untouched.

### Verified, four-point standard

1. **PR API** — `merged: true`, `merged_at 2026-08-25T18:05:42Z`,
   `merge_commit_sha a0925ab7b0938ea6742a5311eef7f2c79c0037c0`.
2. **Fresh shallow clone of `main`** — merge commit `a0925ab`, two parents
   (`a86bd1b` + `2a1dcc1`). `supabase/migrations/0041_lock_resume_and_farah_columns.sql`
   present, and its four executable statements confirmed in the clone: the
   `revoke update on public.resumes`, the
   `grant update (title, source, structured_content, updated_at)`, and the two
   revokes on `farah_messages` and `referral_shares`. The new tests are on `main`
   too (`column-privileges.test.ts:621`, `:718`).
3. **Live probe** — both bypass queries re-run against production from a real
   authenticated session (0 credits, 0 unlocks):
   ```
   BYPASS 1  resumes.template_id write        -> 42501 permission denied for table resumes
             template_id: null (unchanged)
   BYPASS 2  farah_messages.created_at backdate -> 42501 permission denied for table farah_messages
             quota count: 1 before, 1 after
   CONTROL   saveResumeAction's columns        -> works
   ```
   The control is load-bearing: a fix that also broke the builder's save would
   have been worse than the bug.
4. **CI green** — 21/21 files, **272/272 tests** (up from 267; the five new
   column-privilege cases), `column-privileges.test.ts` 25/25, Playwright 13/13.
   All four checks passed on the PR head and on the merge commit.

### Proof the tests catch it

Against unfixed code four fail — `MONEY: cannot apply a premium template by
writing template_id directly`, the `is_base`/`user_id` case, `COST: cannot
backdate its own messages to clear the hourly quota`, and the `role` relabel.
One of those caught a subtlety worth keeping: the enum is `"user" | "farah"`,
not `"assistant"`, so the first draft of the relabel test was passing because
Postgres rejected an invalid enum value rather than because the grant refused it
— passing for entirely the wrong reason.

### The class now has a running count

This is the **sixth and seventh** instance: 0028, 0030, 0031, and now 0041 twice
over. Every one was found by this same sweep and every one had been live in
production. The working prior should now be that **any new user-writable table is
exposed until proven otherwise** — Supabase's default `GRANT UPDATE ON ALL
TABLES` makes exposure the default state, and only an explicit column grant takes
a table out of it.

---

## Merged 2026-08-25 — PR #39, schema.org/JobPosting ingestion

Closes the second half of M2/§6.12. Arrived as a patch file (`git am`, authorship
preserved: `Claude <noreply@anthropic.com>`), then four follow-up commits from
review.

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#39](https://github.com/Bayo-1987/Claude-Talentrah/pull/39) | `feat/schema-org-job-ingestion` | 17:10:04 | `6326d72` |

7 commits, 16 files, +1288/−35.

### What shipped

`src/lib/jobs/sources/schema-org.ts` — a two-step fetcher (a listing page's
`ItemList` JSON-LD → each job's own `JobPosting` block) wired into `ingest.ts`'s
existing dispatch/dedup/freshness pipeline. One vetted pilot source:
`jobs.workable.com/search/nigeria`. `JobSourceConfig` and
`NormalizedJobPosting.externalSource` became a three-way discriminated union.

It also carries **the only timeout on any external call in this repo**
(`AbortSignal.timeout`, 15s). The "no external call anywhere sets a timeout"
gap in the backlog is otherwise untouched.

### Source eligibility — the part that carries legal weight

Four candidates were checked and rejected before Workable qualified. Three were
taken on the patch's word; **Fuzu was re-verified independently**, because the
whole disqualification rests on it and it is the one claim with real legal
consequence if wrong.

`fuzu.com/legal/terms` sits behind a Cloudflare challenge (HTTP 403). No attempt
was made to defeat bot-detection; the page was read in an ordinary browser.
**§12 "Acceptable use", Global Terms v2, last updated 1 June 2026** — both
phrases present verbatim, not paraphrased:

> ...use automated tools to scrape or misuse platform data...

> ...misuse Candidate or Employer data, including by selling, redistributing, or
> aggregating it without authorisation; scrape, harvest, mine, or extract
> platform data without authorisation, or train any third-party AI System on
> Content obtained from the Service without authorisation...

The actual text is **broader than the patch claimed**: the patch framed the ban
as scoped to Candidate/Employer data, but there is a standalone prohibition on
scraping or extracting *platform data*, plus an explicit ban on training
third-party AI on Fuzu content. Job listings are squarely inside it. Fuzu's
`robots.txt` carries no AI-crawler restriction at all — which is the point:
robots.txt permissiveness is not a redistribution licence.

Workable's `robots.txt` was re-verified too:
`Content-Signal: search=yes, ai-input=yes, ai-train=no`, `Allow: /search/*`, no
disallow covering `/view/*`. A live posting was confirmed to carry every field
the fetcher requires.

### The closure-discriminator bug — a real live defect, not a design nit

**This one reached production during review and closed 20 real job postings.**
Recorded in full because smoothing it into "review found some improvements"
would misrepresent what happened.

The freshness sweep scoped a schema.org source's closure by
`external_source = 'schema-org'` — the bare discriminator, shared by *every*
schema.org row in the table. greenhouse/lever get a second predicate
(`company_name`) that scopes them to their own board; a multi-employer
schema.org source has no such column and got nothing.

It was first written up as latent — "fine with one source, breaks the moment a
second is added." **That was wrong.** Any schema.org ingest closed every
schema.org row it had not just seen, and *a test counts as an ingest*. Running
the new `tests/jobs/ingest-schema-org-multi-source.test.ts` against the unfixed
code closed all 20 real Workable postings in the live project, because its
mocked sources have no real postings of their own so every genuine row looked
stale to their sweep. There is no staging database; that is why a test reached
real data.

Fix: `external_source` is now `schema-org:<label>`, produced by one function
(`schemaOrgSourceKey` in `types.ts`) that both the upsert and the closure query
call, so writer and sweep cannot drift apart. Before changing it, every reader
of the column was re-checked against then-current `main`: the only ones are
`ingest.ts`'s own write and closure query. The UI branches on
`source_type === "external"` (`src/components/jobs/job-card.tsx:36`), never on
`external_source`'s value. No RLS policy, index or constraint references it —
plain nullable `text`.

Proof, both directions:

```
pre-fix   × CROSS-SOURCE CLOSURE: source B closed 2 of source A's postings
          × A's still-listed posting must stay open: expected 'closed' to be 'open'
          live project: 20 real Workable rows → all closed by a test ingest

post-fix  11/11 jobs tests pass
          live project: 20 real Workable rows → all still open
```

The test carries a positive control, so "nothing ever closes" cannot satisfy it.

### Three other defects found and fixed during review

- **The DB test could never have passed.** `tests/jobs/ingest-schema-org.test.ts`
  stubbed the *global* `fetch`, which supabase-js also uses, so its mock threw
  on Supabase's own REST calls — contradicting the file's own docblock ("Network
  is mocked; Supabase is not"). The patch flagged it as unrun for lack of
  `SUPABASE_SERVICE_ROLE_KEY`; the key was available here, the file ran for the
  first time, and failed immediately. Now passes through to the real fetch for
  anything that is not a test-owned URL.
- **`scripts/seed.ts` would have logged `greenhouse/undefined`.** It re-declared
  the route's response shape inline, so the `token` → `identifier` rename kept
  compiling. Replaced with a type-only import of the real `IngestSourceResult`.
- **`ledgerFor` in the referrals suite reported failed queries as empty
  results** (`data ?? []`), which produced one false assertion failure. Now
  throws. A helper that cannot tell "no rows" from "the question was never
  answered" will eventually blame the code for the network.

### Migrations 0039 and 0040 (both applied, both in `list_migrations`)

- **`0039_qualify_schema_org_source_key`** (`20260825162806`) — re-labels
  pre-existing bare `schema-org` rows. Guarded: raises rather than mislabel
  anything that is not a `jobs.workable.com` URL. Needed because a row already
  delisted is never re-upserted, so it would never match the new sweep and would
  sit `open` forever. A permanently live listing for a dead job is worse than a
  missing one — someone spends an application on it.
- **`0040_reopen_test_closed_workable_rows`** (`20260825163103`) — reopens the 20
  the pre-fix test run closed. All 20 were re-checked against the live listing
  first; all 20 still there.

### Verified, four-point standard

1. **PR API** — `merged: true`, `merged_at 2026-08-25T17:10:04Z`,
   `merge_commit_sha 6326d722cfe61f1b28c833309dfa12ec009d88fb`.
2. **Fresh shallow clone of `main`** — merge commit `6326d72` with two parents
   (`e373aa3` + `215f69f`), matching this repo's merge-commit style. All new
   files present; `externalSourceKey(config)` confirmed in the merged
   `ingest.ts:120`, `schemaOrgSourceKey` in `types.ts:64`, `hookTimeout: 60000`
   in `vitest.config.ts:30`.
3. **Live probe** — `/` 200, `/login` 200, `/signup` 200, and the admin surface
   still fail-closed at 401. Database: exactly **20 open
   `schema-org:workable-nigeria` rows, zero bare `schema-org`**, greenhouse
   untouched at 127 open / 10 closed.
4. **Full suite green in CI** on the merged head `215f69f`: **21/21 files, 267/267
   tests**, plus **Playwright 13/13**. All four checks passed. Independently
   re-run locally against merged `main` (`c79f177`) once CI had finished and
   nothing was contending for the database: **21/21 files, 267/267, exit 0**.
   Two uncontended runs agreeing is also what rules out the alternative reading
   of the flakiness below — that the raised `hookTimeout` is masking a real
   problem rather than absorbing contention.

### The suite's own flakiness was self-inflicted — worth remembering

Two local full-suite runs failed with 14 tests across 9 files, every failure
pinned at exactly the hook timeout (`10008ms`, `10002ms`, `10512ms`). It was
first blamed on Supabase's auth rate limit. **That was wrong** — a direct probe
on a quiet database measured `createUser` at ~750ms and a plain select at 234ms.

The real cause: 21 test files run in parallel against the shared live project,
**and CI runs against that same project at the same time**. The CI record shows
it — commits whose local runs overlapped CI failed the unit job, and the
Playwright failure on `aa44e1c` was literally `AuthRetryableFetchError: Gateway
Timeout` at 16:52, mid-way through a local run.

Two consequences, both kept:

- `vitest.config.ts` now sets `hookTimeout: 60000`. Three files had already been
  patched with a per-hook `, 60_000` — one fix applied three times while leaving
  every other suite exposed. A raised ceiling does not hide a hang; a genuinely
  stuck hook still fails, just at 60s.
- **Do not run the full suite locally while CI is running on the same branch.**
  There is one database and both will fight for it.

Related, and not an anomaly: a real ingest against the live project at
`16:20:07` (127 greenhouse rows re-checked, 20 Workable rows created) was **CI's
own `npm run seed` step** — a CI run on this PR ran 16:16:10Z–16:22:16Z, which
brackets it. Per CLAUDE.md, `seed` drives real ingestion over HTTP precisely
because there is no staging database. The 20 rows are genuine, currently-live
postings and were deliberately kept rather than deleted and re-ingested.

### Still one pilot source, not a green light

Workable is one well-vetted source. Adding more via the same mechanism, or
relying on schema.org as a *primary* supply channel, remains gated on the legal
review build-prompt §10 item 10 names. Read `sources.config.ts`'s comment before
adding a second.

---

## Merged 2026-08-25 — PRs #35, #36, #37

All three verified by the four-step standard above.

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#37](https://github.com/Bayo-1987/Claude-Talentrah/pull/37) | `fix/api-contract-layer` | 14:48:38 | `b605435` |
| [#36](https://github.com/Bayo-1987/Claude-Talentrah/pull/36) | `fix/tracker-stage-transitions` | 14:54:50 | `66edb12` |
| [#35](https://github.com/Bayo-1987/Claude-Talentrah/pull/35) | `fix/referral-self-referral-dots` | 14:57:35 | `61fc8db` |

Merged **#37 first**, out of the suggested #35 → #36 → #37 order, for two
reasons: its exposure was live and unauthenticated, and its regenerated
`src/lib/supabase/types.ts` is a strict superset of #35's, so landing it first
turned a hand-merge into a `--theirs` take.

### PR #37 — API contract layer

Closed a **live, unauthenticated production exposure**. Verified open
immediately before the merge and closed immediately after:

```
before   GET  /api/admin/moderate-scholarship          -> 200  (full pending queue)
         POST /api/admin/estimate-llm-costs?group=bogus -> 400  (validation, not auth)

after    GET  /api/admin/moderate-scholarship          -> 401  {"error":"Unauthorized"}
         GET  /api/admin/ingest-scholarships            -> 401
         GET  /api/admin/ingest-jobs                    -> 401
         GET  /api/admin/renew-passes                   -> 401
         POST /api/admin/estimate-llm-costs?group=bogus -> 401
```

The `400 → 401` inversion on the last one is the specific proof the guard now
runs *before* argument validation, rather than being skipped.

Public surface re-checked for a 0032-style regression: `/` 200, `/login` 200,
`/signup` 200, `/jobs` 307 → `/login` (the normal auth gate, not breakage).

Also in #37: atomic per-user rate limiting on `/api/tailoring` and
`/api/resume/parse` (migration `0038`), no handler returning raw `err.message`,
a guard on `request.formData()`, and job ingestion finally scheduled
(`0 5 * * *`).

### PR #36 — tracker stage transitions

Migration `0037`. `hired → anything but archived` is now a database trigger,
because `applications` carries a permissive owner-only policy that makes an
app-layer check bypassable. Also adds the shared retrying auth-test helper
(`tests/support/auth.ts`) and the missing cross-user UPDATE tests.

### PR #35 — self-referral via dotted Gmail aliases

Migration `0036`. Dots are stripped for `gmail.com`/`googlemail.com` only,
since other providers treat them as significant.

### Conflicts resolved during the merges

- `tests/rls/org-and-referral-scoping.test.ts` (#36 ↔ #37): both branches had
  **independently found and fixed the same fixture bug** — its `.limit(1)` had
  started selecting a real unverified org's posting, so the suite reported
  0027's verification gate working correctly as a regression. Identical code
  fix on both sides; kept #36's fuller comment and dropped #37's duplicate.
- `src/lib/supabase/types.ts` (#35 ↔ #37): both regenerated it. Took `main`'s
  copy wholesale after asserting it is a superset — `normalize_email_for_self_referral`,
  `org_application_counts`, `consume_rate_limit`, `spend_credits_atomic`,
  `auto_apply_claim_submission` and the rest all present.

### Correction to the incoming backlog

The backlog described all three PRs as green. **#35 was not.** Its
"Typecheck, lint, unit tests" check had *failed* and Playwright was skipped as
a result. The cause was the shared-fixture bug above, not the referral change;
merging `main` into the branch cleared it and all four checks then passed.

---

## Post-merge: test teardown fix (`fix/teardown-timeout`)

The full suite on merged `main` reported a failed *file* while all 209 tests
passed — `tests/credits/spend-race.test.ts`'s `afterAll` blew vitest's 10s hook
budget deleting its throwaway accounts one round-trip at a time. The timeout
aborts the loop partway, so the hook leaks exactly the accounts it exists to
remove, into the shared project, because **there is no staging database**.

Deletions are now parallel with an explicit 60s hook timeout, in that suite and
in `tests/api/rate-limit.test.ts` which had the same shape. Suite is 209/209
green.

Two orphaned accounts from earlier runs remain (`rls-*`, `employer-*`) against
7 real users. Not enough to slow anything; recorded so the number can be
watched rather than rediscovered.

---

## Environment variables the founder must set

Not code changes — these need someone with account access.

| Variable | Where | Why it matters now |
|----------|-------|--------------------|
| `INGEST_SECRET` | Vercel **Production** | **New and load-bearing after #37.** The admin routes now fail closed, which is the point — but every manual admin trigger answers 401 until this is set. Also needed in `.env.local`, because `npm run seed` drives the real ingestion route over HTTP. |
| `CRON_SECRET` | Vercel **Production** | Unconfirmed. Three crons now depend on it (job ingestion 05:00, Pass renewal 06:00, scholarship ingestion 07:00 UTC). No cron has ever been *observed* firing. |
| `GEMINI_API_KEY` | Vercel **Production** | The key on file is free-tier: 20 requests/day, shared. AI features hard-fail past that. |

Leaked-password protection remains a Supabase **dashboard-only** toggle with no
MCP or CLI path. Carried forward, deliberately not worked around.

---

## Missing input documents

The priority backlog dated 2026-08-25 refers to roughly fifty prompt files in
this directory. **None of the following exist** — checked in the repo root and
across `~/Desktop`, `~/Documents` and `~/Downloads`:

- `handoff-status.md` (this file now stands in for it)
- `schema-org-job-ingestion-prompt.md` — backlog item 2
- `test-scenarios-job-feed-matching-prompt.md`
- `test-scenarios-external-api-integrations-prompt.md`
- `test-scenarios-employer-prompt.md`
- `test-scenarios-scholarships-prompt.md`
- `test-scenarios-resume-builder-prompt.md`
- `test-scenarios-tailoring-credits-payments-prompt.md`
- `test-scenarios-auth-onboarding-prompt.md`
- `talentrah-gtm-brief.md`, `competitive-landscape-brief.html`,
  `pricing-validation-prep-prompt.md`

Present and readable: `CLAUDE.md`, `talentrah-build-prompt.md`,
`talentrah-editorial-design-handoff.md`, `Main-Editorial.dc.html`,
`JobFeed-Editorial.dc.html`, and the plan at
`~/.claude/plans/adaptive-giggling-ember.md`.

The backlog's one-line summaries of each missing brief are enough to *work
from* — but not enough to honour instructions like "read its §0/§1 before
touching a source," which for the schema.org brief carries the source-eligibility
rules. Those need the real files.

---

## Open backlog

1. ~~Merge #35, #36, #37~~ — **done**, verified above.
2. ~~schema.org/JobPosting ingestion~~ — **done**, PR #39, see above. Arrived
   as a patch rather than being built here. One pilot source
   (`jobs.workable.com/search/nigeria`); `hotnigerianjobs.com`, `jobberman.com`,
   `myjobmag.com` and `fuzu.com` all checked and rejected, Fuzu's ToS
   independently re-verified. Broader reliance still gated on §10 item 10.
3. ~~**Test-coverage briefs**~~ — **all closed.** The 2026-08-26 sweep took the
   five scoped to it (dedup, org-domain, premium-template, zero-width, employer
   flake), plus Paystack earlier and the empty-200 guard after. Kept below as
   the record of what each was and how it was closed:
   - ~~Cross-source dedup hash collisions destroying a posting's apply link~~
     — **done**, PR #44. Mechanism real but not firing; fixed and made
     discoverable via `IngestSourceResult.collided`.
   - ~~A transient empty-200 ingest response mass-closing a source's live
     postings~~ — **done**, PR #47. Was the last item outstanding; the guard
     refuses to close when a fetch is empty but open postings exist, on both
     the company-scoped and source-scoped paths, and reports the skip.
   - ~~A Paystack blip being indistinguishable from a real decline~~ — **done**,
     PR #42 / migration 0043. Also closed the "no external call anywhere sets a
     timeout" item outright: those were the last untimed calls in the repo.
   - ~~Duplicate org names/domains unguarded~~ — **done**, PR #45 / migration
     0044. Scoped to VERIFIED orgs only; a bare unique index would have locked
     real employers out behind unverifiable squatters.
   - ~~Premium-template gate bypassable via a direct `PATCH` to
     `resumes.template_id`~~ — **done**, PR #40 / migration 0041. Confirmed live
     and fixed; the sweep also found and fixed the Farah rate-limit bypass.
   - ~~A zero-width character defeating the "no name yet" guard~~ — **done**,
     PR #46 / migration 0045.
   - ~~`e2e/employer.spec.ts` flake~~ — **closed**, PR #43. Root-caused to
     concurrent CI runs sharing one Supabase project and fixed with a
     constant-key concurrency group; the spec itself needed no change.

Items already closed that these briefs still describe as open — confirm, don't
re-diagnose: the ingestion trigger's fail-open (#37), the `spendCredits` race
and the scholarship credit try/catch gap (#34), and the resume-builder
credit-spend race (#34).

---

## Next: employer billing (Phase 2)

No backlog items remain. The next piece of roadmap work is **employer billing**,
chosen over Ad Campaign Manager because it is the prerequisite — you cannot
charge for a campaign without it — and because the Paystack rails and
decline/indeterminate handling are freshly hardened and well understood after
PR #42.

A design brief exists at [docs/employer-billing-plan.md](docs/employer-billing-plan.md)
and is **a proposal, not a decision**. No code and no migrations have been
written. It covers: what is genuinely reusable from the Pass machinery versus
what only looks reusable (`runPassRenewalJob`'s fixed-price/fixed-date shape does
not map onto metered ad spend); an atomic wallet decrement modelled on
`spend_credits_atomic` from the first commit rather than hardened later; the
zero-balance policy (campaigns **pause**, they do not run negative and get
invoiced) with the reasoning written out; and rail-as-data so a top-up's rail is
a property of the transaction even though v1 wires only Paystack NGN.

Four questions in it need a founder answer before schema exists. The sharpest is
**refunds**: if an unspent balance must be withdrawable, that is payouts and KYC
— exactly what §6.7 avoided for referrals by choosing credits over cash.
