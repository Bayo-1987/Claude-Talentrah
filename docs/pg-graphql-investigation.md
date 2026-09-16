# pg_graphql exposure — investigated, no fix currently exists

Prompted by Supabase's security advisor flagging 46 tables each under
`pg_graphql_anon_table_exposed` / `pg_graphql_authenticated_table_exposed`. The
approved remediation turned out to be unexecutable by any tool a project owner
has on hosted Supabase. This is the record of why, so a future session doesn't
re-spend the same effort re-discovering the same wall.

## Headline

**The concern is real but low-severity (schema discoverability, not data
exposure), and the specific fix the founder approved — a GraphQL-only revoke,
reversible with one `GRANT` — cannot actually be executed by `postgres`, the
role every project-owner tool (Supabase MCP connector, SQL Editor, CLI
migrations) connects as.** Confirmed independently twice, by two different
methods, on two different databases. No migration was merged. Two diagnostic
migration files exist only in an unpushed local branch/worktree
(`fix/pg-graphql-exposure-hardening`); a small number of scratch entries this
investigation created in `dozaffzgqkbarxtlclsj`'s migration ledger have been
removed (production was never touched — see below).

## The original concern

Any table reachable via a normal RLS-gated `SELECT` is also visible in the
auto-generated GraphQL schema at `/graphql/v1` — table/column names, and the
auto-generated `insertInto*`/`update*`/`deleteFrom*` mutation names. Verified
live before treating this as low-severity: querying `credit_ledgerCollection`
and `profilesCollection` over `/graphql/v1` with the anon key returns
`{"edges": []}` — RLS gates rows identically over GraphQL as over REST.
`job_postingsCollection` correctly returns real rows to anon, because job
postings for a verified org are intentionally public (0027) and the same rows
are already served by `/rest/v1/job_postings`. So GraphQL adds schema-shape
discoverability on top of REST, not a new way to read row data REST already
protects.

Three independent checks, all negative, before any fix was attempted:

1. Exhaustive repo grep: zero references to `/graphql/v1`, no GraphQL client
   library, no hand-rolled GraphQL query anywhere in this codebase.
2. The founder checked their own email/correspondence: no trace of any
   external integration ever wired to `/graphql/v1`.
3. A direct query of Supabase's edge logs: zero requests to any graphql path
   in the available ~24-hour retention window.
4. Production's `graphql.resolve` / `graphql`+`graphql_public` schema ACLs are
   byte-identical to dev's (queried directly, see below) — this isn't a
   dev-specific quirk, so there's no scenario where retrying against
   production would behave differently.

## Why the approved fix doesn't work

The founder's decision, given the 0027 precedent (a well-intentioned grant
cleanup breaking the public REST surface for signed-out visitors): don't drop
the `pg_graphql` extension — instead revoke the specific grant(s) that make
`/graphql/v1` answer requests at all, since that's trivially reversible.

