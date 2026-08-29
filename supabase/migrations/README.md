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
| `0066_farah_hint_dismissed.sql` | applied 2026-08-29 to **CI only** while its PR is in review — production on merge. Adds `profiles.farah_hint_dismissed_at` and grants UPDATE on it, widening 0030's column list by one. See the file header for why that column is safe to grant, and `tests/rls/column-privileges.test.ts` for the assertion that it did not widen anything else |

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
| `applied under a documented alias` | a mismatch that was decided, not missed. Only 0061, whose header explains it |
| `MISSING` | **the ledger is silent** |

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
