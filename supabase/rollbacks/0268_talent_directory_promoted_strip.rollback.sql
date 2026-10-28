-- ROLLBACK of 0268: the employer's Talent Directory search goes back to its 0234 definition (one list, boosted candidates first, then the review date; no section column), and the strip helper is dropped.
-- Nothing else was added by 0268, so nothing else is touched. The 0234 text below is copied from supabase/migrations/0234_review_date_and_type_on_applicants_and_search.sql; the tests compare it with that file.
-- The code that reads the `section` column (src/lib/talent-directory/queries.ts) ignores a missing column and reads it as "organic", but any page that LABELS the strip must be rolled back first, or it labels nothing.
-- Roll 0268 back BEFORE rolling 0266 back (the new search reads verification_marks). Run only on the owner's separate approval.

begin;

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
  review_type text
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
    select p.id, p.first_name, p.last_name, p.country,
           p.talent_available_for_hire, p.talent_remote_ready, p.talent_earliest_start_date,
           p.talent_verified_at,
           (select tv.review_type
            from public.talent_verifications tv
            where tv.user_id = p.id and tv.status = 'verified'
            order by tv.decided_at desc nulls last, tv.requested_at desc
            limit 1)
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

revoke all on function public.talent_directory_search(boolean, boolean, integer, integer, uuid) from public, anon;
grant execute on function public.talent_directory_search(boolean, boolean, integer, integer, uuid) to authenticated, service_role;

comment on function public.talent_directory_search(boolean, boolean, integer, integer, uuid) is
  'The paid Talent Directory search: candidates in talent_directory_listed_ids() (the only place the listing rule is written), for a member of an organisation with an active subscription. Returns the name, country, availability, remote-readiness, earliest start date, the date the resume was reviewed and who reviewed it (review_type, 0234: the stored review_type of the latest passed review, ai = Farah or human = a mentor, null if no passed review row exists). Never returns a review score (0234): no score reaches an employer.';

drop function public.talent_directory_promoted_ids(bigint, boolean, boolean, uuid[], integer);

commit;