Supabase's own documented remediation for these two advisor findings offers
three options. The first two ("revoke SELECT/ALL on the table from
anon/authenticated") are **not actually GraphQL-scoped** — PostgREST's REST
surface and pg_graphql's GraphQL surface both authorize against the exact same
table-level grant for the exact same role. Revoking a table's `SELECT` from
`anon` to clear its GraphQL finding would also break that table's `/rest/v1/`
route for every signed-out visitor — 0027's own lesson, aimed at GraphQL
instead of REST. Ruled out on that basis alone, without needing to try it.

The third option — revoke `EXECUTE` on `graphql.resolve(text, jsonb, text,
jsonb)`, the one function every `/graphql/v1` request calls to do anything —
**is** genuinely scoped to GraphQL only: REST never calls this function, so
this revoke cannot touch a single REST-facing grant or policy, by
construction. This is the one that was actually attempted.

### What actually happened, verified against the catalog directly (not inferred from a tool's "success" response)

```sql
-- graphql.resolve's ACL, queried directly on dozaffzgqkbarxtlclsj:
select p.proacl from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'graphql' and p.proname = 'resolve';

-- {=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X/supabase_admin,
--  anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}
```

`revoke execute on function graphql.resolve(text, jsonb, text, jsonb) from
anon, authenticated, public;` was applied to `dozaffzgqkbarxtlclsj`. It
reported success. Re-reading the ACL immediately afterward showed it
**byte-for-byte unchanged** — this is exactly the "a clean result is not proof
of anything" failure mode this repo's own CLAUDE.md warns about, caught here
only by re-querying the catalog rather than trusting the tool's response.

A second attempt tried the schema level instead of the function level —
revoking `USAGE` on the `graphql` / `graphql_public` schemas (the actual entry
points `/graphql/v1` routes through). Same result: reported success, ACL
unchanged.

```sql
-- graphql / graphql_public schema ACLs, queried directly on dozaffzgqkbarxtlclsj:
select nspname, nspacl from pg_namespace where nspname in ('graphql', 'graphql_public');

-- graphql_public: {supabase_admin=UC/supabase_admin,postgres=U*/supabase_admin,
--                   anon=U/supabase_admin,authenticated=U/supabase_admin,service_role=U/supabase_admin}
-- graphql:        {supabase_admin=UC/supabase_admin,postgres=U*/supabase_admin,
--                   anon=U/supabase_admin,authenticated=U/supabase_admin,service_role=U/supabase_admin}
```

`anon`/`authenticated` still hold `USAGE`, granted directly by
`supabase_admin`, on both databases — identical ACLs on `dozaffzgqkbarxtlclsj`
and `nytwbbzfpytctjsoczzq`.

**One nuance the diagnostic migration's own comment got wrong, worth recording
so it isn't re-tried on the same mistaken reasoning:** the schema ACL shows
`postgres=U*/supabase_admin` — the trailing `*` marks `postgres` as holding
`USAGE` **with grant option** on these schemas. The original hypothesis was
that this would let `postgres` revoke the same privilege from `anon`/
`authenticated` too. It doesn't. Postgres's actual `REVOKE` authorization rule
is: the revoking role must own the object, be a superuser, or **itself be the
grantor of that specific grant**. Holding grant option on your own,
separately-issued privilege lets you *issue new grants as yourself* (which you
could then revoke) — it does not retroactively let you revoke a *different,
already-existing* grant that a different role (`supabase_admin`) issued
directly to `anon`/`authenticated`. The empirical result (ACL unchanged)
matches this corrected understanding, not the original comment's optimistic
one.

### Root cause

```sql
-- postgres's own role membership, queried directly:
select r.rolname, r.rolsuper,
  (select array_agg(m.rolname) from pg_auth_members am
     join pg_roles m on m.oid = am.roleid where am.member = r.oid) as member_of
from pg_roles r where r.rolname = 'postgres';

-- rolsuper: false
-- member_of: {pg_monitor,pg_signal_backend,pg_read_all_data,pg_create_subscription,
--             anon,authenticated,service_role,authenticator,supabase_privileged_role}
-- (no supabase_admin)
```

`graphql.resolve`, the `graphql`/`graphql_public` schemas, and `pg_graphql`
itself (`pg_extension.extowner`) are all owned by the platform-reserved
`supabase_admin` role. `postgres` — the role every project-owner tool connects
as — is not a member of `supabase_admin`, cannot `SET ROLE supabase_admin`
("permission denied to set role"), and is not the grantor of any of
`anon`/`authenticated`'s grants on these objects. Per the rule above, its
`REVOKE` against those grants silently drops zero rows instead of erroring —
indistinguishable from success unless the catalog is re-checked, which is
exactly what caught it.

**This means Supabase's own documented "Option 3" is not executable through
any tool a project owner has on hosted Supabase** — not a limitation of this
repo's tooling specifically.

## What was and wasn't touched

- **Production (`nytwbbzfpytctjsoczzq`): never touched.** Confirmed via
  `supabase_migrations.schema_migrations` — zero rows matching `%graphql%`.
- **Dev (`dozaffzgqkbarxtlclsj`):** two diagnostic migrations applied
  (`0159_pg_graphql_endpoint_lockdown`, `0163_pg_graphql_schema_usage_lockdown`),
  both confirmed genuine no-ops with zero lasting schema effect, plus a
  scratch-table control test (`0163b`/`0163c`) proving the same `REVOKE`
  mechanism works normally when `postgres` *is* the grantor — the negative
  result above is the mechanism failing specifically on `supabase_admin`-owned
  objects, not the mechanism being broken generally. All four ledger rows for
  these have been removed from dev's `supabase_migrations.schema_migrations`
  (by `version`, the table's actual primary key — the documented precedent for
  this from 0122's own history), since they never represented real, mergeable
  schema changes and their number prefixes (`0159`, `0163`) collided with two
  unrelated real migrations already reserved by other concurrent work
  (`0159_atomic_fulfillment_credit_pack_pass`, PR #399;
  `0163_atomic_referral_reward_grant`, PR #403 as renamed). No `DROP EXTENSION`,
  table grant, RLS policy, or REST-facing anything was ever touched by any of
  this.
- The two migration *files* (not the ledger rows) still exist, for the record,
  on the unpushed local branch `fix/pg-graphql-exposure-hardening`
  (`.claude/worktrees/pg-graphql-hardening` at the time of writing) — not
  merged, not pushed, not a candidate PR. Delete that worktree once this
  document is the reference instead.

## Options left for the founder — not decided here

1. **Revisit dropping the extension outright**, now that zero live usage is
   confirmed by four independent methods (repo grep, correspondence check,
   edge logs, and this investigation's own live queries).
2. **A joint per-table REST+GraphQL revoke** for the small subset of the 46
   tables that should genuinely be unreachable via either API for a given
   role. Most of the 46 are intentionally REST-public, so this addresses a
   narrower problem than "GraphQL is specifically over-exposed."
3. **A Supabase support ticket** asking them to apply the function/schema
   revoke with `supabase_admin` privilege on the project's behalf — the
   closest match to what was originally asked for (the reversible, minimal-
   blast-radius fix), since it defers any irreversible decision and this
   finding carries no live risk on the clock.

If anything breaks with a "GraphQL"/`graphql/v1` error somewhere unexpected in
the next few weeks, that is the fastest way an infrequent external caller
neither the edge logs nor the founder's memory caught would surface. There is
nothing to revoke as a rollback, since nothing was successfully revoked.
