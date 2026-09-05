# Migrations

Migrations 0001–0025 were applied straight to the Supabase project
(`nytwbbzfpytctjsoczzq`) through the MCP connector and were never written down
here. The project's own `supabase_migrations.schema_migrations` table is the
only record that they happened; `list_migrations` reproduces the list.

That was a real gap, not a convention: with no SQL in the repo, a policy change
could not be reviewed in a diff, and a fresh project could not be rebuilt from
this repo at all. It is how `organization_members` carried a privilege
escalation and a self-recursive policy for the whole of Phase 1 without either
ever appearing in a code review.

**[`0000_baseline_schema.sql`](0000_baseline_schema.sql) closes that going
forward.** It is a snapshot of the live schema — tables, indexes, functions,
grants, triggers, RLS and every policy — reconstructed from the catalog as of
2026-08-25. It is not a migration to run against the existing project; it is
the diff baseline, and the way to stand up a fresh database. Read its header
before relying on it: it is faithful to structure, not byte-exact to pg_dump,
because there is no Postgres connection string in this repo and the Supabase
CLI is not installed here.

Backfilling 0001–0025 individually is a separate job and may never be worth
doing. The goal here is that every *future* change is reviewable.

## Working rule

Write the SQL into this directory **first**, review it in the PR, then apply
it. Naming continues the existing sequence: `NNNN_snake_case_description.sql`.

**Take the number from what exists at that moment, not from what you remember.**
`0060` was claimed twice in one morning — `0060_admin_identity` and
`0060_course_recommendations`, written on separate branches that each read the
directory before the other landed. Neither author did anything careless; the
number was simply free when each of them looked.

    ls supabase/migrations/*.sql | sed 's|.*/||' | cut -c1-4 | sort | tail -1

Re-check it immediately before opening the PR, not when starting the branch —
the gap between those two is where a collision fits. If you lose the race,
renumbering after an apply is survivable (see 0061's header) but leaves the
filename disagreeing with `schema_migrations` forever.

## Applying one

Via the Supabase MCP connector's `apply_migration` (pass the name without the
`.sql` suffix), or `supabase db push` if the CLI is ever linked to the project.

