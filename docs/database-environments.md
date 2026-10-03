# Database environments and the migration rules

Written so that no session works without these again. **Where this file and older prose disagree** (CLAUDE.md still describes
the earlier hosted CI project, and `supabase/migrations/README.md` carried an applied-migrations table that stopped years of
work ago), **this file is the newer statement.** The rule about *when* an additive or destructive migration is applied relative to
the merge is unchanged and lives in [production-migration-apply.md](production-migration-apply.md); this file says *where*, *in what
order*, *who reserves the number* and *what is recorded*.

## 1. The three environments

| Environment | What it is | Who uses it |
|---|---|---|
| **production** | project `nytwbbzfpytctjsoczzq`. The real users and the real data. Its ledger, `supabase_migrations.schema_migrations`, is the source of truth for what has been applied anywhere. | the live site only. Sessions read it with `READ ONLY` transactions and write to it only with the owner's yes, see §3. |
| **talentrah-preview** | project `gtiksnbhnqmwpeckfqwk`, in its own organisation (`Talentrah Infra`) so it can never share a billing quota with production. | **Vercel previews and local runs only.** Nothing else reads it. |
| **CI** | a fresh local Supabase built from `supabase/migrations/` on every run (`.github/actions/local-supabase`), per job, thrown away with the runner. | GitHub Actions only. It touches neither of the hosted projects. |

A green CI run therefore says nothing about whether a migration has been applied to production or to talentrah-preview. Check each.

## 2. Reserved migration numbers

**A number is reserved by asking the owner first.** Reading the directory and taking the next free number is not a reservation: `0060` was claimed twice in
one morning by two sessions that each did exactly that. Ask, wait for the number, then write the file.

