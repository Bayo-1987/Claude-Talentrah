-- 0147 — Talent Directory v2, part 1: the seeker-paid search boost
-- (build-prompt §6.13's third buyer segment — "job seekers themselves
-- (competitive edge, paid via credits)" — the one 0134/0135 deliberately did
-- not build, per that migration's own header, in favour of the two employer
-- segments only).
--
-- Dispatched in parallel with send-156 (human-review verification tier),
-- which also touches talent-directory schema. Checked immediately before
-- writing this: `profiles` and `talent_directory_subscriptions` are still
-- exactly the shape 0135 left them in on both live projects (verified via
-- `list_migrations`/`execute_sql` against nytwbbzfpytctjsoczzq and
-- dozaffzgqkbarxtlclsj — 0135 is still each project's highest applied
-- migration) — so nothing here assumes a shape that has since moved.
--
-- ── WHAT THE SEEKER IS ACTUALLY BUYING: A TIME-BOXED SEARCH BOOST ──────────
--
-- The prompt's own baseline — `talent_boosted_until timestamptz`, ordering by
-- `(talent_boosted_until > now()) desc, talent_verified_at desc` — is what
-- ships, not a fancier alternative, for three reasons:
--   1. It is the ONLY option of the ones considered (a "Featured" badge, a
--      boosted talent_verification_score weight) that cannot corrupt a
--      column that means something else. talent_verification_score is
--      Farah's AI grade of resume quality (0135) — spending credits to
--      inflate it would make a trust signal purchasable, exactly the
--      "verification becomes pay-to-win" failure this app's own trust
--      columns (mentor_profiles.status, profiles.talent_verification_status)
--      are designed to never allow. A boost has to live in a column that
--      means "paid to be seen first," not one that means "graded well."
--   2. It mirrors a pattern this app already has three copies of for a
--      time-boxed paid entitlement — user_passes' auto-renewal window,
--      ad_campaigns' promoted-until-date shape, and
--      talent_directory_subscriptions' own expires_at (0135) — rather than
--      inventing a fourth shape (a badge flag has no natural expiry; a score
--      weight has no natural "spend more, stay featured longer" mechanic).
--   3. It is genuinely reversible cheaply: a badge or a score weight, once
--      other UI or ranking logic starts reading it, is expensive to walk
--      back; an unused timestamp column is not.
--
-- ── THE GATE DOES NOT CHANGE ────────────────────────────────────────────────
--
-- talent_directory_search's WHERE clause — opted_in = true AND
-- verification_status = 'verified', both, always — is untouched below. This
-- migration only changes the function's ORDER BY. A boosted-but-unverified
-- or boosted-but-opted-out seeker still matches nothing, proven directly by
-- tests/rls/talent-directory.test.ts's new
-- "a boost record never overrides the verified+opted-in gate" cases, not
-- assumed from the ordering change being "just cosmetic."
--
-- ── CONCURRENCY: THE SAME CLAIM-THEN-SPEND SHAPE AS VERIFICATION ──────────
--
-- Mirrors runTalentVerification exactly (see verification-runner.ts's own
-- header): insert a 'pending' audit row FIRST, spend credits through the
-- existing spend_credits_atomic (0035) — no new atomicity primitive for the
-- credit side, this is just a new credit_reason (0146) the existing RPC
-- already supports — then resolve the row and extend the boost in ONE
-- atomic statement below. A spend failure deletes the still-pending row
-- directly (service role bypasses RLS; no profiles column has been touched
-- yet at that point, so there's nothing to compensate the way
-- release_talent_verification_claim's profiles UPDATE half has to).
--
-- THE PART THAT ACTUALLY NEEDED A NEW ATOMIC STATEMENT, though, is the
-- extension itself, not the spend: reading profiles.talent_boosted_until in
-- application code, adding p_days in JS, and writing the result back is
-- exactly the read-then-act shape CLAUDE.md's own spendCredits lesson warns
-- about — two concurrent purchases would both read the same starting
-- expiry and each overwrite it with only their own extension, silently
-- losing whichever purchase's extra days lost the race, even though both
-- charges succeeded. resolve_talent_directory_boost's single
-- `GREATEST(...) + one UPDATE` is the fix, the same one-statement
-- check-and-act shape as spend_credits_atomic's conditional UPDATE.

-- ── profiles: the boost's own column ───────────────────────────────────────

alter table public.profiles
  add column talent_boosted_until timestamptz;

comment on column public.profiles.talent_boosted_until is
  'Time-boxed search-ranking boost (§6.13''s third buyer segment: seekers paying credits for competitive edge). NEVER client-writable — profiles'' authenticated column grant list (0135) deliberately does not include it, so it stays a trust/money column exactly like talent_verification_status. Moves only through resolve_talent_directory_boost() below, via service-role calls from runTalentDirectoryBoostPurchase. Does NOT affect talent_directory_search''s verified+opted-in gate — it only changes ordering among candidates who already pass it.';

-- ── talent_directory_boosts: one row per purchase, the audit trail ────────
--
-- Same shape/reasoning as talent_verifications (0135): profiles carries the
-- single denormalised value the search function's ORDER BY actually reads;
-- this table is the human-readable history of how it got there, and the
-- thing credit_ledger.related_entity_id points at for this credit_reason.

create table public.talent_directory_boosts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  days integer not null check (days > 0),
  status text not null default 'pending' check (status in ('pending', 'active')),
  credit_ledger_id uuid references public.credit_ledger(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  -- The CUMULATIVE profiles.talent_boosted_until value immediately after
  -- this purchase was applied (not this purchase's own isolated p_days) —
  -- so a seeker's history reads "as of this purchase, you're boosted until
  -- X," which is what stacking purchases actually means to the person who
  -- bought them.
  boosted_until timestamptz
);

comment on table public.talent_directory_boosts is
  'Audit trail of seeker-paid search boost purchases. profiles.talent_boosted_until (the column talent_directory_search''s ORDER BY reads) is kept in sync by resolve_talent_directory_boost() below, in the same statement — never by a client write.';

alter table public.talent_directory_boosts enable row level security;

create policy "a user reads their own boost history" on public.talent_directory_boosts
  for select to authenticated
  using (user_id = auth.uid());

-- No client insert/update/delete policy at all — every write goes through
-- runTalentDirectoryBoostPurchase's service-role calls and
-- resolve_talent_directory_boost() below, the same shape 0135 already
-- established for talent_verifications.

-- ── resolve_talent_directory_boost: the atomic resolve + extend ──────────

create or replace function public.resolve_talent_directory_boost(
  p_boost_id uuid,
  p_user_id uuid,
  p_days integer
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated uuid;
  v_new_until timestamptz;
begin
  update public.talent_directory_boosts
     set status = 'active', decided_at = now()
   where id = p_boost_id and user_id = p_user_id and status = 'pending'
  returning id into v_updated;

  if v_updated is null then
    return null;
  end if;

  -- THE ATOMIC EXTENSION. GREATEST(...) against the CURRENT row value inside
  -- one UPDATE means two concurrent purchases still serialize correctly
  -- under Postgres' row lock and each genuinely stacks its own p_days on
  -- top of whatever the other just committed, rather than one clobbering
  -- the other's extension.
  update public.profiles
     set talent_boosted_until = greatest(coalesce(talent_boosted_until, now()), now()) + make_interval(days => p_days)
   where id = p_user_id
  returning talent_boosted_until into v_new_until;

  update public.talent_directory_boosts
     set boosted_until = v_new_until
   where id = p_boost_id;

  return v_new_until;
end;
$$;

revoke all on function public.resolve_talent_directory_boost(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.resolve_talent_directory_boost(uuid, uuid, integer) to service_role;

-- ── talent_directory_search: same gate, new ORDER BY only ──────────────────
--
-- Identical to 0135's own definition except the ORDER BY — same signature,
-- same return columns, same WHERE clause (both verified = true AND
-- opt_in = true, always both), same entitlement check. Re-asserting the
-- revoke/grant pair defensively, the same way this repo re-asserts them on
-- every CREATE OR REPLACE of a SECURITY DEFINER function that crosses a
-- privilege boundary (0107/0108's own lesson on re-checking every function
-- that reads a gated table when the gate itself is touched — here the gate
-- is untouched, but the function is being replaced, so the grants are
-- re-stated rather than assumed to survive).
create or replace function public.talent_directory_search(
  p_remote_ready boolean default null,
  p_available_for_hire boolean default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_candidate_id uuid default null
)
returns table (
  user_id uuid,
  first_name text,
  last_name text,
  country text,
  available_for_hire boolean,
  remote_ready boolean,
  earliest_start_date date,
  verification_score integer,
  verified_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.organization_members om
    join public.talent_directory_subscriptions s on s.organization_id = om.organization_id
    where om.user_id = auth.uid()
      and s.status = 'active'
      and s.expires_at > now()
  ) then
    return;
  end if;

  return query
    select p.id, p.first_name, p.last_name, p.country,
           p.talent_available_for_hire, p.talent_remote_ready, p.talent_earliest_start_date,
           p.talent_verification_score, p.talent_verified_at
    from public.profiles p
    where p.talent_directory_opt_in = true
      and p.talent_verification_status = 'verified'
      and (p_remote_ready is null or p.talent_remote_ready = p_remote_ready)
      and (p_available_for_hire is null or p.talent_available_for_hire = p_available_for_hire)
      and (p_candidate_id is null or p.id = p_candidate_id)
    order by (p.talent_boosted_until is not null and p.talent_boosted_until > now()) desc,
             p.talent_verified_at desc
    limit least(coalesce(p_limit, 20), 50)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.talent_directory_search(boolean, boolean, integer, integer, uuid) from public, anon;
grant execute on function public.talent_directory_search(boolean, boolean, integer, integer, uuid) to authenticated;