| Migration | Status |
|---|---|
| `0000_baseline_schema.sql` | snapshot only — describes the project as it already is; do **not** run it against it |
| `0026_fix_org_membership_rls.sql` | applied 2026-08-24 |
| `0027_gate_internal_postings_on_org_verification.sql` | applied 2026-08-25 |
| `0028_lock_organization_verification.sql` | applied 2026-08-25 |
| `0029_org_application_counts.sql` | applied 2026-08-25 |
| `0030_lock_profile_value_columns.sql` | applied 2026-08-25 |
| `0031_lock_derived_user_tables.sql` | applied 2026-08-25 |
| `0032_fix_anon_execute_grants.sql` | applied 2026-08-25 |
| `0033_auto_apply.sql` | applied 2026-08-25 |
| `0034_auto_apply_claim.sql` | applied 2026-08-25 (re-applied after the alias fix) |
| `0035_atomic_credit_spend.sql` | applied 2026-08-25 |
| `0036_self_referral_dot_normalisation.sql` | applied 2026-08-25 |
| … | this table stopped being updated at 0036; 0037–0059 were applied as they landed |
| `0060_admin_identity.sql` | applied 2026-08-28 to **both** projects — production `nytwbbzfpytctjsoczzq` and CI `dozaffzgqkbarxtlclsj` |
| `0061_course_recommendations.sql` | applied 2026-08-29 to **both** projects — recorded in `schema_migrations` under its pre-rename name, `0060_course_recommendations` (see the file's header) |
| `0062_course_recommendation_seed.sql` | applied 2026-08-29 to **both** projects. Recovers the nine catalog rows 0061's applied form inserted and its committed form omitted; idempotent, so it inserted nothing on production/CI and only records that the repo accounts for them |
| `0063_course_recommendations_inactive.sql` | applied 2026-08-29 to **both** projects — switches the nine placeholder rows off so a fresh database matches the two real ones. See *The course catalog ships switched OFF* below |
| `0064_moderation_attribution.sql` | applied 2026-08-29 to **both** projects |
| `0065_feedback_triage.sql` | applied 2026-08-29 to **both** projects — row added after the fact; it was missing while 0064 and 0066 were listed, which reads as a gap rather than as an omission |
| `0066_farah_hint_dismissed.sql` | applied 2026-08-29 to CI and to production the same day (`schema_migrations` version 20260829155210 — verified, not assumed). Adds `profiles.farah_hint_dismissed_at` and grants UPDATE on it, widening 0030's column list by one. See the file header for why that column is safe to grant, and `tests/rls/column-privileges.test.ts` for the assertion that it did not widen anything else |
| `0067_operator_credential_events.sql` | applied to **both** projects — production version 20260830132631. Row added 2026-08-30 after the fact: it was absent from this table while 0066 and 0068 were listed. Note it was applied to production *after* 0068 was, which is what being missed and backfilled looks like in the ledger |
| `0068_admin_mfa.sql` | applied to **both** projects — production version 20260830093748. Row added 2026-08-30 after the fact, same as 0067 above |
| `0069_invalidate_match_scores_on_jd_change.sql` | applied 2026-08-30 to **CI only** while its PR is in review — production on merge. Adds an AFTER UPDATE trigger on `job_postings` that clears cached `match_scores` when `structured_jd` or `seniority` changes |
| `0071_drop_admin_mfa.sql` | applied to **both** projects — recorded as `drop_admin_mfa_0071` on each, and `admin_users.mfa_enrolled_at` is confirmed absent from both. Row added here by a different PR's author than the migration's, because the table is only useful if it is complete; see #143 for why admin MFA was removed rather than left half-on |
| `0072_resume_skills_notice_dismissed.sql` | applied 2026-08-30 to **CI only** while its PR is in review — production on merge. Adds `profiles.resume_skills_notice_dismissed_at` and grants UPDATE on it, widening 0030's column list by one. A second column rather than a reuse of 0066's, so dismissing the Farah nudge does not also hide the notice saying a resume cannot be scored |

## The course catalog ships switched OFF

`course_recommendations` holds nine AltSchool rows whose `affiliate_url`s are
placeholders (`?ref=talentrah-placeholder`), not real affiliate codes. The
catalog is therefore inactive everywhere, including in any database built from
this repo: `0063_course_recommendations_inactive.sql` is what guarantees that.

    production nytwbbzfpytctjsoczzq   9 rows, 0 active
    CI         dozaffzgqkbarxtlclsj   9 rows, 0 active
    fresh env from migrations         9 rows, 0 active

Nothing is deleted — the rows and their URLs are intact and only the flag is
off. `recommendCoursesForGapAnalysis` filters on `active`, so the
recommendations block is simply absent, which M1 and M2 both already treat as
the correct answer rather than a degraded one.

**RE-ENABLING IS STILL ONE STATEMENT, NOT A MIGRATION.** When real affiliate
codes replace the placeholders (§10 item 1), the catalog goes live with:

```sql
update public.course_recommendations set active = true;
```

No migration and no redeploy. 0063 settles only what a database that has never
seen that statement starts as; it does not govern turning the catalog back on,
and re-running migrations on a database where someone has enabled it will not
switch it off again — an applied migration does not run twice.

### How it got this way, since the databases moved before the repo did

Recorded because it happened, and because a database state that no artifact
explains is the thing this file exists to prevent.

On 2026-08-29, immediately before PR #107 put the recommendations UI on main,
all nine rows were switched off by hand, directly against both projects:

```sql
update public.course_recommendations set active = false;
```

Both projects were confirmed to hold exactly 9 rows, all active, BEFORE that
unqualified UPDATE ran, so it could not touch anything unintended. It was done
as data rather than schema specifically to keep re-enabling free of a
redeploy.

That left a gap for about an hour: `0062` inserts the nine rows without naming
`active`, so it takes 0061's `default true`, and a fresh database would have
come up with the placeholder catalog **live** while both real environments were
dark — the exact outcome the UPDATE was run to prevent, reachable by anyone
standing up a new project. `0063` closes it, scoped to
`affiliate_url like '%ref=talentrah-placeholder%'` rather than repeating the
bare UPDATE, so it cannot switch off a real curated offer that a later
environment holds.

## Checking whether a migration actually landed

```bash
npm run audit-migrations          # prints a query; run it via the MCP connector
npm run audit-migrations -- --list
```

`0066_farah_hint_dismissed` sat committed-but-unapplied on production for
hours. Its code shipped, the column was never created, and the feature did
nothing on the live site. It went unnoticed because there was no diff anyone
could run and believe — this table holds three naming conventions on
production, and on CI it is missing 25 rows for schema that is demonstrably
present, so a naive comparison drowns one real gap in eleven false ones.

The script encodes the rules that make the comparison mean something:

| status | meaning |
| --- | --- |
| `applied` | name matches the file exactly |
| `applied without its numeric prefix` | applied through the connector with a bare name — 0049–0057 |
| `applied under a documented alias` | a mismatch that was decided, not missed — see `KNOWN_ALIASES` in the script, each entry with its own reasoning |
| `MISSING` | **the ledger is silent** |

**A fourth wrinkle, found while landing this check itself.**
`0096_migration_status_reader` reached production on 2026-09-05 through the
MCP connector, hand-applied ahead of its own PR merging — the same shape of
gap this table exists to catch, caught here only because production was
queried directly (function body compared byte-for-byte against the file,
not just the ledger row's name) rather than assumed clean. `0094` and `0095`
were applied to production afterwards, in their own turn. Because a
migration's `version` is a timestamp assigned when it's applied, not when
its file is written, this means the ledger's application order and the
repo's file order now diverge on production **permanently** — reordering
history to match isn't a thing you do after the fact. Say plainly: the
drift check compares migration NAMES against the ledger, not their order,
so this divergence does not affect it. Recorded here so a future reader of
the out-of-order ledger concludes "known, harmless, explained" rather than
"the check must be broken."

## Catching it automatically on production

`0093_resume_builder_start_events` landed with #215, was applied to the CI
project as part of building that PR, and was never applied to production —
the PR description said "production untouched, migrates on merge," and the
merge itself carries no such step, because there is no automated production
migration mechanism in this repo at all. It sat unrecorded until the
founder's own direct query against production caught it, by which point two
more migrations were already queued behind it.

`scripts/check-migration-drift.ts` is the automated version of the audit
above, run by `.github/workflows/migration-drift.yml` on every push to `main`
**and once a day**. The daily run matters as much as the push trigger: drift
appears AFTER a merge, so a push-only check only catches it on whatever the
next push happens to be — merge on a Friday, next push Monday, and the gap
is invisible all weekend. GitHub emails the repository's watchers when a
scheduled run fails, which is the actual point of running this daily rather
than relying on a log line nobody is looking at — that's exactly the failure
mode behind 0066, 0067, 0068 and 0093 above.

It is the one script in this repo that reaches production directly rather
than through the Supabase MCP connector — CI has no connector and no human to
hand a query to. It calls `public.list_applied_migrations()` (migration
0096) over HTTPS, a `SECURITY DEFINER` function in `public` — the same
pattern this project already uses to reach something the caller's own role
can't see directly (`promoted_jobs`, `internal_applicant_counts`,
`delete_resume_with_snapshot`), since `supabase_migrations` isn't a schema
PostgREST exposes.

**An earlier version of this connected directly to Postgres instead, and hit
a real platform wall worth recording.** A `migration_auditor` role scoped to
`SELECT` on exactly `supabase_migrations.schema_migrations`, reached over
Supavisor's transaction-mode pooler — correct in principle (GitHub Actions
runners are IPv4-only; the direct connection is IPv6-only without the paid
add-on) but it never connected: authenticating as a custom role through
hosted Supabase's shared pooler failed with `"(ENOTFOUND) tenant/user ...
not found"`, reproduced 8 times over 2 minutes, not propagation lag. HTTPS
has neither the pooler problem nor the IPv4 problem, and `migration_auditor`
is dropped in 0096.

