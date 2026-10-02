-- 0204: a scholarship closes at an INSTANT, not on a date.
--
-- THE PROBLEM. `scholarships.application_deadline` is a bare date, and "open" was decided nine different ways against it: `>= today`
-- in the sitemap, in the landing-page loaders, in the facet-count RPC (0185), `> today` in ingest's auto-publish and the deadline
-- alerts, a calendar-day `daysUntil` for every countdown on the cards, and so on. "Today" meant the SERVER's UTC date, so a programme
-- that closes "6 Oct, 13:00 Pacific" was shown open for hours after it had closed and, for a Lagos reader, closed hours early. The
-- sources do state zones (Stanford "Pacific Time", ETH "CET", AGU "Moscow Time"), we just had nowhere to put them.
--
-- THE RULE (owner's call, S3-21a):
--   close_tz + close_time known .... closes at that wall-clock time in that IANA zone
--   close_tz known, no time ........ closes at the END of that day in that zone
--   neither known .................. closes at the end of the day at UTC-12 (the last place on Earth to end that day), and the
--                                    UI says "time zone not stated, apply a day early"
-- "Open" means now < the closing instant: at the closing instant itself it is closed.
--
-- WHAT THIS ADDS (additive: nothing existing is dropped or altered in meaning for old code):
--   1. close_time (time) and close_tz (text, IANA), both optional, next to application_deadline. A time without a zone is refused
--      (a clock time with no zone is the ambiguity this exists to remove), and the zone must be a real IANA name.
--   2. scholarship_close_instant(deadline, time, tz): THE definition. Everything below calls it; src/lib/scholarships/close-instant.ts
--      is its TypeScript twin and tests/scholarships/close-instant-parity.test.ts holds the two equal.
--   3. scholarship_is_open(deadline, time, tz, now): "open" in one place.
--   4. close_at: the instant, stored by a trigger, ONLY because PostgREST filters (the sitemap, the landing-page loaders, the list
--      page) cannot call a function. Derived, never written by a client, and tests/scholarships/close-at-matches-function.test.ts
--      asserts close_at = scholarship_close_instant(...) for every row.
--   5. scholarship_landing_facet_counts_at(p_now): 0185's counts through scholarship_is_open. The old date-argument function is
--      LEFT IN PLACE (production's code still calls it until this ships) and dropped in a later migration.
--
-- BACKFILL. Every existing row has no zone, so close_at becomes deadline + 1 day at 12:00Z: open for up to 12 hours longer than the old
-- UTC-date rule, never shorter. That is the owner's rule working as intended, and it can only add listings at the boundary, never
-- remove one, so no landing page can fall below LANDING_PAGE_MIN_ENTRIES because of it.

-- 1. Columns ------------------------------------------------------------------------------------------------------------------------
alter table public.scholarships
  add column close_time time,
  add column close_tz text,
  add column close_at timestamptz;

alter table public.scholarships
  add constraint scholarships_close_time_needs_tz check (close_time is null or close_tz is not null);

comment on column public.scholarships.close_time is
  'Optional wall-clock closing time in close_tz (0204). Without close_time the programme closes at the end of the deadline day in close_tz (or at UTC-12 when close_tz is also null).';
comment on column public.scholarships.close_tz is
  'Optional IANA time zone the closing time is stated in, e.g. America/Vancouver (0204). Validated by scholarships_set_close_at().';
comment on column public.scholarships.close_at is
  'DERIVED by scholarships_set_close_at() from application_deadline, close_time and close_tz = scholarship_close_instant(...). Exists only so PostgREST filters can compare an instant; never written by a client (0204).';

-- 2. The definition -----------------------------------------------------------------------------------------------------------------
create or replace function public.scholarship_close_instant(p_deadline date, p_close_time time, p_close_tz text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when p_deadline is null then null
    -- an explicit wall-clock time in an explicit zone
    when p_close_tz is not null and p_close_time is not null then (p_deadline + p_close_time) at time zone p_close_tz
    -- a zone but no time: the end of that day there is the start of the next
    when p_close_tz is not null then ((p_deadline + 1)::timestamp) at time zone p_close_tz
    -- no zone: the end of the day at UTC-12 ('Etc/GMT+12' is UTC-12: the POSIX-style sign is inverted)
    else ((p_deadline + 1)::timestamp) at time zone 'Etc/GMT+12'
  end
$$;

comment on function public.scholarship_close_instant(date, time, text) is
  'The instant a scholarship closes (0204). Open means now < this. TypeScript twin: src/lib/scholarships/close-instant.ts; tests/scholarships/close-instant-parity.test.ts holds them equal.';

create or replace function public.scholarship_is_open(p_deadline date, p_close_time time, p_close_tz text, p_now timestamptz default now())
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_deadline is null or p_now < public.scholarship_close_instant(p_deadline, p_close_time, p_close_tz)
$$;

comment on function public.scholarship_is_open(date, time, text, timestamptz) is
  'Whether a scholarship is open at p_now (0204): no deadline recorded means open; otherwise p_now is strictly before its closing instant.';

-- 3. close_at, kept by a trigger ----------------------------------------------------------------------------------------------------
create or replace function public.scholarships_set_close_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- close_tz must be a real IANA name (pg_timezone_names), not a POSIX string or an abbreviation that would silently mean something else.
  if new.close_tz is not null and not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = new.close_tz) then
    raise exception 'close_tz % is not an IANA time zone name', new.close_tz using errcode = '22023';
  end if;
  new.close_at := public.scholarship_close_instant(new.application_deadline, new.close_time, new.close_tz);
  return new;
end;
$$;

create trigger scholarships_set_close_at
  before insert or update of application_deadline, close_time, close_tz
  on public.scholarships
  for each row execute function public.scholarships_set_close_at();

-- Backfill every existing row (all have no zone: deadline + 1 day at 12:00Z).
update public.scholarships
   set close_at = public.scholarship_close_instant(application_deadline, close_time, close_tz);

create index scholarships_close_at_idx on public.scholarships (close_at);

-- 4. The landing-page counts, through the one definition ---------------------------------------------------------------------------
create or replace function public.scholarship_landing_facet_counts_at(p_now timestamptz)
returns table (
  fully_funded_count bigint,
  bsc_count bigint,
  msc_count bigint,
  phd_count bigint,
  postgraduate_diploma_count bigint,
  other_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*) filter (where funding_type = 'full') as fully_funded_count,
    count(*) filter (where degree_levels @> array['bsc']::public.scholarship_degree_level[]) as bsc_count,
    count(*) filter (where degree_levels @> array['msc']::public.scholarship_degree_level[]) as msc_count,
    count(*) filter (where degree_levels @> array['phd']::public.scholarship_degree_level[]) as phd_count,
    count(*) filter (
      where degree_levels @> array['postgraduate_diploma']::public.scholarship_degree_level[]
    ) as postgraduate_diploma_count,
    count(*) filter (where degree_levels @> array['other']::public.scholarship_degree_level[]) as other_count
  from public.scholarships
  where moderation_status = 'verified'
    and public.scholarship_is_open(application_deadline, close_time, close_tz, p_now);
$$;

comment on function public.scholarship_landing_facet_counts_at(timestamptz) is
  '0185''s landing-page counts with "still open" decided by scholarship_is_open at p_now (0204). Replaces scholarship_landing_facet_counts(date), which is left in place until production no longer calls it.';

grant execute on function public.scholarship_close_instant(date, time, text) to anon, authenticated, service_role;
grant execute on function public.scholarship_is_open(date, time, text, timestamptz) to anon, authenticated, service_role;
grant execute on function public.scholarship_landing_facet_counts_at(timestamptz) to anon, authenticated, service_role;
