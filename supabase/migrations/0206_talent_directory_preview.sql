-- 0206 — Talent Directory free preview: one gate, an anonymised count and sample cards (EMP-1 / E1).
--
-- ── THE PROBLEM ─────────────────────────────────────────────────────────────
-- Production, measured read-only on 2026-10-02: ONE opted-in, verified candidate out of 16 profiles, zero active subscriptions. An
-- employer is asked to pay ₦200,000 a month (talent_directory_plans, 0135) for a search that returns one person. The employer page now
-- (a) shows the live count of listed candidates and up to three ANONYMISED sample cards, and (b) below TALENT_DIRECTORY_MIN_LISTED (10)
-- hides Subscribe and offers the waitlist (0205). This migration is the database half of (a).
--
-- ── ONE DEFINITION OF "LISTED" ──────────────────────────────────────────────
-- The gate (opted in AND verified, both, always: 0135's own header) was copied into talent_directory_search twice (0135, then 0147). A
-- free preview needs the SAME gate. A preview that counts or shows someone the paid search would not is a privacy hole that gets sold as
-- a feature, and a third copy of the predicate is a third place to forget an edit. So the predicate now lives in exactly one function,
-- talent_directory_listed_ids(), and every reader calls it: the paid search (re-created below, nothing else about it changes), the
-- preview, the count the Server Action uses to refuse a purchase. tests/talent-directory/gate-single-definition.test.ts fails if a later
-- migration restates the predicate in any of them; tests/rls/talent-directory-preview.test.ts checks every profile state end to end.
--
-- 0135's header says the two employer-facing functions "repeat the SAME verified+opt-in WHERE clause independently rather than sharing a
-- view, so neither can be reached by forgetting the other's guard". That reasoning was about not sharing a VIEW: a view is exposed through
-- PostgREST and gets Supabase's default grants to anon and authenticated. A SECURITY DEFINER function with its EXECUTE revoked from every
-- client role has none of that exposure: only the other definer functions (which run as the owner) and the service role can reach it.
-- talent_directory_portfolio_items (0135) and the contact-request policy (0155) still carry their own copy of the predicate; they are
-- untouched here (a smaller blast radius for this change) and are the obvious next two to fold in.
--
-- "Suspended" is not a state of this gate: profiles carry no suspension flag. What can sit short of 'verified' is 'unverified',
-- 'pending' or 'rejected', and the tests seed all three.
--
-- ── RE-IDENTIFICATION: THE RULES, AND WHY THEY LIVE HERE ────────────────────
-- A "sample card" built from the one real candidate's role, skills and years is that person's profile with the name removed. Anyone who
-- knows them recognises it. An employer's session can call this RPC directly, so a filter in the page would protect nothing: every rule
-- below is enforced inside the function, k-anonymity with k = 3:
--   1. Fewer than 3 listed candidates: the count, and NO samples.
--   2. Role is a coarse family (Engineering, Design, ...) derived from the latest job title; the title is never returned. A family is
--      named only if at least 3 listed candidates share it, else the card says "Professional".
--   3. Years of experience are a band (0-2, 3-5, 6-9, 10+), never a number. Computed from the earliest start year on the resume, so it is
--      "since first listed role", an upper bound on time worked; a band is coarse enough that this is acceptable and it is labelled
--      "years" not "years in role".
--   4. Skills: only a skill carried by at least 3 listed candidates' base resumes, lower-cased and trimmed, at most 4 per card. A skill
--      only one person has is the most identifying line on a resume and is never shown.
--   5. Availability: two booleans. No name, photo, employer, contact detail, location, id.
--   6. At most 3 cards, chosen by md5(id), not by recency (recency would reveal who joined last).
-- Every value on a card except the years band and the two booleans is therefore shared by 3 or more people in the pool. The years band
-- and the booleans are low-cardinality by construction. What this does NOT defeat: someone who already knows exactly one person in a
-- 3-person pool and what family, band and availability they have could infer which card is theirs. At a pool of 3 that is the floor of
-- what k = 3 means; it is why the Subscribe threshold (10) is higher than the sample floor (3).
--
-- ── WHO MAY CALL WHAT ───────────────────────────────────────────────────────
-- talent_directory_preview() is the only new function a signed-in user can execute, and it answers only members of some organisation
-- (anyone else gets NULL). It is an aggregate plus anonymised cards, so unlike the search it does not require a subscription: that is the
-- point of a preview. Every other new function is revoked from public, anon AND authenticated and granted to service_role only.
--
-- talent_directory_preview_for(p_ids) is the derivation, taking the pool as an argument and intersecting it with the listed set (it can
-- never show an unlisted id even when handed one). That split exists so the rules above can be tested against a controlled pool instead
-- of "everyone listed right now", which other test files change concurrently.
--
-- Additive (new functions) plus a re-creation of talent_directory_search with an unchanged signature, result shape, entitlement check and
-- ORDER BY. Apply BEFORE merging (supabase/migrations/README.md).

-- ── the gate ────────────────────────────────────────────────────────────────
create or replace function public.talent_directory_listed_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where p.talent_directory_opt_in = true
    and p.talent_verification_status = 'verified'
$$;

create or replace function public.talent_directory_listed_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.talent_directory_listed_ids()
$$;

-- ── pure helpers ────────────────────────────────────────────────────────────
create or replace function public.talent_directory_years_band(p_years integer)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_years is null or p_years < 0 or p_years > 60 then null
    when p_years <= 2 then '0-2'
    when p_years <= 5 then '3-5'
    when p_years <= 9 then '6-9'
    else '10+'
  end
$$;

-- The first family whose pattern matches wins, so the order is a decision: Design before Product ("Product Designer"), Data before
-- Engineering ("Data Engineer"), Customer before Operations ("Customer Operations"). A title that matches nothing is NULL, which the
-- preview shows as "Professional" rather than guessing.
create or replace function public.talent_directory_role_family(p_title text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_title is null or btrim(p_title) = '' then null
    when lower(p_title) ~ '(design|\mux\M|\mui\M|creative|illustrat|graphic)' then 'Design'
    when lower(p_title) ~ '(\mdata\M|analyt|machine learning|\mml\M|scientist|statistic|business intelligence)' then 'Data'
    when lower(p_title) ~ '(engineer|developer|programmer|software|devops|\msre\M|back-?end|front-?end|full.?stack|architect)' then 'Engineering'
    when lower(p_title) ~ 'product' then 'Product'
    when lower(p_title) ~ '(marketing|growth|\mseo\M|content|brand|social media|copywrit|communications)' then 'Marketing'
    when lower(p_title) ~ '(\msales\M|business development|account (executive|manager))' then 'Sales'
    when lower(p_title) ~ '(financ|accountant|accounting|audit|\mtax\M|treasury|bookkeep)' then 'Finance'
    when lower(p_title) ~ '(\mhr\M|human resources|recruit|talent|people (partner|operations|ops))' then 'People'
    when lower(p_title) ~ '(customer|support|\mclient\M|success)' then 'Customer'
    when lower(p_title) ~ '(operations|logistics|supply chain|procurement|project manager|programme|program manager|administrat|office manager)' then 'Operations'
    else null
  end
$$;

-- ── the derivation: anonymised count + cards for a given pool ───────────────
create or replace function public.talent_directory_preview_for(p_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c_k constant integer := 3;            -- k-anonymity floor: pool size for any card, holders for any skill, members for any named family
  c_max_samples constant integer := 3;
  c_max_skills constant integer := 4;
  v_count integer;
  v_samples jsonb;
begin
  select count(*)::integer into v_count
  from public.talent_directory_listed_ids() as l(id)
  where l.id = any(coalesce(p_ids, '{}'::uuid[]));

  if v_count < c_k then
    return jsonb_build_object('count', v_count, 'samples', '[]'::jsonb);
  end if;

  with pool as (
    select l.id
    from public.talent_directory_listed_ids() as l(id)
    where l.id = any(p_ids)
  ),
  base as (
    select pool.id,
           p.talent_available_for_hire as available,
           p.talent_remote_ready as remote,
           (select r.structured_content
              from public.resumes r
             where r.user_id = pool.id and r.is_base
             order by r.updated_at desc
             limit 1) as sc
    from pool
    join public.profiles p on p.id = pool.id
  ),
  derived as (
    select b.id, b.available, b.remote,
           public.talent_directory_role_family(
             case when jsonb_typeof(b.sc -> 'experience') = 'array' then b.sc -> 'experience' -> 0 ->> 'title' end
           ) as family,
           public.talent_directory_years_band((
             select extract(year from now())::integer - min(((regexp_match(e ->> 'startDate', '((?:19|20)\d\d)'))[1])::integer)
             from jsonb_array_elements(
                    case when jsonb_typeof(b.sc -> 'experience') = 'array' then b.sc -> 'experience' else '[]'::jsonb end
                  ) as e
             where jsonb_typeof(e) = 'object' and (e ->> 'startDate') ~ '(19|20)\d\d'
           )) as years_band
    from base b
  ),
  skills as (
    select distinct b.id, lower(btrim(e #>> '{}')) as skill
    from base b
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(b.sc -> 'skills') = 'array' then b.sc -> 'skills' else '[]'::jsonb end
    ) as e
    where jsonb_typeof(e) = 'string'
      and length(btrim(e #>> '{}')) between 2 and 30
  ),
  common as (
    select s.skill, count(*) as holders
    from skills s
    group by s.skill
    having count(*) >= c_k
  ),
  fam as (
    select d.family, count(*) as members
    from derived d
    where d.family is not null
    group by d.family
  ),
  picked as (
    select d.*, coalesce(case when f.members >= c_k then d.family end, 'Professional') as role
    from derived d
    left join fam f on f.family = d.family
    order by md5(d.id::text)
    limit c_max_samples
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'role', pk.role,
               'yearsBand', pk.years_band,
               'skills', (
                 select coalesce(jsonb_agg(k.skill order by k.holders desc, k.skill), '[]'::jsonb)
                 from (
                   select s.skill, c.holders
                   from skills s
                   join common c on c.skill = s.skill
                   where s.id = pk.id
                   order by c.holders desc, s.skill
                   limit c_max_skills
                 ) k
               ),
               'availableForHire', pk.available,
               'remoteReady', pk.remote
             )
             order by md5(pk.id::text)
           ),
           '[]'::jsonb
         )
    into v_samples
  from picked pk;

  return jsonb_build_object('count', v_count, 'samples', v_samples);
end;
$$;

-- ── the one function an employer's session may call ─────────────────────────
create or replace function public.talent_directory_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not exists (select 1 from public.organization_members om where om.user_id = auth.uid()) then
    return null;
  end if;

  return public.talent_directory_preview_for(
    array(select l.id from public.talent_directory_listed_ids() as l(id))
  );
end;
$$;

-- ── the paid search: same signature, result, entitlement and ordering; only the predicate moved ──
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
  verification_score integer,
  verified_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public
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
    select p.id, p.first_name, p.last_name, p.country,
           p.talent_available_for_hire, p.talent_remote_ready, p.talent_earliest_start_date,
           p.talent_verification_score, p.talent_verified_at
    from public.profiles p
    where p.id in (select l.id from public.talent_directory_listed_ids() as l(id))
      and (p_remote_ready is null or p.talent_remote_ready = p_remote_ready)
      and (p_available_for_hire is null or p.talent_available_for_hire = p_available_for_hire)
      and (p_candidate_id is null or p.id = p_candidate_id)
    order by (p.talent_boosted_until is not null and p.talent_boosted_until > now()) desc,
             p.talent_verified_at desc
    limit least(coalesce(p_limit, 20), 50)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ── grants ──────────────────────────────────────────────────────────────────
revoke all on function public.talent_directory_listed_ids() from public, anon, authenticated;
grant execute on function public.talent_directory_listed_ids() to service_role;

revoke all on function public.talent_directory_listed_count() from public, anon, authenticated;
grant execute on function public.talent_directory_listed_count() to service_role;

revoke all on function public.talent_directory_years_band(integer) from public, anon, authenticated;
grant execute on function public.talent_directory_years_band(integer) to service_role;

revoke all on function public.talent_directory_role_family(text) from public, anon, authenticated;
grant execute on function public.talent_directory_role_family(text) to service_role;

revoke all on function public.talent_directory_preview_for(uuid[]) from public, anon, authenticated;
grant execute on function public.talent_directory_preview_for(uuid[]) to service_role;

revoke all on function public.talent_directory_preview() from public, anon;
grant execute on function public.talent_directory_preview() to authenticated;

-- re-stated, as 0147 did, because the function was replaced
revoke all on function public.talent_directory_search(boolean, boolean, integer, integer, uuid) from public, anon;
grant execute on function public.talent_directory_search(boolean, boolean, integer, integer, uuid) to authenticated;
