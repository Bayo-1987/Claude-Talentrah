-- Admin suspend/reinstate for an already-approved mentor.
--
-- THE GAP: mentor_profiles.status already allows 'suspended' (0133's check
-- constraint), the mentee-facing page already has copy for it, and a comment
-- on the payouts page already calls it "the real hold lever" — but no code
-- path could ever reach it. admin_moderate_mentor_application (0133) only
-- accepts p_decision in ('approved', 'rejected') and only fires
-- where status = 'pending'. That is deliberately the wrong function to
-- extend: vetting a new application and disciplining an existing mentor are
-- different actions with different preconditions, and folding suspend into
-- the same RPC would mean one function guarding two unrelated state
-- machines.
--
-- SAME SHAPE AS admin_moderate_mentor_application: permission check +
-- conditional UPDATE ... WHERE status = '<expected>' in one statement, so two
-- admins acting on the same mentor at once can't both "win" — whichever
-- UPDATE runs second matches zero rows and is told so via v_updated is null,
-- exactly the spend_credits_atomic (0035) / auto_apply_claim_submission
-- (0034) pattern this codebase already uses everywhere a counted or compared
-- value is gated.
--
-- admin_suspend_mentor requires a note, same as a rejection — the applicant
-- (here, the mentor) needs something to know what to fix. admin_reinstate
-- does not require one: lifting a suspension is not itself a new judgment
-- call that needs justifying beyond what the suspension note already says.
-- Reinstating deliberately does NOT clear review_note, leaving the
-- suspension's reason visible in the mentor's own history until the next
-- decision overwrites it.
create or replace function public.admin_suspend_mentor(
  p_actor uuid,
  p_mentor_user_id uuid,
  p_note text
)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated uuid;
begin
  if not public.admin_has_permission(p_actor, 'mentor_review') then
    return query select false, 'not_authorised'::text; return;
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    return query select false, 'reason_required'::text; return;
  end if;

  update public.mentor_profiles
     set status = 'suspended',
         reviewed_at = now(),
         reviewed_by = p_actor,
         review_note = nullif(btrim(coalesce(p_note, '')), '')
   where user_id = p_mentor_user_id
     and status = 'approved'
  returning user_id into v_updated;

  if v_updated is null then
    return query select false, 'not_approved'::text; return;
  end if;
  return query select true, 'ok'::text;
end;
$$;

revoke all on function public.admin_suspend_mentor(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_suspend_mentor(uuid, uuid, text) to service_role;

create or replace function public.admin_reinstate_mentor(
  p_actor uuid,
  p_mentor_user_id uuid
)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated uuid;
begin
  if not public.admin_has_permission(p_actor, 'mentor_review') then
    return query select false, 'not_authorised'::text; return;
  end if;

  update public.mentor_profiles
     set status = 'approved',
         reviewed_at = now(),
         reviewed_by = p_actor
   where user_id = p_mentor_user_id
     and status = 'suspended'
  returning user_id into v_updated;

  if v_updated is null then
    return query select false, 'not_suspended'::text; return;
  end if;
  return query select true, 'ok'::text;
end;
$$;

revoke all on function public.admin_reinstate_mentor(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_reinstate_mentor(uuid, uuid) to service_role;
