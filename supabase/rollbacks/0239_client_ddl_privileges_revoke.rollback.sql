-- 0239 rollback: give the three privileges back, exactly as they were. Run only on the owner's separate approval: it re-opens TRUNCATE, REFERENCES and TRIGGER for the client roles, which nothing uses.
-- The before-state is the audit of 7 Oct 2026 (identical on preview and production): 78 tables in public; 46 gave TRUNCATE, REFERENCES and TRIGGER to anon AND authenticated, 7 gave them to authenticated only,
-- the rest gave none. Those two lists are written out below; the rollback restores exactly them and then checks every table in public against them. If a table in the lists is gone, or the check finds any difference
-- (a table added since gets none of the three, which is also what this expects), nothing is kept. The default privileges for new tables are given back for the migrating role (and attempted for supabase_admin).
do $rb$
declare
  v_both constant text[] := array['ad_campaigns', 'ad_events', 'ad_wallets', 'application_assessment_response_files', 'application_assessment_submissions', 'application_screening_answers', 'application_stage_events', 'applications', 'auto_apply_queue', 'auto_apply_settings', 'blog_posts', 'course_recommendations', 'credit_gate_events', 'credit_ledger', 'credit_packs', 'employer_applicant_status', 'feedback', 'job_posting_assessment_files', 'job_posting_assessments', 'job_posting_reports', 'job_posting_screening_questions', 'job_postings', 'job_tailoring_requests', 'match_scores', 'mentor_availability_slots', 'mentor_profiles', 'mentorship_reviews', 'mentorship_sessions', 'one_tap_moments', 'organization_members', 'organizations', 'passes', 'proactive_match_alerts', 'profiles', 'referral_shares', 'referrals', 'resume_templates', 'resumes', 'scholarship_saves', 'scholarships', 'talent_directory_boosts', 'talent_directory_contact_requests', 'talent_directory_plans', 'talent_portfolio_items', 'user_notifications', 'user_template_unlocks'];
  v_auth constant text[] := array['ad_wallet_ledger', 'country_default_events', 'payment_transactions', 'resume_builder_start_events', 'talent_directory_subscriptions', 'talent_verifications', 'user_passes'];
  t text;
  d record;
  v_bad text;
begin
  foreach t in array v_both || v_auth loop
    if pg_catalog.to_regclass('public.' || pg_catalog.quote_ident(t)) is null then
      raise exception '0239 rollback: table public.% is not there any more; the recorded before-state no longer matches, nothing was changed', t;
    end if;
  end loop;
  foreach t in array v_both loop
    execute pg_catalog.format('grant truncate, references, trigger on table public.%I to anon, authenticated', t);
  end loop;
  foreach t in array v_auth loop
    execute pg_catalog.format('grant truncate, references, trigger on table public.%I to authenticated', t);
  end loop;
  alter default privileges in schema public grant truncate, references, trigger on tables to anon, authenticated;
  for d in
    select distinct pg_catalog.pg_get_userbyid(a.defaclrole) as grantor
      from pg_catalog.pg_default_acl a
     where a.defaclnamespace = 'public'::regnamespace and a.defaclobjtype = 'r' and pg_catalog.pg_get_userbyid(a.defaclrole) <> current_user
  loop
    begin
      execute pg_catalog.format('alter default privileges for role %I in schema public grant truncate, references, trigger on tables to anon, authenticated', d.grantor);
    exception when insufficient_privilege then
      raise notice '0239 rollback: the default privileges of role % were not changed', d.grantor;
    end;
  end loop;
  select string_agg(x.relname || ': ' || x.role_name, ', ' order by x.relname, x.role_name) into v_bad
    from (
      select c.relname, r.role_name,
             (pg_catalog.has_table_privilege(r.role_name, c.oid, 'truncate') and pg_catalog.has_table_privilege(r.role_name, c.oid, 'references') and pg_catalog.has_table_privilege(r.role_name, c.oid, 'trigger')) as all_three,
             (pg_catalog.has_table_privilege(r.role_name, c.oid, 'truncate') or pg_catalog.has_table_privilege(r.role_name, c.oid, 'references') or pg_catalog.has_table_privilege(r.role_name, c.oid, 'trigger')) as any_of_three,
             (case r.role_name when 'anon' then c.relname = any (v_both) else (c.relname = any (v_both) or c.relname = any (v_auth)) end) as expected
        from pg_catalog.pg_class c cross join (values ('anon'), ('authenticated')) as r(role_name)
       where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    ) x
   where x.all_three <> x.expected or x.any_of_three <> x.expected;
  if v_bad is not null then raise exception '0239 rollback self-check: the privileges are not the recorded before-state: %', v_bad; end if;
end
$rb$;
