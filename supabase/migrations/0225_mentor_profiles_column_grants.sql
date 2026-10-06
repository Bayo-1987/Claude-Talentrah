-- 0225: mentor_profiles column privileges, explicit per-column SELECT grants (the 0218 pattern).
--
-- WHAT. SELECT on public.mentor_profiles is no longer granted on the whole table to anon and authenticated. authenticated is granted SELECT on the eleven columns the app's
-- own session-client reads, the row policies and the policies on other tables actually use; anon is granted none (it has no policy on this table and no public reader: public
-- pages use definer functions or the service role). The remaining nine columns are readable only through the service role (server code). Row policies are unchanged.
--
--   granted to authenticated (11): user_id, status, self_paused, display_name, bio, expertise_roles, expertise_industries, expertise_seniority, years_experience, base_price_ngn, reviews_verifications
--   not granted (9): applied_at, reviewed_at, reviewed_by, review_note, payout_bank_code, payout_account_number, payout_account_name, payout_recipient_code, payout_bank_verified_at
--
-- WHY THESE ELEVEN. Every one is used by a session-client read (browse, the mentor page, the mentor's own application page), by the table's own row policies (user_id, status,
-- self_paused), or by a policy on another table that reads this one with the caller's privileges (mentor_availability_slots: user_id, status, self_paused; mentorship_reviews: user_id,
-- status). Functions that read the table are SECURITY DEFINER and run with their owner's privileges, so they are unaffected.
--
-- CONSEQUENCES. select * on this table now fails 42501 for the API roles, and so does a RETURNING of one of the nine columns; a column added later is unreadable until a migration grants
-- it (tests/rls/mentor-profiles-column-grants.test.ts holds that). UPDATE and INSERT grants are untouched. anon's INSERT, UPDATE and DELETE grants are NOT touched here (they wait for the
-- broader revoke). The service role is unaffected. Code that read the nine columns through the session client reads them on the server instead (this migration ships with, or after, that change).

revoke select on public.mentor_profiles from authenticated, anon;
grant select (user_id, status, self_paused, display_name, bio, expertise_roles, expertise_industries, expertise_seniority, years_experience, base_price_ngn, reviews_verifications) on public.mentor_profiles to authenticated;

-- Self-check: the migration fails (and rolls back) unless every live column is in the intended state for each role.
do $check$
declare
  c record;
  withheld constant text[] := array['applied_at', 'reviewed_at', 'reviewed_by', 'review_note', 'payout_bank_code', 'payout_account_number', 'payout_account_name', 'payout_recipient_code', 'payout_bank_verified_at'];
  upd constant text[] := array['base_price_ngn', 'bio', 'display_name', 'expertise_industries', 'expertise_roles', 'expertise_seniority', 'reviews_verifications', 'self_paused', 'years_experience'];
  col text;
begin
  for c in select a.attname::text as col from pg_attribute a where a.attrelid = 'public.mentor_profiles'::regclass and a.attnum > 0 and not a.attisdropped loop
    if has_column_privilege('anon', 'public.mentor_profiles', c.col, 'SELECT') then
      raise exception 'mentor_profiles grants: anon can still read %', c.col;
    end if;
    if c.col = any (withheld) then
      if has_column_privilege('authenticated', 'public.mentor_profiles', c.col, 'SELECT') then
        raise exception 'mentor_profiles grants: authenticated can still read % (a withheld column)', c.col;
      end if;
    elsif not has_column_privilege('authenticated', 'public.mentor_profiles', c.col, 'SELECT') then
      raise exception 'mentor_profiles grants: authenticated cannot read % (a live column missing from the grant list)', c.col;
    end if;
    if not has_column_privilege('service_role', 'public.mentor_profiles', c.col, 'SELECT') then
      raise exception 'mentor_profiles grants: service_role lost SELECT on %', c.col;
    end if;
  end loop;
  foreach col in array upd loop
    if not has_column_privilege('authenticated', 'public.mentor_profiles', col, 'UPDATE') then
      raise exception 'mentor_profiles grants: authenticated lost UPDATE on %', col;
    end if;
  end loop;
end
$check$;
