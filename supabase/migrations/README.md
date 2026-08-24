# Migrations

Until 0025, migrations were applied straight to the Supabase project (`nytwbbzfpytctjsoczzq`)
through the MCP connector and never written down here. The project's own
`supabase_migrations.schema_migrations` table is therefore the only complete
history — `list_migrations` reproduces it, `0001_extensions_and_enums` onward.

That is a real gap, not a convention: the schema is not in version control, so
a policy change cannot be code-reviewed in a diff, and a fresh project cannot
be rebuilt from this repo. `scripts/seed.ts` fills data, not structure.

This directory starts fixing it going forward. New migrations are written here
**first**, reviewed as part of the PR, and applied to the project after the SQL
itself has been read. Backfilling 0001–0025 out of the project is worth doing
before Phase 2, but it is a separate job from any one fix.

Naming follows the existing sequence: `NNNN_snake_case_description.sql`.

## Applying one

Via the Supabase MCP connector's `apply_migration` (name without the `.sql`
suffix), or `supabase db push` if the CLI is ever linked to the project.

| Migration | Applied to the project? |
|---|---|
| `0026_fix_org_membership_rls.sql` | applied 2026-08-24 |
