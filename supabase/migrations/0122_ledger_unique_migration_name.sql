-- 0122: make the migration ledger reject a second apply of the same NAME.
--
-- ── WHAT THIS PREVENTS ────────────────────────────────────────────────────
--
-- On 2026-09-08 two sessions applied 0118/0119 minutes apart. Postgres
-- handled the DDL correctly — the second session's 0119 was refused with
-- 42701 (column already exists) and recorded no row. But its 0118 was
-- `alter type ... add value if not exists`, genuinely idempotent, so it
-- SUCCEEDED as a no-op and inserted a second ledger row named
-- 0118_job_review_permission. Two rows, same name, different versions,
-- deleted by hand afterwards.
--
-- The reason a duplicate NAME was possible at all: this table's primary key
-- is `version`, not `name`, and every applier mints its own timestamp
-- version. Two applies of one migration are therefore two distinct primary
-- keys as far as Postgres is concerned.
--
-- ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────
--
-- This is a BACKSTOP, not the fix. It cannot prevent the failure that
-- actually reached users — code deploying ahead of its migrations — which is
-- an ordering problem and is addressed by the apply-before-merge convention
-- in docs/production-migration-apply.md. All this does is turn a silent
-- duplicate into a loud 23505.
--
-- It also only catches re-applying the SAME NAME. Two different migrations
-- racing are unaffected, and correctly so.
--
-- ── WHY THIS IS SAFE FOR `supabase db push` / `db reset` ──────────────────
--
-- Checked rather than assumed: the repo can never contain two migration
-- files sharing a name, because names carry the four-digit prefix and
-- ci.yml's `migration-collisions` job (#294) already fails the build on a
-- duplicate NUMBER. So a fresh `db reset` against supabase/migrations/
-- inserts distinct names by construction.
--
-- The honest caveat: `supabase_migrations` is a Supabase-managed schema, so
-- a future platform change could drop or conflict with this index. That is
-- why it is `if not exists` and why the convention, not this index, is the
-- actual mechanism.
--
-- NULL names are unaffected — Postgres permits unlimited NULLs in a unique
-- index, and `list_applied_migrations()` (0096) already filters them out.

create unique index if not exists schema_migrations_name_key
  on supabase_migrations.schema_migrations (name);

-- ── PROVE IT REJECTS A DUPLICATE, rather than trusting that it exists ─────
--
-- An index that is present but not enforcing what you think looks identical
-- to one that is. This inserts a row deliberately colliding with an existing
-- name inside a subtransaction and requires the insert to fail with
-- unique_violation. If it somehow succeeds, the probe row is removed and the
-- migration aborts — which rolls the whole thing back, index included,
-- rather than leaving a guard that does not guard.
do $$
declare
  probe_name text;
  probe_version constant text := '99999999999999';
  unexpectedly_inserted boolean := false;
begin
  select name into probe_name
  from supabase_migrations.schema_migrations
  where name is not null
  order by version
  limit 1;

  if probe_name is null then
    raise exception
      'no named migration row to probe against; refusing to claim this index was verified.';
  end if;

  begin
    insert into supabase_migrations.schema_migrations (version, name)
    values (probe_version, probe_name);
    unexpectedly_inserted := true;
  exception
    when unique_violation then
      -- Expected: this is the whole point of the migration.
      null;
  end;

  if unexpectedly_inserted then
    delete from supabase_migrations.schema_migrations where version = probe_version;
    raise exception
      'the unique index on schema_migrations(name) did NOT reject a duplicate name (%). The guard is not working.',
      probe_name;
  end if;
end $$;
