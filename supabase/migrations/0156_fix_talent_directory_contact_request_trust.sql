-- 0156 — fix a real defect in 0155's request_talent_directory_contact: it
-- re-checked organisation membership against auth.uid(), but the function
-- is service_role-only and is called (contact-runner.ts) via
-- createServiceRoleClient(), which sends no per-user JWT at all. Confirmed
-- directly against this project before writing this fix:
--
--   select auth.uid(), current_setting('request.jwt.claims', true);
--   -- {"uid": null, "claims": null}
--
-- auth.uid() is NULL in that context, so `om.user_id = auth.uid()` could
-- never be true — every real call would have failed with 'not_subscribed'
-- regardless of the caller's actual entitlement. Re-checked list_migrations
-- on both projects immediately before writing this: 0155 was the ceiling on
-- both, 0156 was free on both.
--
-- 0155's own header claimed this mirrored claim_external_job_posting (0128)
-- checking p_organization_id against auth.uid() — that claim was wrong.
-- Rereading 0128 directly: claim_external_job_posting trusts
-- p_organization_id outright, with NO auth.uid() re-check at all, precisely
-- because it is SECURITY DEFINER + service_role-only and p_organization_id
-- is already resolved server-side by requireEmployer() before the RPC is
-- ever called — the same trust boundary auto_apply_claim_submission (0034)
-- documents for p_user_id. That is the actual pattern to match, so this
-- migration drops the auth.uid() check entirely rather than trying to make
-- it work: p_organization_id is trusted, and the only thing this function
-- verifies for itself is that THAT organisation genuinely has an active,
-- unexpired subscription — a fact with no client-supplied input to forge.
--
-- The same problem hit `requested_by`, which the insert set to `auth.uid()`
-- — always NULL for the identical reason. Since this table's own column
-- comment already frames requested_by as "for audit only," the fix is to
-- have the caller pass the already-resolved user id through explicitly, the
-- same trust boundary as p_organization_id itself, rather than ship a column
-- that can structurally never be populated.
--
-- Widening the argument list means `create or replace` would add a second
-- overload rather than replace the original three-argument function (same
-- 42P13-adjacent trap 0154's own header hit the other direction, changing a
-- RETURNS TABLE shape) — drop the old signature first.
drop function if exists public.request_talent_directory_contact(uuid, uuid, text);

create function public.request_talent_directory_contact(
  p_organization_id uuid,
  p_candidate_id uuid,
  p_message text,
  p_requested_by uuid
)
returns table (ok boolean, reason text, request_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_active boolean;
  v_candidate_eligible boolean;
  v_new_id uuid;
  v_limit record;
  v_message text;
begin
  select exists (
    select 1
    from public.talent_directory_subscriptions s
    where s.organization_id = p_organization_id
      and s.status = 'active'
      and s.expires_at > now()
  ) into v_org_active;

  if not v_org_active then
    return query select false, 'not_subscribed'::text, null::uuid; return;
  end if;

  select exists (
    select 1 from public.profiles p
    where p.id = p_candidate_id
      and p.talent_directory_opt_in = true
      and p.talent_verification_status = 'verified'
  ) into v_candidate_eligible;

  if not v_candidate_eligible then
    return query select false, 'candidate_not_listed'::text, null::uuid; return;
  end if;

  v_message := btrim(coalesce(p_message, ''));
  if v_message = '' then
    return query select false, 'message_required'::text, null::uuid; return;
  end if;

  select * into v_limit
  from public.consume_anonymous_rate_limit(p_organization_id::text, 'talent_directory_contact', 20, 86400);

  if not v_limit.allowed then
    return query select false, 'rate_limited'::text, null::uuid; return;
  end if;

  insert into public.talent_directory_contact_requests (organization_id, candidate_id, requested_by, message)
  values (p_organization_id, p_candidate_id, p_requested_by, v_message)
  returning id into v_new_id;

  return query select true, 'ok'::text, v_new_id;
exception
  when unique_violation then
    return query select false, 'already_pending'::text, null::uuid;
end;
$$;

revoke all on function public.request_talent_directory_contact(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.request_talent_directory_contact(uuid, uuid, text, uuid) to service_role;

comment on function public.request_talent_directory_contact(uuid, uuid, text, uuid) is
  'Employer sends interest in a directory candidate. service_role only — the calling Server Action resolves organization_id and the caller''s own user id via requireEmployer() first and both are trusted outright here (no auth.uid() re-check: this function is called via the service-role client, which carries no per-user JWT, so auth.uid() is always null in this context — see 0156, which also moved requested_by from auth.uid() to this explicit p_requested_by for the same reason). Re-checks the org''s own active subscription and the candidate''s current opt-in+verified state independently, and rate-limits per organization (20/day) via consume_anonymous_rate_limit (0117).';
