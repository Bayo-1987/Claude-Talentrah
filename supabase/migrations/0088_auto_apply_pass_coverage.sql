-- 0088 — Auto-Apply submissions beyond the free weekly allowance are
-- pass-covered, per the pass entitlement spec.
--
-- Every other pass-covered action (tailoring, cover letters, bullet
-- rewrites, scholarship eligibility/SOP) makes its free-vs-charge decision
-- in TypeScript, so hasActivePass() (src/lib/passes/entitlement.ts) is a
-- plain read before the credit gate runs. Auto-Apply is the one exception:
-- 0034's auto_apply_claim_submission decides free-allowance-vs-charge
-- INSIDE the same locked transaction that claims the queue row, precisely
-- to close the double-submission race described in that migration's own
-- header. Bolting pass-coverage on in TS around the RPC call would reopen
-- exactly that race for the one case where it matters most — a script
-- confirming the same queue row twice a moment apart, once seeing "under
-- the free allowance" and once seeing "covered by a pass", each unaware of
-- the other.
--
-- So p_has_active_pass travels into the same lock: when the free weekly
-- allowance is used up AND a pass is active, the charge is skipped instead
-- of computed, in the same branch that already re-validates everything
-- else live. `pass_covered` is a new output column rather than overloading
-- `reason` with a new string, because `reason` already carries values the
-- caller pattern-matches on ('handed_off', 'daily_cap', 'insufficient_credits',
-- 'submitted') and every existing caller (and any future one) needs a value
-- that still means what it always meant — 'submitted' still means submitted,
-- whether or not this column says it was free.
--
-- CREATE OR REPLACE cannot change a table-returning function's output
-- columns — Postgres error on that is unambiguous ("cannot change return
-- type of existing function"). DROP and recreate is the correct move here,
-- not a workaround: revoking the old grants and re-granting on the new
-- signature makes the intent explicit rather than relying on REPLACE to
-- carry them forward (it wouldn't, across a signature change, without them
-- being restated anyway).
drop function if exists public.auto_apply_claim_submission(uuid, uuid, integer, integer, integer, integer);

create function public.auto_apply_claim_submission(
  p_user_id uuid,
  p_queue_id uuid,
  p_min_score integer,
  p_daily_cap integer,
  p_free_per_week integer,
  p_credit_cost integer,
  p_has_active_pass boolean default false
)
returns table (
  ok boolean,
  reason text,
  charge integer,
  job_posting_id uuid,
  source_type public.job_source_type,
  pass_covered boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.auto_apply_queue%rowtype;
  v_live_score integer;
  v_job_open boolean;
  v_used_24h integer;
  v_used_7d integer;
  v_charge integer := 0;
  v_balance integer;
  v_pass_covered boolean := false;
begin
  insert into public.auto_apply_settings (user_id) values (p_user_id)
    on conflict (user_id) do nothing;
  perform 1 from public.auto_apply_settings s where s.user_id = p_user_id for update;

  select q.* into v_row from public.auto_apply_queue q
    where q.id = p_queue_id and q.user_id = p_user_id;
  if not found then
    return query select false, 'not_found'::text, 0, null::uuid, null::public.job_source_type, false;
    return;
  end if;
  if v_row.status <> 'pending' then
    return query select false, 'already_decided'::text, 0, v_row.job_posting_id, v_row.source_type, false;
    return;
  end if;

  select (j.status = 'open') into v_job_open
    from public.job_postings j where j.id = v_row.job_posting_id;
  if v_job_open is distinct from true then
    update public.auto_apply_queue q set status = 'expired', decided_at = now() where q.id = p_queue_id;
    return query select false, 'job_closed'::text, 0, v_row.job_posting_id, v_row.source_type, false;
    return;
  end if;

  select ms.score into v_live_score from public.match_scores ms
    where ms.user_id = p_user_id and ms.job_posting_id = v_row.job_posting_id;
  if v_live_score is null or v_live_score < p_min_score then
    return query select false, 'below_threshold'::text, 0, v_row.job_posting_id, v_row.source_type, false;
    return;
  end if;

  if v_row.source_type = 'external' then
    update public.auto_apply_queue q
      set status = 'handed_off', decided_at = now()
      where q.id = p_queue_id;
    return query select true, 'handed_off'::text, 0, v_row.job_posting_id, v_row.source_type, false;
    return;
  end if;

  select count(*) into v_used_24h from public.auto_apply_queue q
    where q.user_id = p_user_id and q.status = 'submitted'
      and q.decided_at > now() - interval '24 hours';
  if v_used_24h >= p_daily_cap then
    return query select false, 'daily_cap'::text, 0, v_row.job_posting_id, v_row.source_type, false;
    return;
  end if;

  select count(*) into v_used_7d from public.auto_apply_queue q
    where q.user_id = p_user_id and q.status = 'submitted'
      and q.decided_at > now() - interval '7 days';
  if v_used_7d >= p_free_per_week then
    if p_has_active_pass then
      -- Covered: skip the charge and the balance check entirely, rather than
      -- charging 0 credits through the same path a real charge would take —
      -- there is no balance to be insufficient for, so there is nothing to
      -- check.
      v_pass_covered := true;
    else
      v_charge := p_credit_cost;
      select p.credits_balance into v_balance from public.profiles p where p.id = p_user_id;
      if coalesce(v_balance, 0) < v_charge then
        return query select false, 'insufficient_credits'::text, v_charge,
                            v_row.job_posting_id, v_row.source_type, false;
        return;
      end if;
    end if;
  end if;

  update public.auto_apply_queue q
    set status = 'submitted', decided_at = now(), credits_spent = v_charge
    where q.id = p_queue_id;

  return query select true, 'submitted'::text, v_charge, v_row.job_posting_id, v_row.source_type, v_pass_covered;
end;
$$;

revoke all on function public.auto_apply_claim_submission(uuid, uuid, integer, integer, integer, integer, boolean) from public;
revoke all on function public.auto_apply_claim_submission(uuid, uuid, integer, integer, integer, integer, boolean) from anon;
revoke all on function public.auto_apply_claim_submission(uuid, uuid, integer, integer, integer, integer, boolean) from authenticated;
grant execute on function public.auto_apply_claim_submission(uuid, uuid, integer, integer, integer, integer, boolean) to service_role;
