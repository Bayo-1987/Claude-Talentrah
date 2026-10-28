-- 0268: the employer's Talent Directory search shows a labelled "Promoted" strip of boosted candidates, and its ordinary list no longer has the boost anywhere in its order, which is now the newest earned mark date.
-- TWO functions: public.talent_directory_promoted_ids (new) and public.talent_directory_search (dropped and created again, because its result gains a column). No table, column, view, index, policy or trigger is added or changed.
--
-- TODAY (0234). talent_directory_search orders ONE list by (boost active) desc, then profiles.talent_verified_at desc. A seeker who paid for a boost is simply first, and a reader cannot tell paid placement from the
-- review that earned a place: both read as "first".
--
-- AFTER. The search returns two labelled sections in one result, in a column `section`:
--   'promoted'  at most 3 candidates who are in the directory (talent_directory_listed_ids(), the one place the listing rule is written) AND have a boost that has not expired AND match the filters. They are chosen by a
--               rotation that is fixed for one UTC hour (a refresh does not reshuffle) and moves every hour (more than 3 boosted candidates share the strip over time). Returned on the first page only, and for a
--               single-candidate lookup (p_candidate_id), which returns that candidate with the section they hold at that moment.
--   'organic'   every other listed candidate matching the filters, EXCLUDING the strip's candidates on every page (nobody appears twice), ordered by the NEWEST LIVE EARNED MARK DATE, newest first, then id. There is no
--               boost term anywhere in that order.
-- The organic order key is the newest earned_at among the candidate's marks that are still live (verification_marks and verification_mark_is_live, both from 0266). A listed candidate with no live mark (a profile that was
-- verified before the marks existed and has no row, or whose only mark has expired) is ordered by the review date the profile already holds (talent_verified_at), so nobody drops out of the order. The date RETURNED as
-- verified_at is still talent_verified_at, exactly as before, so no employer page changes except that the section is now available to it.
-- p_limit and p_offset apply to the organic list: the first page is the strip plus up to p_limit organic rows. The boost date is never returned.
--
-- A BOOST IS STILL NEVER A WAY IN. The strip reads the same gate as the list, so a boosted candidate who is not opted in, not verified, a QA account or deletion-requested appears in neither section (0137/0147's rule).
--
-- THE HELPER. talent_directory_promoted_ids(p_bucket, filters, p_only_ids, p_cap) returns the strip as (id, pos). The rotation bucket is an ARGUMENT, so the employer-callable search has no clock parameter (a caller cannot
-- choose the strip) and a test can ask for any bucket; the search passes floor(epoch / 3600). The cap is clamped to 3 whatever is asked. p_only_ids restricts the candidates (tests). SECURITY DEFINER, empty
-- search_path, service_role only.
--
-- DEPENDS ON 0266. The search now reads verification_marks, and a plpgsql body is not checked when it is created, so this file refuses to apply unless 0266 is there. Roll 0268 back BEFORE rolling 0266 back.
-- Privileges of the search are exactly 0234's: revoked from PUBLIC and anon, executable by authenticated and service_role; its entitlement check (an active, unexpired subscription in the caller's organisation) is unchanged.
-- The apply checks all of this itself and fails, keeping nothing, if it is not so. Rollback (restores the 0234 definition): supabase/rollbacks/0268_talent_directory_promoted_strip.rollback.sql.

do $needs_marks$
begin
  if to_regclass('public.verification_marks') is null
     or to_regprocedure('public.verification_mark_is_live(timestamptz, timestamptz)') is null then
    raise exception '0268 needs 0266 (public.verification_marks and public.verification_mark_is_live) to be applied first';
  end if;
end
$needs_marks$;

create or replace function public.talent_directory_promoted_ids(
  p_bucket bigint,
  p_remote_ready boolean default null,
  p_available_for_hire boolean default null,
  p_only_ids uuid[] default null,
  p_cap integer default 3
)
returns table (id uuid, pos integer)
language sql
stable
security definer
set search_path = ''
as $$
  select ranked.id, ranked.pos
  from (
    select p.id,
           (pg_catalog.row_number() over (order by pg_catalog.md5(p.id::text || ':' || p_bucket::text), p.id))::integer as pos
    from public.profiles p
    where p.id in (select l.id from public.talent_directory_listed_ids() as l(id))
      and p.talent_boosted_until is not null and p.talent_boosted_until > now()
      and (p_remote_ready is null or p.talent_remote_ready = p_remote_ready)
      and (p_available_for_hire is null or p.talent_available_for_hire = p_available_for_hire)
      and (p_only_ids is null or p.id = any (p_only_ids))
  ) ranked
  where ranked.pos <= least(greatest(coalesce(p_cap, 3), 0), 3)
  order by ranked.pos;
