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
