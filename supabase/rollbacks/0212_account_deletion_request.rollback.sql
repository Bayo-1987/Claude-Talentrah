-- ROLLBACK for 0212 (account deletion, PR 1). Not a migration: it is the exact undo, kept beside the file it undoes so it is reviewed in the same diff
-- and so nobody has to reconstruct it under pressure. Run it as `postgres` in the SQL Editor, in ONE transaction (it is written to be). To keep what the
-- schema ledger says honest, record it as a NEW migration (do not delete 0212's ledger row). `supabase/rollbacks/` is outside supabase/migrations, so
-- neither the migration-numbering check nor `supabase db push` ever sees it.
--
-- HOW: it is generated from the same patch table as the migration, with every anchor and replacement swapped, and it patches the LIVE definitions the
-- same way (each replacement must be found exactly once, or it stops). So it removes only what 0212 added, and keeps any change that landed since.
-- ORDER MATTERS: first every function and policy 0212 patched loses its predicate (so nothing refers to the flag or the helpers any more), then the new
-- functions go, then the table and the column.
--
-- WHAT IT DESTROYS: the `account_deletions` table (every deletion request on record) and the `profiles.deletion_requested_at` flag. If anyone has
-- confirmed a deletion, that person's account stops being hidden the moment this runs and their Auto-Apply and renewals stay cancelled. Check
-- `select count(*) from public.account_deletions where status = 'scheduled'` first; if it is not zero, decide what to do about them before running.
--
-- PROVEN, not assumed: in one rolled-back transaction against the live catalogue, the definitions captured before 0212 are compared with the ones after
-- 0212 + this file, and must be identical (the output is in the PR body).

begin;

-- The two helpers below live in pg_temp: they exist for this migration's own session only and leave nothing behind.
--
-- patch_fn takes a function's CURRENT definition from the catalogue (pg_get_functiondef), replaces each anchor with its replacement, and recreates it.
-- Every anchor must be found EXACTLY once or the whole migration fails, and a pair whose replacement is already there is skipped (so re-running is
-- harmless). Because it patches what is live at the moment it runs, it cannot revert a change that landed in between, and the function keeps its
-- SECURITY DEFINER setting, its pinned search_path and its grants (CREATE OR REPLACE keeps the ACL; the header comes from the live definition).
create or replace function pg_temp.patch_fn(p_sig text, p_pairs text[]) returns void
language plpgsql as $patch$
declare
  v_oid oid := to_regprocedure(p_sig);
  v_def text;
  v_new text;
  v_cnt integer;
  i integer;
begin
  if v_oid is null then raise exception '0212: function % not found', p_sig; end if;
  v_def := pg_get_functiondef(v_oid);
  v_new := v_def;
  i := 1;
  while i <= array_length(p_pairs, 1) loop
    if position(p_pairs[i + 1] in v_new) = 0 then
      v_cnt := (length(v_new) - length(replace(v_new, p_pairs[i], ''))) / length(p_pairs[i]);
      if v_cnt <> 1 then
        raise exception '0212: anchor % found % times in % (it must be found exactly once)', quote_literal(p_pairs[i]), v_cnt, p_sig;
      end if;
      v_new := replace(v_new, p_pairs[i], p_pairs[i + 1]);
    end if;
    i := i + 2;
  end loop;
  if v_new <> v_def then execute v_new; end if;
end
$patch$;

-- patch_policy does the same for one SELECT policy's USING expression, found by the start of its name (Postgres truncates long policy names, and
-- one of these ends in a space, so the name is read from pg_policies rather than retyped).
create or replace function pg_temp.patch_policy(p_table regclass, p_like text, p_from text, p_to text) returns void
language plpgsql as $patch$
declare
  v_name text;
  v_qual text;
  v_new text;
  v_cnt integer;
begin
  select policyname, qual into v_name, v_qual from pg_policies
   where schemaname = 'public' and tablename = (select c.relname from pg_class c where c.oid = p_table) and cmd = 'SELECT' and policyname like p_like;
  if v_name is null then raise exception '0212: no SELECT policy like % on %', p_like, p_table; end if;
  if position(p_to in v_qual) > 0 then return; end if;
  v_cnt := (length(v_qual) - length(replace(v_qual, p_from, ''))) / length(p_from);
  if v_cnt <> 1 then raise exception '0212: anchor % found % times in the % policy', quote_literal(p_from), v_cnt, p_table; end if;
  v_new := replace(v_qual, p_from, p_to);
  execute format('alter policy %I on %s using (%s)', v_name, p_table, v_new);
end
$patch$;

select pg_temp.patch_fn($x$public.talent_directory_listed_ids()$x$, array[
    $x$and p.talent_verification_status = 'verified'
    and p.deletion_requested_at is null$x$,
    $x$and p.talent_verification_status = 'verified'$x$
  ]);
select pg_temp.patch_fn($x$public.talent_directory_portfolio_items(uuid)$x$, array[
    $x$and p.talent_verification_status = 'verified'
      and p.deletion_requested_at is null$x$,
    $x$and p.talent_verification_status = 'verified'$x$
  ]);
select pg_temp.patch_fn($x$public.request_talent_directory_contact(uuid, uuid, text, uuid)$x$, array[
    $x$and p.talent_verification_status = 'verified'
      and p.deletion_requested_at is null$x$,
    $x$and p.talent_verification_status = 'verified'$x$
  ]);
select pg_temp.patch_fn($x$public.employer_job_applicants(uuid)$x$, array[
    $x$and a.applied_at is not null
    and p.deletion_requested_at is null$x$,
    $x$and a.applied_at is not null$x$
  ]);