| Number | Held by | Production | talentrah-preview |
|---|---|---|---|
| 0208 | S1, `anonymous_demo_attempts` | applied 15:33Z | applied 15:40Z |
| 0209 | S3-21, money tables survive user deletion | applied 15:22Z | applied 15:24Z |
| 0210 | S3-21, `mentor_unpaid_hold` `search_path` pin (#672) | applied 16:04Z | applied 16:05Z |
| 0211 | S3-21, definer and graphql hardening (#678) | applied 20:36Z | applied 20:37Z |
| 0212 | S3-21, account deletion PR 1: request, emailed confirm link, hide at once (#686) | applied 22:10Z (3 Oct) | applied 22:12Z (3 Oct) |
| 0213 to 0214 | S3-21's later account-deletion PRs (export, purge) | reserved | reserved |
| 0215 | S3 (admin dashboard), Refer & Earn: a signup pays nothing, activation pays the whole reward | applied 09:45Z (3 Oct) | applied 09:46Z (3 Oct) |
| 0216 | S2, the company-rename trigger (#693) | applied 19:01Z (3 Oct) | applied 19:02Z (3 Oct) |
| 0217 | S3-21, scholarship note rules (#703) | applied 17:40Z (3 Oct) | applied 17:40Z (3 Oct) |
| 0218 | S1, column grants on `job_postings` (owner-assigned; waits for #719 to be deployed, a rolled-back dry run and the owner's typed yes) | reserved | reserved |
| 0219 | S1, `employer_moderation_notices` (owner-assigned; the design still needs the owner's approval) | reserved | reserved |
| 0220 | S3 (admin dashboard), the Farah entry-point constraint (one migration; owner-assigned) | reserved | reserved |

The times are the ledger's own version stamps (UTC, 2 to 3 Oct 2026), read from `supabase_migrations.schema_migrations` on both projects. A row says "applied" only because
that ledger shows it; "reserved" means a number has been asked for and no ledger has it.

(0205 to 0207 belong to the open draft PRs #661 and #662, and are not in the directory until those merge.) When a number is used, update this table in the PR that uses it. `tests/docs/database-environments.test.ts` fails if this heading or the table is deleted.

## 3. The order for a migration

1. **Production first.** A rolled-back dry run (`BEGIN … ROLLBACK`, with its own self-checks) is shown to the owner. **Then the owner's yes.** Then a **hash-checked apply**
   in one transaction with self-checks: the SQL applied is the SQL in the PR, proven by comparing a hash of it with the file's.
2. **Then talentrah-preview, by the same session that applied to production**, recorded **with a timestamp and the hash** in the PR that carries the migration.
3. **talentrah-preview never runs ahead of production.** A migration goes there only after production has it, by the same session, recorded with timestamp and sha256.
   A migration whose PR is still open is fine once production has it (step 2 is exactly that). Branch-only or experimental changes never go there: Vercel builds every
   branch's preview against that one database, so one branch's unreviewed schema would make every other branch's preview disagree with its own code.

Additive migrations go to production before the merge and destructive ones after the deploy (see production-migration-apply.md); this section does not change that.

## 4a. Rollbacks live in `supabase/rollbacks/`, not in `supabase/migrations/`

A migration that rebuilds existing objects or drops nothing it can bring back carries its exact undo in `supabase/rollbacks/<number>_<name>.rollback.sql`, reviewed in the same
diff. The file is **not a migration**: it is never applied by CI, `supabase db reset` or `supabase db push`, and it takes no number of its own. It shares its migration's
number precisely because it undoes that one.

That only holds if nothing that reads migrations can see it, and each reader is pinned by `tests/scripts/rollbacks-directory.test.ts`:

- **The migration-numbering check** (`scripts/check-migration-collisions.ts`) lists `supabase/migrations/` only. Were a rollback listed there it would collide with its own migration
  (the test shows that case failing).
- **The drift audit** (`scripts/audit-migrations.ts`) reads `readdirSync("supabase/migrations")`, so a rollback is never expected to have a ledger row.
- **The Supabase CLI** (`db reset`, `db push`, and the CI stack in `.github/actions/local-supabase`) takes migrations from the default `supabase/migrations/` directory;
  `supabase/config.toml` sets `schema_paths = []` and names no other path. Read from the CLI's documented behaviour and config, not from running `db push` here (there is no Docker on the authoring machine);
  the CI stack is the live check, because a rollback applied after its migration would drop the schema the DB-backed suites then need, and every one of them would fail.
- **No workflow or CI action** names `supabase/rollbacks`.

A rollback is proven the same way its migration is: in one rolled-back transaction against the live catalogue, the definitions captured before the migration are compared with the
ones after migration + rollback, and must be identical. That output goes in the PR body. Running a rollback on a real database is a production write and needs the owner's yes like any other.

## 4. One-off production data fixes are not migrations

A fix that edits specific production rows lives in `supabase/data-fixes/`, with a record in that directory's README. It takes no migration number, is not replayed by CI,
and follows the dry-run-then-owner's-yes rule in that README.

## 5. Known history on talentrah-preview

Recorded because a database state that no artifact explains is what this file exists to prevent. Checked against the preview ledger.

- The row **`0208_mentor_unpaid_hold_search_path`** (applied 10:20Z on 2 Oct) was an ad-hoc apply from before these rules. It is **superseded by 0210**; no migration file carries
  that name.
- **0205, 0206 and 0207 were applied to preview before their PRs merged**, also from before the rule. (0207 is recorded there as `job_expiry_reminders`, without its number prefix.)
- Some older rows are recorded without their number prefix (for example `job_posting_supersession` for 0202). The drift check in `scripts/check-migration-drift.ts` is what reconciles
  names; do not rename ledger rows by hand.

- **2026-10-03, about 08:03 UTC (owner's yes, applied by S3-21 in one `DO` transaction with a self-check, read back at 08:04:07 UTC):** `handle_new_user`, `check_and_activate_referral` and
  `count_rewarded_referrals_last_30d` had EXECUTE for `anon` and `authenticated` on preview and not on production; `revoke execute … from public, anon, authenticated` brought preview to
  production's `{postgres, service_role}`. A preview-only grant correction: no migration, no number, no ledger row. The `handle_new_user` trigger is intact. (Found by S3 while checking
  grants; the drift is part of the wider picture in [#683](https://github.com/Bayo-1987/Claude-Talentrah/issues/683).)

Preview and production are **allowed to differ**, in both directions, while a PR is in review. Neither is a copy of the other, and preview has never been the source of truth for anything.
