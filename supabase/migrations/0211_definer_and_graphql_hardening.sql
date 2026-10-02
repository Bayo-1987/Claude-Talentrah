-- 0211: definer and GraphQL hardening: the Supabase security advisor's findings that are real, decided by the owner after a read-only review
-- (2 Oct). Three changes, and a list of what is deliberately left alone.
--
-- 1. SIX TRIGGER-ONLY SECURITY DEFINER FUNCTIONS lose EXECUTE for public, anon and authenticated.
--      enforce_ad_campaign_transition, enforce_application_stage_transition, ensure_email_preferences,
--      invalidate_match_scores_on_jd_change, match_scores_prune_on_posting_closed, stamp_employer_applicant_status
--    Each returns `trigger`, so Postgres refuses to call it as an ordinary function ("trigger functions can only be called as triggers"), and the
--    app never references any of them. A trigger does not check the CALLER'S execute privilege when it fires (EXECUTE is checked when the trigger is
--    created), so revoking it removes exposure without removing behaviour. tests/rls/definer-and-graphql-hardening.test.ts proves both halves: a
--    direct call is refused with 42501, and every trigger still fires for the user who performs the action. service_role keeps EXECUTE.
--
-- 2. referral_leaderboard LOSES ANON's EXECUTE. 0130 granted it to authenticated only and revoked from public, but anon held Supabase's default
--    direct grant, so a signed-out caller could read opted-in members' display names and counts. Only the signed-in /refer page calls it.
--
-- 3. pg_graphql IS DROPPED. The app has no GraphQL consumer (no /graphql/v1 call, no client library; docs/pg-graphql-investigation.md found none
--    by four independent methods), the extension exposes table and column names to anon and signed-in users through /graphql/v1, and the earlier
--    attempt to narrow it by revoking grants was impossible for the `postgres` role (the objects belong to supabase_admin). DROP EXTENSION works
--    for `postgres` and is done HERE, in a migration after the baseline (which creates it), so the baseline stays intact and a fresh stack
--    (CI, `supabase start`) ends in the same state as production. The `graphql` and `graphql_public` schemas remain; /graphql/v1 stops answering.
--    Reversible by `create extension pg_graphql` (the schema is regenerated from the database), but nothing here needs it back.
--
-- DELIBERATELY NOT CHANGED, and why:
--   internal_applicant_counts     authenticated, ungated, returns only COUNTS of applications for internal job ids; the jobs feed shows them.
--   email_unsubscribe, proactive_match_alert_set_preference, scholarship_deadline_alert_set_preference, win_back_email_set_preference
--                                 anon on purpose: the signed-out unsubscribe page; the per-user unsubscribe_token is the bearer secret.
--   is_org_member, is_org_member_for_application
--                                 anon must keep EXECUTE: RLS policies call them and a policy is evaluated as the calling role (CLAUDE.md, 0032).
--   is_valid_referral_code        anon: the signup referral cookie check in src/proxy.ts; answers only true or false, shape-checked first.
--   list_applied_migrations       anon-executable but gated inside on the JWT claim purpose = 'migration-status-reader' (403 otherwise).
--   superseded_job_target         anon: the public job page's 308 redirect to the kept posting; public data only.
--   the 21 authenticated-only definer functions   each gates on auth.uid() or org membership inside (reviewed one by one).
--
-- Additive in effect for the running app (no table, column or policy changes; nothing the app calls is removed), so it is applied to production
-- BEFORE the merge, after a rolled-back dry run and the owner's yes.

-- 1. The six trigger-only functions ---------------------------------------------------------------------------------------------------
revoke execute on function public.enforce_ad_campaign_transition() from public, anon, authenticated;
revoke execute on function public.enforce_application_stage_transition() from public, anon, authenticated;
revoke execute on function public.ensure_email_preferences() from public, anon, authenticated;
revoke execute on function public.invalidate_match_scores_on_jd_change() from public, anon, authenticated;
revoke execute on function public.match_scores_prune_on_posting_closed() from public, anon, authenticated;
revoke execute on function public.stamp_employer_applicant_status() from public, anon, authenticated;

-- 2. referral_leaderboard: signed-in users only -----------------------------------------------------------------------------------------
revoke execute on function public.referral_leaderboard(timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.referral_leaderboard(timestamptz, timestamptz, integer) to authenticated;

-- 3. GraphQL ----------------------------------------------------------------------------------------------------------------------------
drop extension if exists pg_graphql;

-- Self-check: the migration fails (and rolls back) unless every change took effect.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.enforce_ad_campaign_transition()',
    'public.enforce_application_stage_transition()',
    'public.ensure_email_preferences()',
    'public.invalidate_match_scores_on_jd_change()',
    'public.match_scores_prune_on_posting_closed()',
    'public.stamp_employer_applicant_status()'
  ] loop
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'self-check: % is still executable by anon or authenticated', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'execute') then
      raise exception 'self-check: % lost service_role execute', fn;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.referral_leaderboard(timestamptz, timestamptz, integer)', 'execute') then
    raise exception 'self-check: referral_leaderboard is still executable by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.referral_leaderboard(timestamptz, timestamptz, integer)', 'execute') then
    raise exception 'self-check: referral_leaderboard lost authenticated execute';
  end if;
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_graphql') then
    raise exception 'self-check: pg_graphql is still installed';
  end if;
end $$;
