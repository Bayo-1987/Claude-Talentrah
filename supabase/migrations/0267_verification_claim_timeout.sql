-- 0267: a human resume review that a mentor claimed and did not decide within 72 hours goes back to the pool. ONE new function, public.release_stale_verification_claims. No table, column, view, index,
-- policy or trigger is added, and none of the functions that already read or write these rows is redefined (claim_talent_verification_review, release_talent_verification_review_claim,
-- resolve_talent_verification, talent_verification_review_queue, talent_verification_review_detail, talent_verification_my_claims, all 0142). Their grants are untouched.
--
-- WHY. claim_talent_verification_review (0142) moves a pending human review to 'claimed' for the mentor who picked it, and nothing ever returns it: a mentor who claims and then does not decide leaves the
-- candidate waiting with no deadline, and nobody else can take the review. 0142's own header named that orphaned-claim problem and left the sweep for later. This is that sweep.
--
-- WHAT. release_stale_verification_claims(p_now, p_older_than) puts every 'claimed' HUMAN review whose claim time is earlier than p_now - p_older_than (default 72 hours) into the state the reviewer's own release
-- (release_talent_verification_review_claim, 0142) leaves it in: status 'pending', reviewer_id null, claimed_at null. It returns how many rows it released.
--   - ONE conditional UPDATE. The status test in its WHERE clause is the guard, so a decision that lands first (status 'verified'/'rejected') is not touched, and a decision that arrives after a release is refused by
--     resolve_talent_verification, which needs status 'claimed' AND the claimant's id. Row locks decide a race between the two; exactly one wins. Repeating the call finds nothing.
--   - It writes only status, reviewer_id and claimed_at. The payout column (reviewer_payout_ngn) is written only by a decision, so a release pays nothing and takes nothing back; requested_at is untouched, so a
--     released review keeps its place in the queue; the candidate's profile status is untouched (the review is still waiting for someone).
--   - "Older than" is strict: a claim exactly 72 hours old stays. A claimed row with no claim time (the claim function always sets both, so none should exist) is released too, because no clock could ever expire it.
--   - Human reviews only (review_type = 'human'). An AI row is never touched; the 0238 attempt limit counts resolved AI rows, so a release changes nobody's count.
--   - p_now is an injected clock (the 0203 pattern, expire_unpaid_mentor_sessions); the default is the database's own now(). A clock more than a minute ahead of the database is refused (22023), so a caller cannot make a
--     fresh claim look old. p_older_than must be between 1 hour and 30 days (22023 otherwise), so a mistaken argument cannot release every live claim.
--
-- WHO. The existing daily mentorship sweep (src/lib/mentorship/sweep.ts, the 12:00 cron route), once a run, passing only p_now. No new cron; a missed run only delays the release. SECURITY DEFINER with an empty
-- search_path because it writes a table the API roles cannot write; executable by service_role only. The apply checks that itself and fails, keeping nothing, if it is not so.
-- Rollback: supabase/rollbacks/0267_verification_claim_timeout.rollback.sql (roll the sweep code back first).

create or replace function public.release_stale_verification_claims(
  p_now timestamptz default now(),
  p_older_than interval default interval '72 hours'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released integer;
begin
  if p_now is null or p_now > pg_catalog.now() + interval '1 minute' then
    raise exception 'release_stale_verification_claims: the clock may not be in the future' using errcode = '22023';
  end if;
  if p_older_than is null or p_older_than < interval '1 hour' or p_older_than > interval '30 days' then
    raise exception 'release_stale_verification_claims: the cut-off must be between 1 hour and 30 days' using errcode = '22023';
  end if;

  with released as (
    update public.talent_verifications tv
       set status = 'pending', reviewer_id = null, claimed_at = null
     where tv.status = 'claimed'
       and tv.review_type = 'human'
       and (tv.claimed_at is null or tv.claimed_at < p_now - p_older_than)
    returning tv.id
  )
  select pg_catalog.count(*)::integer into v_released from released;

  return v_released;
end;
$$;

comment on function public.release_stale_verification_claims(timestamptz, interval) is
  '0267: puts claimed human resume reviews whose claim is older than p_older_than (default 72 hours; 1 hour to 30 days) back to pending with no reviewer, in one statement, and returns the count. p_now is an injected clock (not more than a minute ahead of the database). Called by the daily mentorship sweep; service_role only.';

revoke all on function public.release_stale_verification_claims(timestamptz, interval) from public, anon, authenticated;
grant execute on function public.release_stale_verification_claims(timestamptz, interval) to service_role;

-- Checks itself when it is applied: the apply fails, and nothing is kept, if anon, authenticated or PUBLIC can execute the function, if service_role cannot, or if it is not a SECURITY DEFINER with the empty search_path.
do $check$
declare
  v_fn oid := 'public.release_stale_verification_claims(timestamptz, interval)'::regprocedure;
  v_role name;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if pg_catalog.has_function_privilege(v_role, v_fn, 'execute') then
      raise exception '0267 self-check: % can execute %', v_role, v_fn::regprocedure;
    end if;
  end loop;
  if exists (
    select 1
    from pg_catalog.aclexplode(coalesce(
      (select p.proacl from pg_catalog.pg_proc p where p.oid = v_fn),
      pg_catalog.acldefault('f', (select p.proowner from pg_catalog.pg_proc p where p.oid = v_fn))
    )) a
    where a.grantee = 0
  ) then
    raise exception '0267 self-check: PUBLIC can execute %', v_fn::regprocedure;
  end if;
  if not pg_catalog.has_function_privilege('service_role', v_fn, 'execute') then
    raise exception '0267 self-check: service_role cannot execute %', v_fn::regprocedure;
  end if;
  if not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_fn) then
    raise exception '0267 self-check: % is not SECURITY DEFINER', v_fn::regprocedure;
  end if;
  if (select p.proconfig from pg_catalog.pg_proc p where p.oid = v_fn) is distinct from array['search_path=""'] then
    raise exception '0267 self-check: % does not have an empty search_path', v_fn::regprocedure;
  end if;
end
$check$;
