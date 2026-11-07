-- 0278 (JOBS-POLISH-1, item P5): job_postings.expires_at_source, whether a posting's closing date was STATED by someone or only filled in by us.
--
-- WHY. `expires_at` holds two different things: a deadline an employer, a sheet or a source actually gave ("stated"), and the 30-day lifetime we apply when nobody gave one ("default"). Showing
-- "Closes 10 Nov 2026" for the second kind tells a seeker a date no employer chose. The cards and the job page show a closing date ONLY where this column says 'stated'; expiry behaviour itself
-- (what closes a posting, and when) is not touched by this file or by the code that reads the column.
--
-- Values: 'stated' | 'default' | NULL. NULL means there is no closing date (expires_at is null), or a writer has not set it yet; the app treats NULL as "not stated" and shows nothing.
--
-- WRITERS (set by the server, after this applies; none is called by this file): the sheet importer ('stated' only when the sheet gave a deadline, else 'default'), ingest ('stated' when the source gave a
-- validThrough, else NULL), and the employer's own server actions. An employer's own date is stated; the 30-day default an employer leaves in place is 'default'. job_postings.closing_date_source (0207) already
-- records that distinction for employer rows ('chosen' / 'default'); this column is the one every kind of posting has, so the display reads one column.
--
-- BACKFILL, once. Where job_postings.closing_date_source (0207) is present it decides ('chosen' -> stated, 'default' -> default). Where it is null, the rule the owner set: a non-null expires_at within 29 days 23 hours .. 30 days 1 hour of created_at is the default lifetime ('default'); any other non-null expires_at is 'stated'.
-- It is a heuristic and errs the safe way: a stated deadline that happens to fall exactly 30 days after posting is hidden, never a default shown as if it were stated. Rows with no expires_at stay NULL.
-- The backfill is an UPDATE, so job_postings' update triggers are evaluated for every row it touches. The two AFTER UPDATE ones are conditional on structured_jd / seniority / status changes, which it does not make;
-- the BEFORE UPDATE ones (removal, supersession, and the guard below) act only on changes to their own columns or on client roles, and this runs as the migration owner.
--
-- READ: job_postings is readable by explicit column grant (0218), so a new column is NOT readable by anon or authenticated until a migration says so. This one is public by design (it is shown on public cards and the
-- public job page); tests/rls/job-postings-column-grants.test.ts fails without the grant.
-- WRITE: no client UPDATE grant exists for it (UPDATE is revoked at table level, 0056, and no column grant covers it). INSERT is a table-level grant to authenticated (0177, 0246), so a BEFORE INSERT OR UPDATE guard
-- trigger, the shape 0207 used for closing_date_source, refuses a client that carries a value in. The INSERT policy is deliberately NOT touched (0277 changes it; keeping the two migrations apart keeps them mergeable).
--
-- Additive. Applied BEFORE the code that reads it merges (supabase/migrations/README.md, "When to apply, relative to merging").

-- Fail fast instead of queueing behind a long query on this table: the migration is retried, not waited for.
set local lock_timeout = '3s';

alter table public.job_postings
  add column if not exists expires_at_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'job_postings_expires_at_source_check' and conrelid = 'public.job_postings'::regclass
  ) then
    alter table public.job_postings
      add constraint job_postings_expires_at_source_check check (expires_at_source in ('stated', 'default'));
  end if;
end $$;

comment on column public.job_postings.expires_at_source is
  'Whether expires_at was stated by someone (employer, sheet deadline, source validThrough) or is the default lifetime we applied: ''stated'' | ''default'' | NULL (no closing date, or not yet recorded). The app shows a closing date only for ''stated''. Written only by the server.';

grant select (expires_at_source) on public.job_postings to anon, authenticated;

create or replace function public.job_postings_guard_expires_at_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.expires_at_source is not null then
        raise exception 'expires_at_source is server-managed' using errcode = '42501';
      end if;
    elsif new.expires_at_source is distinct from old.expires_at_source then
      raise exception 'expires_at_source is server-managed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.job_postings_guard_expires_at_source() from public, anon, authenticated;

drop trigger if exists job_postings_guard_expires_at_source on public.job_postings;
create trigger job_postings_guard_expires_at_source
  before insert or update on public.job_postings
  for each row execute function public.job_postings_guard_expires_at_source();

-- The backfill rule, as a function, so the rule the owner set is ONE definition that the UPDATE below uses and the DB-proof spec can call at its boundaries. Pure (no table access) and service-role only.
create or replace function public.expires_at_source_backfill(p_expires_at timestamptz, p_created_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_expires_at is null then null
    when p_expires_at - p_created_at between interval '29 days 23 hours' and interval '30 days 1 hour' then 'default'
    else 'stated'
  end;
$$;

revoke execute on function public.expires_at_source_backfill(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.expires_at_source_backfill(timestamptz, timestamptz) to service_role;

-- Which source a row gets: where closing_date_source (0207) is present it decides ('chosen' is stated, 'default' is default), because it recorded what the server actually did; the window rule above is
-- the fallback ONLY where closing_date_source is null (imported and ingested rows, and employer rows from before 0207). One function so the DB-proof spec can call exactly what the UPDATE uses.
create or replace function public.expires_at_source_resolve(p_closing_date_source text, p_expires_at timestamptz, p_created_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_closing_date_source
    when 'chosen' then 'stated'
    when 'default' then 'default'
    else public.expires_at_source_backfill(p_expires_at, p_created_at)
  end;
$$;

revoke execute on function public.expires_at_source_resolve(text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.expires_at_source_resolve(text, timestamptz, timestamptz) to service_role;

-- Backfill (see the header). Only rows that have a date and no source yet, so a second run changes nothing.
update public.job_postings
set expires_at_source = public.expires_at_source_resolve(closing_date_source, expires_at, created_at)
where expires_at is not null
  and expires_at_source is null;

-- Guard: the column and its check exist, both API roles can read it and neither can UPDATE it, the guard trigger is in place, and the backfill left no dated row without a source.
do $$
declare
  v_type text;
  v_missing bigint;
begin
  select data_type into v_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'job_postings' and column_name = 'expires_at_source';
  if v_type is distinct from 'text' then
    raise exception '0278: job_postings.expires_at_source is missing or not text (found %)', coalesce(v_type, 'no column');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.job_postings'::regclass and conname = 'job_postings_expires_at_source_check'
  ) then
    raise exception '0278: the check job_postings_expires_at_source_check is missing';
  end if;

  if not has_column_privilege('anon', 'public.job_postings', 'expires_at_source', 'SELECT')
     or not has_column_privilege('authenticated', 'public.job_postings', 'expires_at_source', 'SELECT') then
    raise exception '0278: anon and authenticated must be able to SELECT job_postings.expires_at_source (the column grant is missing)';
  end if;

  if has_column_privilege('anon', 'public.job_postings', 'expires_at_source', 'UPDATE')
     or has_column_privilege('authenticated', 'public.job_postings', 'expires_at_source', 'UPDATE') then
    raise exception '0278: no client may UPDATE job_postings.expires_at_source';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.job_postings'::regclass and tgname = 'job_postings_guard_expires_at_source' and not tgisinternal
  ) then
    raise exception '0278: the guard trigger job_postings_guard_expires_at_source is missing';
  end if;

  select count(*) into v_missing from public.job_postings where expires_at is not null and expires_at_source is null;
  if v_missing <> 0 then
    raise exception '0278: % row(s) have an expires_at and no expires_at_source after the backfill', v_missing;
  end if;
end
$$;
