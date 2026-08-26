-- 0048 — Submitting a campaign for review is a function, not a client write.
--
-- 0047 was internally inconsistent, and a test caught it before merge. The
-- transition trigger explicitly permitted `draft -> pending_review` from a
-- client, but `status` was never in the column grant — so that branch was
-- unreachable: the client's UPDATE was refused by the grant before the trigger
-- ever ran. The test asserting "submitting for review is allowed" failed with
-- status still `draft`.
--
-- Resolved toward the STRICTER side, because that is what 0047's own comment
-- already claimed: "everything that moves money or changes review state goes
-- through a SECURITY DEFINER function". Submitting for review *is* a
-- review-state change; the trigger's exception was the part that was wrong,
-- not the grant.
--
-- So no client writes `status`, ever. The trigger's rule narrows to "reject
-- every client status write", which is a rule with no exceptions to get wrong
-- — and this repo's history is mostly exceptions that turned out to be wrong.

create or replace function public.enforce_ad_campaign_transition()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status is not distinct from new.status then return new; end if;
  if coalesce(auth.role(), '') = 'service_role' then return new; end if;
  raise exception
    'Campaign status is not client-writable (% -> %) — use the campaign actions',
    old.status, new.status using errcode = 'check_violation';
end; $$;

create or replace function public.submit_ad_campaign_for_review(
  p_campaign_id uuid,
  p_actor_user_id uuid
)
returns public.ad_campaign_status
language plpgsql security definer set search_path = public as $$
declare v_status public.ad_campaign_status;
begin
  -- Scoped to `draft` in the WHERE clause rather than checked first: a
  -- check-then-update would let two concurrent submissions both pass the
  -- check. Returns NULL when nothing matched, which the caller reads as
  -- "not in a submittable state".
  update public.ad_campaigns
     set status = 'pending_review', submitted_at = now(), updated_at = now()
   where id = p_campaign_id and status = 'draft'
  returning status into v_status;
  return v_status;
end; $$;

revoke all on function public.submit_ad_campaign_for_review(uuid, uuid) from public, anon, authenticated;
grant execute on function public.submit_ad_campaign_for_review(uuid, uuid) to service_role;
