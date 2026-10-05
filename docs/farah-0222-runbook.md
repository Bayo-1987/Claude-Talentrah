# Migration 0222: grants on the two Farah history tables (runbook)

Files: `supabase/migrations/0222_farah_tables_server_only_writes.sql`, `supabase/rollbacks/0222_farah_tables_server_only_writes.rollback.sql`. The hosted scripts (preflight, dry run, apply wrapper, post-apply check, pre-merge check) are run only with the owner's approval of each exact file by sha256.

## Order

1. The route change that saves message history with the service role is merged and deployed: the latest production deployment is READY, its commit is the route merge or a descendant, its aliases include the production domains, and 5 minutes have passed since the alias switch (the default function duration is 300 seconds).
2. Preflight on each project. It is read-only, prints the server version, each table's exact ACL and owner, and fails closed if `data_api_grants_snapshot()` (migration 0193) is missing.
3. Dry run (rolled back on purpose). It prints the BEFORE state, the input the rollback is built from.
4. Build the exact rollback from the dry run's BEFORE output (`build-rollback.py`), review it against that output, then apply.
5. Apply with the hash-checked wrapper, then the post-apply check, then the pre-merge check before the 0222 PR merges.
6. Watch for 30 minutes: runtime logs for `Farah chat: saving the exchange failed`, and one real message from the owner's own account (expect two new rows).

## Rollback

Run the rollback only if the route change has itself been reverted, or if the watch in step 6 shows saves refused. Any rollback of the route deployment after 0222 is applied must be preceded by this rollback.

## MAINTAIN

The migration revokes six privileges (INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER). On PostgreSQL 17 and later there is also a MAINTAIN privilege, which 0222 does not revoke. The preflight prints `maintain_privilege_present` so the answer for each project is on record before the apply. The database-wide question (any table, any role) is handed to the security sweep (S3-21), not decided here.
