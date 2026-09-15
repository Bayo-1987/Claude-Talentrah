-- 0164 — Auto-Apply must not act on a thin-tag "Excellent".
--
-- Per docs/stage8-match-accuracy.md: 65% of every "Excellent" score this
-- system has ever computed sits on a screenable-tag denominator of 1 or
-- fewer, and 89% sit at 2 or fewer. Auto-Apply is Excellent-only (0034), so
-- a thin denominator is not a cosmetic display problem here the way it is
-- for the badge (PR #253, match-tier.ts's `isThinScreenableTagSet`) — it is
-- an eligibility signal Auto-Apply currently has no way to see, because
-- `auto_apply_claim_submission` only ever re-read `match_scores.score`, never
-- `match_scores.explanation`.
--
-- This migration adds that check to the SAME gate that already re-reads the
-- score live at confirm time (0034's own header explains why live, not the
-- queue row's snapshot), rejecting with a new `reason` value ('thin_match')
-- when the screenable-tag total is <= 2 — REGARDLESS of p_min_score. A thin
-- match should not auto-apply at any threshold, not just today's 80: the
-- problem is that the denominator doesn't mean anything, not that the score
-- computed from it happens to be too low.
--
-- THE THRESHOLD MUST AGREE WITH THE TS SIDE. `<= 2` here is the same
-- constant as `THIN_SCREENABLE_TAG_MAX` / `isThinScreenableTagSet` in
-- src/lib/match-tier.ts — hardcoded on this side because SQL has no import
-- mechanism, but pinned against drift by
-- tests/auto-apply/thin-match-gate.test.ts, which derives its boundary test
-- values FROM the exported TS constant rather than from a second hardcoded
-- literal, so a future change to one side without the other fails that test.
--
-- Screenable-tag total is computed the same way `computeMatchScore`
-- (src/lib/matching/score.ts) and match-tier-badge.tsx already do:
-- matchedSkills.length + missingSkills.length from the stored explanation.
--
-- SAME SIGNATURE AND RETURN SHAPE as the live function (confirmed by reading
-- pg_get_functiondef directly against both dozaffzgqkbarxtlclsj and
-- nytwbbzfpytctjsoczzq before writing this — the live signature carries
-- 0088's `p_has_active_pass` / `pass_covered` addition, which the 0034 file
-- alone does not show). CREATE OR REPLACE is correct here (not DROP+CREATE,
-- unlike 0088) because this change does not alter the parameter list or the
-- output columns — only the body.
--
-- CLIENT-SIDE ORDERING: `explain()` in src/lib/auto-apply/actions.ts already
-- has a `default:` catch-all ("Couldn't confirm that one.") for any
-- unrecognised `reason` string, so an unknown reason cannot crash or
-- mis-render the confirm flow — checked directly in that file before writing
-- this migration. That makes this the additive-migration case
-- (docs/production-migration-apply.md): a strictly more conservative
-- function can only refuse something that used to succeed, never the other
-- way around, so this is safe to apply ahead of the app-code deploy that
-- adds the specific, honest copy for 'thin_match' (mirroring the existing
-- per-reason messages for job_closed/daily_cap/insufficient_credits).
--
-- WHAT THIS DOES NOT CHANGE: computeMatchScore, getMatchTier,
-- match_scores.tier, and the digest's own Good+ filter are all untouched —
-- this only narrows what Auto-Apply is allowed to ACT on.
create or replace function public.auto_apply_claim_submission(
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
  v_explanation jsonb;
  v_matched_count integer;
  v_missing_count integer;
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

  -- Live, not snapshotted — same reasoning as always (0034's own header).
  select ms.score, ms.explanation into v_live_score, v_explanation from public.match_scores ms
    where ms.user_id = p_user_id and ms.job_posting_id = v_row.job_posting_id;
  if v_live_score is null or v_live_score < p_min_score then
    return query select false, 'below_threshold'::text, 0, v_row.job_posting_id, v_row.source_type, false;
    return;
  end if;

  -- A thin screenable-tag denominator is refused UNCONDITIONALLY here, even
  -- though queue.ts (src/lib/auto-apply/queue.ts) also excludes these at
  -- queuing time so a user shouldn't normally see one reach this gate at
  -- all. This re-check is the real backstop: it is what actually decides,
  -- the same way the live score re-check above is the real backstop for the
  -- threshold, not the queue row's stale snapshot.
  v_matched_count := coalesce(jsonb_array_length(v_explanation -> 'matchedSkills'), 0);
  v_missing_count := coalesce(jsonb_array_length(v_explanation -> 'missingSkills'), 0);
  if (v_matched_count + v_missing_count) <= 2 then
    return query select false, 'thin_match'::text, 0, v_row.job_posting_id, v_row.source_type, false;
    return;
  end if;

  -- External postings are handed off, never submitted: no cap, no charge.
  -- Claimed here so the log records the hand-off, but it costs nothing.
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