$$;

comment on function public.talent_directory_promoted_ids(bigint, boolean, boolean, uuid[], integer) is
  '0268: the Promoted strip: up to 3 (never more, whatever p_cap says) candidates who are in talent_directory_listed_ids() and hold a boost that has not expired, matching the filters, ranked by md5(id:bucket) so the order is fixed inside one bucket and rotates between buckets. Returns (id, pos). p_only_ids restricts the candidates (tests). service_role only; talent_directory_search calls it with the current UTC hour as the bucket.';

revoke all on function public.talent_directory_promoted_ids(bigint, boolean, boolean, uuid[], integer) from public, anon, authenticated;
grant execute on function public.talent_directory_promoted_ids(bigint, boolean, boolean, uuid[], integer) to service_role;

drop function if exists public.talent_directory_search(boolean, boolean, integer, integer, uuid);

create or replace function public.talent_directory_search(
  p_remote_ready boolean default null,
  p_available_for_hire boolean default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_candidate_id uuid default null
)
returns table (
  user_id uuid,
  first_name text,
  last_name text,
  country text,
  available_for_hire boolean,
  remote_ready boolean,
  earliest_start_date date,
  verified_at timestamp with time zone,
  review_type text,
  section text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.organization_members om
    join public.talent_directory_subscriptions s on s.organization_id = om.organization_id
    where om.user_id = auth.uid()
      and s.status = 'active'
      and s.expires_at > now()
  ) then
    return;
  end if;

  return query
    with strip as (
      select st.id, st.pos
      from public.talent_directory_promoted_ids(
             (pg_catalog.floor(extract(epoch from now()) / 3600))::bigint,
             p_remote_ready,
             p_available_for_hire
           ) as st(id, pos)
    ),
    base as (
      select p.id as cand_id, p.first_name as cand_first, p.last_name as cand_last, p.country as cand_country,
             p.talent_available_for_hire as cand_available, p.talent_remote_ready as cand_remote,
             p.talent_earliest_start_date as cand_start, p.talent_verified_at as cand_verified_at,
             (select tv.review_type
                from public.talent_verifications tv
               where tv.user_id = p.id and tv.status = 'verified'
               order by tv.decided_at desc nulls last, tv.requested_at desc
               limit 1) as cand_review_type,
             coalesce(
               (select max(m.earned_at)
                  from public.verification_marks m
                 where m.user_id = p.id
                   and public.verification_mark_is_live(m.expires_at, now())),
               p.talent_verified_at
             ) as cand_order_at
        from public.profiles p
       where p.id in (select l.id from public.talent_directory_listed_ids() as l(id))
         and (p_remote_ready is null or p.talent_remote_ready = p_remote_ready)
         and (p_available_for_hire is null or p.talent_available_for_hire = p_available_for_hire)
         and (p_candidate_id is null or p.id = p_candidate_id)
    ),
    organic_page as (
      select b.cand_id, b.cand_first, b.cand_last, b.cand_country, b.cand_available, b.cand_remote, b.cand_start,
             b.cand_verified_at, b.cand_review_type, b.cand_order_at
        from base b
       where b.cand_id not in (select st.id from strip st)
       order by b.cand_order_at desc nulls last, b.cand_id
       limit least(coalesce(p_limit, 20), 50)
      offset greatest(coalesce(p_offset, 0), 0)
    ),
    sections as (
      select b.cand_id, b.cand_first, b.cand_last, b.cand_country, b.cand_available, b.cand_remote, b.cand_start,
             b.cand_verified_at, b.cand_review_type, 'promoted'::text as sec, st.pos::bigint as seq
        from base b
        join strip st on st.id = b.cand_id
       where greatest(coalesce(p_offset, 0), 0) = 0 or p_candidate_id is not null
      union all
      select o.cand_id, o.cand_first, o.cand_last, o.cand_country, o.cand_available, o.cand_remote, o.cand_start,
             o.cand_verified_at, o.cand_review_type, 'organic'::text,
             pg_catalog.row_number() over (order by o.cand_order_at desc nulls last, o.cand_id)
        from organic_page o
    )
    select x.cand_id, x.cand_first, x.cand_last, x.cand_country, x.cand_available, x.cand_remote, x.cand_start,
           x.cand_verified_at, x.cand_review_type, x.sec
      from sections x
     order by (x.sec = 'organic'), x.seq;