select pg_temp.patch_fn($x$public.employer_application_screening_answers(uuid)$x$, array[
    $x$and public.is_org_member(j.organization_id)
    and public.account_is_active(app.user_id)$x$,
    $x$and public.is_org_member(j.organization_id)$x$
  ]);
select pg_temp.patch_fn($x$public.employer_resume_view_context(uuid)$x$, array[
    $x$and public.is_org_member_for_application(p_application_id)
    and public.account_is_active(a.user_id)$x$,
    $x$and public.is_org_member_for_application(p_application_id)$x$
  ]);
select pg_temp.patch_fn($x$public.employer_view_resume(uuid)$x$, array[
    $x$and public.is_org_member(j.organization_id)
    and public.account_is_active(a.user_id)$x$,
    $x$and public.is_org_member(j.organization_id)$x$
  ]);
select pg_temp.patch_fn($x$public.record_employer_resume_view(uuid)$x$, array[
    $x$where public.is_org_member_for_application(p_application_id)
      and public.application_applicant_is_active(p_application_id)$x$,
    $x$where public.is_org_member_for_application(p_application_id)$x$
  ]);
select pg_temp.patch_fn($x$public.org_application_counts(uuid)$x$, array[
    $x$and public.is_org_member(p_organization_id)
    and public.account_is_active(a.user_id)$x$,
    $x$and public.is_org_member(p_organization_id)$x$
  ]);
select pg_temp.patch_fn($x$public.can_access_assessment_submission(text)$x$, array[
    $x$or (public.is_org_member(f.organization_id) and public.account_is_active(a.user_id))$x$,
    $x$or public.is_org_member(f.organization_id)$x$
  ]);
select pg_temp.patch_fn($x$public.referral_leaderboard(timestamptz, timestamptz, integer)$x$, array[
    $x$and p.referral_leaderboard_opt_in = true
    and p.deletion_requested_at is null$x$,
    $x$and p.referral_leaderboard_opt_in = true$x$
  ]);
select pg_temp.patch_fn($x$public.open_mentor_slots(uuid[], timestamptz)$x$, array[
    $x$and not m.self_paused
      and public.account_is_active(m.user_id)$x$,
    $x$and not m.self_paused$x$
  ]);
select pg_temp.patch_fn($x$public.mentor_public_names(uuid[])$x$, array[
    $x$and not mp.self_paused
      and p.deletion_requested_at is null$x$,
    $x$and not mp.self_paused$x$
  ]);
select pg_temp.patch_fn($x$public.book_mentor_session(uuid, uuid, text)$x$, array[
    $x$  if v_mentor_self_paused then
    raise exception 'MENTOR_PAUSED';
  end if;

  if not public.account_is_active(v_mentor_id) then
    raise exception 'MENTOR_NOT_APPROVED';
  end if;
$x$,
    $x$  if v_mentor_self_paused then
    raise exception 'MENTOR_PAUSED';
  end if;
$x$
  ]);
select pg_temp.patch_fn($x$public.mentorship_session_counterparty_names(uuid[])$x$, array[
    $x$where p.id = any(p_user_ids)
      and p.deletion_requested_at is null$x$,
    $x$where p.id = any(p_user_ids)$x$
  ]);
select pg_temp.patch_fn($x$public.reset_test_pool_user(uuid, text)$x$, array[
    $x$  update public.talent_verifications set reviewer_id = null where reviewer_id = p_user_id;

  delete from public.account_deletions where profile_id = p_user_id;
$x$,
    $x$  update public.talent_verifications set reviewer_id = null where reviewer_id = p_user_id;
$x$,
    $x$    talent_boosted_until = null,
    deletion_requested_at = null,
$x$,
    $x$    talent_boosted_until = null,
$x$
  ]);
select pg_temp.patch_policy($x$public.mentor_profiles$x$, $x$mentor profiles are approved-and-public%$x$, $x$(NOT self_paused) AND public.account_is_active(user_id)$x$, $x$(NOT self_paused)$x$);
select pg_temp.patch_policy($x$public.mentor_availability_slots$x$, $x$availability is visible for approved mentors%$x$, $x$(NOT mp.self_paused) AND public.account_is_active(mp.user_id)$x$, $x$(NOT mp.self_paused)$x$);
select pg_temp.patch_policy($x$public.mentorship_reviews$x$, $x$reviews of approved mentors are publicly readable%$x$, $x$(mp.status = 'approved'::text) AND public.account_is_active(mp.user_id)$x$, $x$(mp.status = 'approved'::text)$x$);
select pg_temp.patch_policy($x$public.application_assessment_submissions$x$, $x$candidate or owning org can read an assessment submission%$x$, $x$(is_org_member(organization_id) AND public.application_applicant_is_active(application_id))$x$, $x$is_org_member(organization_id)$x$);
select pg_temp.patch_policy($x$public.application_assessment_response_files$x$, $x$candidate or owning org can read response files%$x$, $x$(is_org_member(organization_id) AND public.submission_applicant_is_active(application_assessment_submission_id))$x$, $x$is_org_member(organization_id)$x$);

drop function if exists public.function_acl_audit();
drop function if exists public.account_deletion_restore();
drop function if exists public.account_deletion_status();
drop function if exists public.account_deletion_confirm(uuid, text);
drop function if exists public.account_deletion_confirm_precheck(uuid, text);
drop function if exists public.account_deletion_create_request(uuid, text);
drop function if exists public.account_deletion_blockers(uuid);
drop function if exists public.submission_applicant_is_active(uuid);
drop function if exists public.application_applicant_is_active(uuid);
drop function if exists public.account_is_active(uuid);
drop table if exists public.account_deletions;
alter table public.profiles drop column if exists deletion_requested_at;

commit;
