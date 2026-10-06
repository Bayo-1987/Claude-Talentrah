# Rollbacks

Each file here is the exact undo for the migration with the same number, kept outside `supabase/migrations/` so nothing that reads migrations can see it (see `tests/scripts/rollbacks-directory.test.ts`).
The README is not a migration or a rollback and is not read by any check.

## Migrations that have no rollback

| Migration | Why there is none |
|---|---|
| 0221 `job_postings_insert_policy_definition` | It sets the WITH CHECK of one policy to the definition production already has, so on production it changes nothing (it is recorded in the ledger as a no-op). On a database built from the repository it adds one condition; the previous definition is the one written in 0114, which lacks one condition that production's already has. |

Add a row here when a migration is intentionally left without a rollback, with the reason.
