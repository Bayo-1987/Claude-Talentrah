-- 0034 — Make the Auto-Apply cap hold under concurrency.
--
-- The cap in 0033's design is only as real as the code that enforces it, and
-- the obvious enforcement is a lie:
--
--     const used = await countSubmissionsLast24h(userId);   -- read
--     if (used >= CAP) return refuse;                       -- decide
--     await createApplication(...);                         -- act
--
-- Two requests interleaving between the read and the act both see `used = 4`
-- and both proceed, so a cap of 5 permits 6. That is not a theoretical race:
-- the review queue is a list of buttons, and a double-click or two tabs is
-- enough. build-prompt §8 asks for a real cap, and "usually 5" is not one.
--
-- So the check and the claim happen together, in the database, under a lock.
-- `auto_apply_settings` is the natural mutex: exactly one row per user, and any
-- submission by that user has to pass through it. Concurrent confirmations for
-- the same user serialise; different users never contend.
--
-- WHAT THIS FUNCTION RE-VERIFIES, rather than trusting:
--   * the queue row belongs to the caller and is still `pending`
--   * the posting is still open (a job closed since queueing must not be applied to)
--   * the match score STILL clears the threshold, re-read live from
--     `match_scores` — not from the snapshot on the queue row. The snapshot is
--     for the audit log; the gate reads the source of truth. This is the
--     assertion the whole feature rests on, per 0031.
--   * the daily cap, and whether this one is free or chargeable
--   * that a chargeable submission can actually be paid for
--
-- It claims the row (pending -> submitted) inside the same lock and returns a
-- verdict. The caller then spends credits and creates the application; on any
-- failure it releases the claim back to `pending`. The brief window where a row
-- is claimed without an application yet is deliberate — it is the safe
-- direction, because it can only ever under-count a user's allowance, never
-- let an extra application out.
--
-- EVERY TABLE REFERENCE IS ALIASED, and that is not style. The RETURNS TABLE
-- clause declares OUT columns named `job_posting_id` and `source_type`, which
-- are in scope inside the body and shadow the table columns of the same name —
-- an unaliased `where job_posting_id = ...` fails at runtime with
-- "column reference is ambiguous". The first draft of this function had exactly
-- that bug in four places; the enforcement suite caught it on its first run,
-- which is the argument for testing the gate rather than reading it.
--
-- SECURITY DEFINER with a pinned search_path, EXECUTE revoked from the world
-- and granted only to service_role: this is called from a Server Action that
-- has already established the session user. It is NOT callable by
-- `authenticated`, so a user cannot invoke it with someone else's queue id —
-- the caller passes p_user_id from a verified session, and granting it to
-- authenticated would make that parameter a forgeable authorisation.

create or replace function public.auto_apply_claim_submission(
  p_user_id uuid,
  p_queue_id uuid,
  p_min_score integer,
  p_daily_cap integer,
  p_free_per_week integer,
  p_credit_cost integer
)
returns table (
  ok boolean,
  reason text,
  charge integer,
  job_posting_id uuid,
  source_type public.job_source_type
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
begin
  -- The mutex. Upsert first so a user who has never toggled still has a row to
  -- lock; then take the lock for the rest of the transaction.
  insert into public.auto_apply_settings (user_id) values (p_user_id)
    on conflict (user_id) do nothing;
  perform 1 from public.auto_apply_settings s where s.user_id = p_user_id for update;

  select q.* into v_row from public.auto_apply_queue q
    where q.id = p_queue_id and q.user_id = p_user_id;
  if not found then
    return query select false, 'not_found'::text, 0, null::uuid, null::public.job_source_type;
    return;
  end if;
  if v_row.status <> 'pending' then
    return query select false, 'already_decided'::text, 0, v_row.job_posting_id, v_row.source_type;
    return;
  end if;

  select (j.status = 'open') into v_job_open
    from public.job_postings j where j.id = v_row.job_posting_id;
  if v_job_open is distinct from true then
    update public.auto_apply_queue q set status = 'expired', decided_at = now() where q.id = p_queue_id;
    return query select false, 'job_closed'::text, 0, v_row.job_posting_id, v_row.source_type;
    return;
  end if;

  -- Live, not snapshotted. If the résumé changed and the match no longer
  -- clears the bar, this must not go out.
  select ms.score into v_live_score from public.match_scores ms
    where ms.user_id = p_user_id and ms.job_posting_id = v_row.job_posting_id;
  if v_live_score is null or v_live_score < p_min_score then
    return query select false, 'below_threshold'::text, 0, v_row.job_posting_id, v_row.source_type;
    return;
  end if;

  -- External postings are handed off, never submitted: no cap, no charge.
  -- Claimed here so the log records the hand-off, but it costs nothing.
  if v_row.source_type = 'external' then
    update public.auto_apply_queue q
      set status = 'handed_off', decided_at = now()
      where q.id = p_queue_id;
    return query select true, 'handed_off'::text, 0, v_row.job_posting_id, v_row.source_type;
    return;
  end if;

  select count(*) into v_used_24h from public.auto_apply_queue q
    where q.user_id = p_user_id and q.status = 'submitted'
      and q.decided_at > now() - interval '24 hours';
  if v_used_24h >= p_daily_cap then
    return query select false, 'daily_cap'::text, 0, v_row.job_posting_id, v_row.source_type;
    return;
  end if;

  select count(*) into v_used_7d from public.auto_apply_queue q
    where q.user_id = p_user_id and q.status = 'submitted'
      and q.decided_at > now() - interval '7 days';
  if v_used_7d >= p_free_per_week then
    v_charge := p_credit_cost;
    select p.credits_balance into v_balance from public.profiles p where p.id = p_user_id;
    if coalesce(v_balance, 0) < v_charge then
      return query select false, 'insufficient_credits'::text, v_charge,
                          v_row.job_posting_id, v_row.source_type;
      return;
    end if;
  end if;

  update public.auto_apply_queue q
    set status = 'submitted', decided_at = now(), credits_spent = v_charge
    where q.id = p_queue_id;

  return query select true, 'submitted'::text, v_charge, v_row.job_posting_id, v_row.source_type;
end;
$$;

revoke all on function public.auto_apply_claim_submission(uuid, uuid, integer, integer, integer, integer) from public;
revoke all on function public.auto_apply_claim_submission(uuid, uuid, integer, integer, integer, integer) from anon;
revoke all on function public.auto_apply_claim_submission(uuid, uuid, integer, integer, integer, integer) from authenticated;
grant execute on function public.auto_apply_claim_submission(uuid, uuid, integer, integer, integer, integer) to service_role;