end;
$$;

revoke all on function public.talent_directory_search(boolean, boolean, integer, integer, uuid) from public, anon;
grant execute on function public.talent_directory_search(boolean, boolean, integer, integer, uuid) to authenticated, service_role;

comment on function public.talent_directory_search(boolean, boolean, integer, integer, uuid) is
  'The paid Talent Directory search: candidates in talent_directory_listed_ids() (the only place the listing rule is written), for a member of an organisation with an active subscription. Returns the name, country, availability, remote-readiness, earliest start date, the date the resume was reviewed, who reviewed it (review_type, 0234) and section (0268): ''promoted'' for up to 3 boosted listed candidates (first page and single-candidate lookups only, rotated by the UTC hour, from talent_directory_promoted_ids) or ''organic'' for everyone else, who is never repeated from the strip and is ordered by the newest live earned mark date (verification_marks, 0266; the profile review date when a candidate has no live mark), newest first, with no boost term. limit and offset apply to the organic list. Never returns a review score (0234) or the boost date.';

-- Checks itself when it is applied: the apply fails, and nothing is kept, if anon, authenticated or PUBLIC can execute the helper, if service_role cannot, if the search lost its grants to authenticated and service_role or
-- gained one for anon or PUBLIC, if either function is not a SECURITY DEFINER with the empty search_path, or if the search does not return a section.
do $check$
declare
  v_helper oid := 'public.talent_directory_promoted_ids(bigint, boolean, boolean, uuid[], integer)'::regprocedure;
  v_search oid := 'public.talent_directory_search(boolean, boolean, integer, integer, uuid)'::regprocedure;
  v_fn oid;
  v_role name;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if pg_catalog.has_function_privilege(v_role, v_helper, 'execute') then
      raise exception '0268 self-check: % can execute %', v_role, v_helper::regprocedure;
    end if;
  end loop;
  if not pg_catalog.has_function_privilege('service_role', v_helper, 'execute') then
    raise exception '0268 self-check: service_role cannot execute %', v_helper::regprocedure;
  end if;
  if pg_catalog.has_function_privilege('anon', v_search, 'execute') then
    raise exception '0268 self-check: anon can execute %', v_search::regprocedure;
  end if;
  if not pg_catalog.has_function_privilege('authenticated', v_search, 'execute') or not pg_catalog.has_function_privilege('service_role', v_search, 'execute') then
    raise exception '0268 self-check: authenticated or service_role cannot execute %', v_search::regprocedure;
  end if;
  foreach v_fn in array array[v_helper, v_search] loop
    if exists (
      select 1
      from pg_catalog.aclexplode(coalesce(
        (select p.proacl from pg_catalog.pg_proc p where p.oid = v_fn),
        pg_catalog.acldefault('f', (select p.proowner from pg_catalog.pg_proc p where p.oid = v_fn))
      )) a
      where a.grantee = 0
    ) then
      raise exception '0268 self-check: PUBLIC can execute %', v_fn::regprocedure;
    end if;
    if not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_fn) then
      raise exception '0268 self-check: % is not SECURITY DEFINER', v_fn::regprocedure;
    end if;
    if (select p.proconfig from pg_catalog.pg_proc p where p.oid = v_fn) is distinct from array['search_path=""'] then
      raise exception '0268 self-check: % does not have an empty search_path', v_fn::regprocedure;
    end if;
  end loop;
  if pg_catalog.pg_get_function_result(v_search) not like '%section text%' then
    raise exception '0268 self-check: % does not return a section', v_search::regprocedure;
  end if;
end
$check$;
