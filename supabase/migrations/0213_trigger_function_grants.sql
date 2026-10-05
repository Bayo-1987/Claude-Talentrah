-- 0213: four trigger-only functions lose anon/authenticated EXECUTE on databases built from the repo (#683).
--
-- WHAT. apply_credit_ledger_entry, log_application_stage_change, trigger_check_activation_from_applications and trigger_check_activation_from_resumes are
-- trigger functions: Postgres refuses to call one as an ordinary function ("trigger functions can only be called as triggers"), and a trigger does not check
-- the CALLER'S execute privilege when it fires (EXECUTE is checked when the trigger is created). So revoking EXECUTE from public, anon and authenticated
-- removes grants nothing uses and changes no behaviour. service_role keeps EXECUTE (revoke does not touch it).
--
-- WHY. Production already lacks these grants: early ledger entries 0013_lock_down_stage_trigger_fn, 0016_lock_down_definer_functions and
-- 0017_lock_down_remaining_trigger_fns revoked them. Those entries (0001 to 0025) were applied before the repo tracked migrations, and the repo's
-- 0000_baseline_schema only does `revoke all ... from public`, so a database BUILT FROM THE REPO (CI's per-job stack, the talentrah-preview project) has Supabase's
-- default direct grants to anon and authenticated on all four. Found by a read-only fingerprint of production against preview (issue #683); 154 functions
-- compared, these four were the only ACL differences.
--
-- EFFECT. No-op on production (the privileges are already absent; REVOKE of an absent privilege is not an error). On preview and CI it brings the ACLs to
-- production's. Idempotent: running it twice changes nothing the second time.
--
-- NOT HERE. Any other difference between production and preview (the job_postings INSERT policy, function text, enum order) is a separate decision.

revoke execute on function public.apply_credit_ledger_entry() from public, anon, authenticated;
revoke execute on function public.log_application_stage_change() from public, anon, authenticated;
revoke execute on function public.trigger_check_activation_from_applications() from public, anon, authenticated;
revoke execute on function public.trigger_check_activation_from_resumes() from public, anon, authenticated;

-- Self-check: the migration fails (and rolls back) unless no client role can execute any of the four and service_role still can.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.apply_credit_ledger_entry()',
    'public.log_application_stage_change()',
    'public.trigger_check_activation_from_applications()',
    'public.trigger_check_activation_from_resumes()'
  ] loop
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'self-check: % is still executable by anon or authenticated', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'execute') then
      raise exception 'self-check: % lost service_role execute', fn;
    end if;
  end loop;
end $$;