**The JWT this authenticates with is not a dedicated Postgres role either,
and that's a second platform wall, not a design choice.** The original plan
was exactly that — a role reachable only by its own pre-signed JWT.
`grant <new_role> to authenticator` is refused for a project's own owner on
hosted Supabase ("authenticator is a reserved role, only superusers can
modify it"): custom PostgREST-reachable roles are not something this
platform lets a project provision for itself. `list_applied_migrations`
resolves the JWT to `role: anon` instead (the only role PostgREST can
actually switch it into) and checks a SECOND, custom claim
(`purpose: "migration-status-reader"`) inside the function body, rejecting
every other caller — including a plain request bearing only the public anon
key — with a 403. This is Supabase's own documented pattern for exactly this
shape of problem (the Data API guide's "Use additional API keys" section).
The practical result is what a dedicated role was meant to buy: only a
caller holding this specific JWT gets data back. See 0096's own migration
for the full account — read it before assuming the `grant ... to anon` line
in that file means what it looks like it means.

Three repository secrets, minted and set once: `MIGRATION_STATUS_PROJECT_URL`
(not actually secret, just production's URL), `MIGRATION_STATUS_APIKEY`
(production's own anon/publishable key — required by Supabase's gateway
alongside the JWT, grants nothing here on its own), and
`MIGRATION_STATUS_JWT` (minted with `scripts/mint-migration-status-jwt.ts`,
which must be run locally with the project's JWT secret — no MCP tool
exposes that secret, deliberately, and only the resulting token should ever
reach this repository).

The workflow runs on `push` to `main`, on a daily schedule, and via
`workflow_dispatch` — deliberately not on `pull_request`: a migration
committed in a PR has not been applied to production yet BY DESIGN (write the
SQL, review it, apply it after merge), so checking on every PR would fail
every migration-bearing PR for the reason this exists to catch, not a defect
in it.

It PRINTS SQL rather than connecting, for two reasons. PostgREST does not
expose the `supabase_migrations` schema, so a service-role client cannot read
it without adding a `public` wrapper function — real schema surface for a
housekeeping query. And production is the project that most needs auditing,
where CLAUDE.md requires the connector precisely so no credential lands on
disk. Generating SQL needs no credential and audits either project.

**`MISSING` does not mean the change is absent.** It means nothing recorded it.
Check for the schema itself — the table, column, function or grant — before
concluding a migration never ran: a project restored from a snapshot rather
than replayed has the schema *without* the record, which is exactly the state
CI is in for 0026–0050.

### CI carries two dead rows from 0071, and they are not pending work

CI's ledger holds three rows for one migration:

| version | name | in the repo? |
| --- | --- | --- |
| `20260830145707` | `drop_admin_mfa` | no — a premature apply |
| `20260830150946` | `restore_admin_mfa_column_pending_pr143` | no — undoing that |
| `20260830182130` | `drop_admin_mfa_0071` | yes — `0071_drop_admin_mfa.sql` |

**Only the third is real. The first two cancel out and nothing is pending.**
Verified after the fact: `mfa_enrolled_at` is absent from `admin_users` on
both projects, which is the state `0071` asks for. Production has only the
third row.

The first two exist because `0071` was applied to CI **before** its PR merged,
following the usual apply-to-CI-first habit. That habit is right for an
additive migration and wrong for a destructive one: main and four open
branches still contained `tests/rls/admin-mfa.test.ts`, which asserts on the
column, so the drop turned all of them red for reasons unrelated to their own
changes. The column was restored, the branches went green, and `0071` was
applied properly once #143 merged and deleted the test with it.

**The rule that generalises:** a migration that REMOVES something can only be
applied once nothing still running expects it — and on a shared CI database,
"nothing still running" includes every other open branch, not just yours. On
production it also includes the currently-deployed build, so a destructive
migration waits for the deploy that stops reading the column. `0071` was
applied to production only after the deploy of `4103037` was confirmed serving
(the `/admin/login` page no longer renders the code field).

Left in place rather than deleted, for the reason immediately below: an applied
migration is history, and a row that records a mistake is worth more than a
tidy ledger that hides one.

The ledger is deliberately NOT rewritten to tidy any of this. An applied
migration is history: 0060 kept its colliding number because its header carries
an md5 of the recorded statements, 0061 documents its own name mismatch as
cosmetic and deliberate, and 0062 exists because editing an applied migration
was refused. The problem was never that the record is untidy — it is that
nothing could read it.

Last verified 2026-08-29: production reports **zero** MISSING across all 41
committed migrations.

Both projects, not one. CLAUDE.md allows them to diverge while a PR is in
review — apply to CI, apply to production on merge — but 0060 is additive
(three new tables and one function, nothing existing altered), and the app
cannot be exercised against either project without it. Check both before
assuming a table or function exists.

## Still missing

There is no separate test or staging database. Every suite — the RLS tests,
Playwright, `npm run seed` — runs against this one project, which is also
production. The suites namespace and clean up their own throwaway users, but
that is a convention, not an isolation boundary. `0000_baseline_schema.sql`
makes a second project buildable; standing one up is the next step.

*(That paragraph predates the CI project, which now exists —
`dozaffzgqkbarxtlclsj`. See CLAUDE.md for what is and is not isolated.)*
