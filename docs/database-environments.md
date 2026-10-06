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
| 0208 | S1, `anonymous_demo_attempts` (file 0208_anonymous_demo_attempts) | applied 15:33Z | applied 15:40Z |
| 0209 | S3-21, money tables survive user deletion (file 0209_money_tables_survive_user_deletion) | applied 15:22Z | applied 15:24Z |
| 0210 | S3-21, `mentor_unpaid_hold` `search_path` pin (#672) (file 0210_mentor_unpaid_hold_search_path) | applied 16:04Z | applied 16:05Z |
| 0211 | S3-21, definer and graphql hardening (#678) (file 0211_definer_and_graphql_hardening) | applied 20:36Z | applied 20:37Z |
| 0212 | S3-21, account deletion PR 1: request, emailed confirm link, hide at once (#686) (file 0212_account_deletion_request) | applied 22:10Z (3 Oct) | applied 22:12Z (3 Oct) |
| 0213 | S3-21, an idempotent revoke of anon and authenticated EXECUTE on four trigger functions (a no-op on production; aligns preview and CI; owner-decided; trigger_function_grants) (file 0213_trigger_function_grants) | applied 05:54Z (ledgered no-op) | applied 05:54Z (4 Oct), brought in line with production |
| 0214 | S3-21, account deletion PR 2: the export migration (owner-decided) | reserved | reserved |
| 0215 | S3 (admin dashboard), Refer & Earn: a signup pays nothing, activation pays the whole reward (file 0215_referral_reward_on_activation) | applied 09:45Z (3 Oct) | applied 09:46Z (3 Oct) |
| 0216 | S2, the company-rename trigger (#693) (file 0216_org_rename_syncs_internal_postings) | applied 19:01Z (3 Oct) | applied 19:02Z (3 Oct) |
| 0217 | S3-21, scholarship note rules (#703) (file 0217_scholarship_note_rules) | applied 17:40Z (3 Oct) | applied 17:40Z (3 Oct) |
| 0218 | S1, explicit column grants on `job_postings`: anon and authenticated read 43 of its 44 columns (#736) (file 0218_job_postings_explicit_column_grants) | applied 07:45Z (4 Oct), ledger 20261004074529 | applied 07:50Z (4 Oct), ledger 20261004075015 |
| 0219 | S1, `employer_moderation_notices` (owner-assigned; the design still needs the owner's approval) | reserved | reserved |
| 0220 | S3 (admin dashboard), the Farah entry-point constraint, with Farah PR A2 (one migration: a format check replaces the fixed list of `entry_point` values; owner-assigned) | reserved | reserved |
| 0221 | S3-21, job_postings INSERT policy definition (file 0221_job_postings_insert_policy_definition, in the file PR; a ledgered no-op on production, where the definition was already in place; ledger 20261005093746 on production and 20261005104015 on talentrah-preview, both read back from the ledger by S3-21) | applied 09:37Z (5 Oct), ledger 20261005093746 | applied 10:40Z (5 Oct), ledger 20261005104015 |
| 0222 | S3 (admin dashboard), privileges on the two Farah tables (owner-assigned; `supabase/migrations/0222_farah_tables_server_only_writes.sql`, sha256 `b4cd00bca6e39dded306ec880cbc87812b43aa52cab9aab0d284df3c0a58dcae`; applied after the route PR deployed; the file is in that PR) | applied 11:39Z (5 Oct) | applied about 11:07Z (5 Oct) |
| 0223 | S3 (admin dashboard), the table `llm_daily_usage` and the function `add_llm_usage` for Farah's daily spend ceiling (assigned by the owner on 4 Oct 2026; `supabase/migrations/0223_llm_daily_usage.sql`, sha256 `067445111286dcadb10cfef8d11bfb531ec7b220dff7a345f46e8c94c46eaadb`; additive, applies before the spend-ceiling PR merges; the file is in that PR) | applied 11:13Z (5 Oct), ledger 20261005111315 | applied 22:00Z (4 Oct) |
| 0224 | S3-21, `mentorship_sessions` column privileges, with the money columns folded in (assigned by the owner on 4 Oct 2026; supabase/migrations/0224_mentorship_sessions_column_grants.sql, sha256 0310cdeac6f5124decd2a5d203cb118a42d9b519e344fb819bd49164efea9370; applied to production at 09:35:15Z, ledger 20261005093515, read back from the ledger by S3-21; the file is in the file PR) | applied 09:35Z (5 Oct), ledger 20261005093515 | reserved |
| 0225 | S3-21, mentor_profiles column privileges (assigned by the owner on 4 Oct 2026; supabase/migrations/0225_mentor_profiles_column_grants.sql, sha256 b9f1a1fc85d3cbb0a4770028a6a9c67010f42eabe47d2222d31697bc4f69459c; applied to production at 05:48:26Z, ledger 20261005054826, read back from the ledger by S3-21; the file is in the file PR) | applied 05:48Z (5 Oct), ledger 20261005054826 | reserved |
| 0226 | S1, job_postings review-column privileges and feedback length limits (assigned by the owner on 4 Oct 2026; file not yet pushed) | reserved | reserved |
| 0227 | S3-21, unused table privileges and repo-parity function grants (assigned by the owner on 5 Oct 2026; file not yet pushed) | reserved | reserved |
| 0228 | S1, Talent Directory subscription activation as one atomic function (assigned by the owner on 5 Oct 2026; file 0228_activate_talent_directory_subscription, not yet pushed; applied to talentrah-preview at 10:40:49Z, ledger 20261005104049, per S3-21) | reserved | reserved; applied 10:40Z (5 Oct), file lands with its PR |
| 0229 | S3-21, the second revoke (revoke B) (assigned by the owner on 5 Oct 2026; file not yet pushed) | reserved | reserved |
| 0230 | S1, talent_directory_waitlist.notified_at and the reached-10 email (assigned by the owner on 5 Oct 2026; file not yet pushed) | reserved | reserved |
| 0231 | S3-21, column grants for the payment-token columns and the reviewer-payout columns (assigned by the owner on 5 Oct 2026; supabase/migrations/0231_payment_and_review_column_grants.sql, sha256 3cfcb8d70eee443f18eecf1a3e322d8ab929e21e9df430dfe48ec947b098a757; applied to talentrah-preview, ledger 20261005155553, and to production, ledger 20261006051647, both read back from the ledger by S3-21; production dry run, apply and post-check passed on 6 Oct, all approved by the owner by full hash; the file is in the 0231 PR) | applied 05:16Z (6 Oct), ledger 20261006051647 | applied 15:55Z (5 Oct), ledger 20261005155553 |
| 0232 | S3-21, column grants for the public internal-metadata columns (assigned by the owner on 5 Oct 2026; file not yet pushed) | reserved | reserved |
| 0233 | S1, the Founding Member verification offer: a grants table, an offer table and a claim function (assigned by the owner on 5 Oct 2026; file not yet pushed) | reserved | reserved |
| 0234 | S1, VERIFY-1 step 0a-2: review date and review type on `employer_job_applicants`, and review type on `talent_directory_search`; the score and the non-verified status are no longer returned to employers (assigned by the owner on 5 Oct 2026; `supabase/migrations/0234_review_date_and_type_on_applicants_and_search.sql`, sha256 `d07df1f270c8d6a9eadedaa7afcb81645c95decf818f3be01132cdb12456a99a`; applied with that hash on production and on preview, both read back from the ledger) | applied 11:02:25Z (6 Oct), ledger 20261006110225 | applied 09:53:07Z (6 Oct), ledger 20261006095307 |

The times are the ledger's own version stamps (UTC, 2 to 4 Oct 2026), read from `supabase_migrations.schema_migrations` on both projects. A row says "applied" only because
that ledger shows it; "reserved" means the owner assigned the number and no ledger has it; "proposed" means the owner named the number but the migration file does not exist yet.

(0205 to 0207 belong to the open draft PRs #661 and #662, and are not in the directory until those merge.) When a number is used, update this table in the PR that uses it. `tests/docs/database-environments.test.ts` fails if this heading or the table is deleted.

## 3. The order for a migration

The order is **talentrah-preview before production**, as one chain per migration. Every script in the chain is approved by the CTO or the owner **by its full sha256** in
`approvals/log.md` before it runs (a chat message does not count), is run once, and its raw output is saved verbatim. The SQL applied is the SQL in the PR, proven by
comparing a hash of it with the file's; the **same sha256** goes to both projects, and a changed file voids every approval for it.

| Step | Where | What runs | Gate | Recorded |
|---|---|---|---|---|
| 1 | talentrah-preview | A rolled-back dry run (`BEGIN … ROLLBACK`, or a single `DO` that always raises), with its own self-checks | The approver reads it in full; an approval line quotes its sha256 | Raw output saved verbatim |
| 2 | talentrah-preview | A hash-checked apply in one transaction with self-checks, then a read-only post-check, then a ledger read | One approval line per script, by full hash | Timestamp and sha256 in the PR that carries the migration |
| 3 | production | A rolled-back dry run built from production's own snapshot, with its own self-checks | The same: read in full, approved by full hash | Raw output saved verbatim |
| 4 | production | A hash-checked apply, then a read-only post-check, then a ledger read | One approval line per script, by full hash | The ledger version in the register row (section 2) |
| 5 | merge | The PR merges, with its head SHA pinned | Every required check green; for a migration PR, the production ledger read has passed (additive) or the deploy has completed (destructive) | A merge line in `approvals/log.md` |

- **talentrah-preview is never ahead of production for a migration whose production apply is not yet approved.** Preview is a rehearsal of a migration the owner is ready to apply
  to production, not a place to try one. Each apply is recorded with timestamp and sha256, in the PR that carries the migration. Branch-only or experimental changes never go there:
  Vercel builds every branch's preview against that one database, so one branch's unreviewed schema would make every other branch's preview disagree with its own code.
- Any other order (for example an urgent production fix that cannot wait for preview) is an exception: the CTO or the owner records it in `approvals/log.md`, naming the migration
  and the reason, before the apply. The 0224 and 0225 rows in section 2 are the history from the earlier rule, under which production came first.
- A migration whose PR is still open is fine once its production apply is approved.

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
