-- 0203: an unpaid mentor booking holds its slot for 30 minutes, then it is released.
--
-- THE PROBLEM (the owner's own test booking). book_mentor_session (0133/0174) locks the slot (is_booked = true) and inserts the
-- session as `pending_payment` BEFORE any payment exists. Nothing ever undid that: the sweep (runMentorshipSweep) only handles
-- `awaiting_confirmation`, so a mentee who never pays leaves the session `pending_payment` and the slot held FOREVER. The mentor's
-- profile then says "No open slots right now" for a slot nobody is going to use, and the mentee's page listed a 17 Sep booking, two
-- weeks past, as "Upcoming", with no way to pay or cancel.
--
-- THE RULE: an unpaid booking holds its slot for 30 minutes (mentor_unpaid_hold()), or until the slot starts if that is sooner.
--
-- IT CANNOT DEPEND ON THE SWEEP. The sweep runs once a day (Vercel Hobby crons cannot run more often), so a 30-minute rule that
-- waited for it would be a 24-hour rule. The rule is enforced where it is READ and where it is BOOKED, in SQL:
--   * book_mentor_session treats a lapsed hold on the requested slot as releasable, and expires that session in the SAME
--     statement that books the slot (a data-modifying CTE: check and act together, the 0035 pattern, never read-then-write);
--   * open_mentor_slots (the one definition of "open" the profile and list slot counts read) ignores a lapsed hold;
--   * the daily sweep (expire_unpaid_mentor_sessions) then only TIDIES statuses: it sets expired_unpaid on the rows the two above
--     already treat as released, and releases any slot still marked booked.
--
-- WHAT THIS ADDS
--   1. Three terminal statuses on mentorship_sessions: expired_unpaid, cancelled_by_mentee, payment_needs_refund.
--   2. The one-session-per-slot rule becomes one LIVE session per slot (a partial unique index). The old UNIQUE (availability_slot_id)
--      made a released slot impossible to book again: the dead session still owned the slot id. Dead sessions keep their slot id
--      (history, and the FK), they just stop counting.
--   3. mentor_unpaid_hold(): the 30 minutes, in one place. src/lib/mentorship/unpaid-hold.ts mirrors it and a test pins the two.
--   4. book_mentor_session: 0174's body, with the lock statement made hold-aware. Nothing else about it changes.
--   5. open_mentor_slots(p_mentor_ids, p_now): the slots a mentee can actually book.
--   6. expire_unpaid_mentor_sessions(p_now): expires every unpaid booking whose hold has lapsed or whose slot has started AND
--      releases each slot, in ONE statement.
--   7. cancel_unpaid_mentor_session(p_session_id, p_mentee_id): the mentee cancels their own unpaid booking; same single statement.
--   8. settle_late_mentor_payment(p_session_id, p_now): a Paystack confirmation that arrives for a booking that already expired or
--      was cancelled. Money is NEVER silently kept: if the slot is still free and ahead, the booking is reinstated (awaiting the
--      mentor, slot locked again); otherwise it is marked payment_needs_refund, which the admin ops badge counts.
--
-- WHAT THE UNIQUE REPLACEMENT DOES NOT BREAK. Checked before writing this: no code in src/, tests/, e2e/ or scripts/ names the
-- constraint mentorship_sessions_availability_slot_id_key or writes ON CONFLICT / upsert against availability_slot_id (a partial
-- index is only an ON CONFLICT target with the matching WHERE, so any such caller would have broken); no PostgREST embed goes
-- from mentor_availability_slots to mentorship_sessions (dropping the UNIQUE would flip that embed from object to array); and the
-- FK mentorship_sessions_availability_slot_id_fkey is untouched. tests/mentorship/book-session-race.test.ts is the standing
-- regression: two bookings racing for one free slot, exactly one wins.
--
-- NOT PURELY ADDITIVE: it drops a constraint (replaced, in the same transaction, by an index that is no weaker for any session the
-- old code can create). Apply BEFORE the code that uses it merges (CLAUDE.md), after the dry run in the PR confirms exactly which
-- rows the first sweep will touch.

-- 1. Statuses ----------------------------------------------------------------------------------------------------------------------
alter table public.mentorship_sessions drop constraint mentorship_sessions_status_check;
alter table public.mentorship_sessions add constraint mentorship_sessions_status_check check (
  status in (
    'pending_payment', 'awaiting_confirmation', 'confirmed', 'completed',
    'cancelled_mentor_no_confirm', 'refunded',
    'expired_unpaid', 'cancelled_by_mentee', 'payment_needs_refund'
  )
);

comment on column public.mentorship_sessions.status is
  'pending_payment -> awaiting_confirmation -> confirmed -> completed; cancelled_mentor_no_confirm and refunded (0133); expired_unpaid (unpaid when the slot started) and cancelled_by_mentee (mentee cancelled while unpaid) release the slot (0203); payment_needs_refund = a payment arrived after the booking had lapsed and the slot could not be restored, so the money must be returned (0203). The last three hold no slot.';

-- 2. One LIVE session per slot -----------------------------------------------------------------------------------------------------
alter table public.mentorship_sessions drop constraint mentorship_sessions_availability_slot_id_key;

create unique index mentorship_sessions_live_slot_key
  on public.mentorship_sessions (availability_slot_id)
  where status not in ('expired_unpaid', 'cancelled_by_mentee', 'payment_needs_refund');

-- 2b. The hold, in one place -----------------------------------------------------------------------------------------------------------
create or replace function public.mentor_unpaid_hold()
returns interval
language sql
immutable
as $$ select interval '30 minutes' $$;

comment on function public.mentor_unpaid_hold() is
  'How long an unpaid (pending_payment) mentor booking holds its slot. Mirrored by UNPAID_HOLD_MINUTES in src/lib/mentorship/unpaid-hold.ts; tests/mentorship/unpaid-hold.test.ts pins the two together.';

-- 2c. Book a slot: 0174's function, with a lapsed unpaid hold on the slot treated as releasable ------------------------------------------
-- Everything below is 0174's own body except the slot-lock statement. The old one was
--     update slots set is_booked = true where id = X and is_booked = false
-- which cannot take a slot whose is_booked is still true because of an unpaid booking nobody finished. The new one expires
-- such a booking and takes the slot in ONE statement (the CTE's output feeds the UPDATE's WHERE), so two bookers racing for a
-- lapsed slot cannot both win: the second waits on the same row locks and then finds nothing to take (SLOT_UNAVAILABLE).
create or replace function public.book_mentor_session(
  p_availability_slot_id uuid,
  p_mentee_id uuid,
  p_session_type text
)
returns table (session_id uuid, price_ngn integer, mentor_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mentor_id uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_base_price integer;
  v_mentor_status text;
  v_mentor_self_paused boolean;
  v_price integer;
  v_commission integer;
  v_payout integer;
  v_session_id uuid;
begin
  if p_session_type not in ('resume_review', 'mock_interview', 'career_strategy', 'negotiation_strategy', 'quick_question') then
    raise exception 'INVALID_SESSION_TYPE';
  end if;

  -- `mentor_availability_slots.mentor_id` is qualified, deliberately: this function's own `returns table (..., mentor_id uuid)`
  -- declares a PL/pgSQL variable of that name, so a bare `mentor_id` in RETURNING is ambiguous (42702). See 0174.
  with stale as (
    update public.mentorship_sessions
       set status = 'expired_unpaid', updated_at = now()
     where availability_slot_id = p_availability_slot_id
       and status = 'pending_payment'
       and created_at <= now() - public.mentor_unpaid_hold()
    returning id
  )
  update public.mentor_availability_slots
     set is_booked = true
   where id = p_availability_slot_id
     and (is_booked = false or exists (select 1 from stale))
  returning mentor_availability_slots.mentor_id, start_at, end_at into v_mentor_id, v_start, v_end;

  if v_mentor_id is null then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  -- A mentor cannot book their own listing as a mentee (see 0174 / tests/mentorship/dual-role-isolation.test.ts).
  if p_mentee_id = v_mentor_id then
    raise exception 'CANNOT_BOOK_OWN_LISTING';
  end if;

  select status, self_paused, base_price_ngn into v_mentor_status, v_mentor_self_paused, v_base_price
  from public.mentor_profiles where user_id = v_mentor_id;

  if v_mentor_status is distinct from 'approved' then
    raise exception 'MENTOR_NOT_APPROVED';
  end if;

  if v_mentor_self_paused then
    raise exception 'MENTOR_PAUSED';
  end if;

  v_price := case
    when v_base_price is null then 0
    when p_session_type = 'quick_question' then 6000
    when p_session_type in ('mock_interview', 'negotiation_strategy') then round(v_base_price * 1.25)
    else v_base_price
  end;
  v_commission := round(v_price * 0.15);
  v_payout := v_price - v_commission;

  insert into public.mentorship_sessions (
    mentor_id, mentee_id, availability_slot_id, session_type,
    scheduled_start, scheduled_end, price_ngn, platform_commission_ngn, mentor_payout_ngn,
    status
  ) values (
    v_mentor_id, p_mentee_id, p_availability_slot_id, p_session_type,
    v_start, v_end, v_price, v_commission, v_payout,
    case when v_price = 0 then 'awaiting_confirmation' else 'pending_payment' end
  ) returning id into v_session_id;

  return query select v_session_id, v_price, v_mentor_id;
end;
$$;

-- 2d. What a mentee can actually book ---------------------------------------------------------------------------------------------------
-- The one definition of "open" for the mentor profile and the mentor list. A slot is open when it is ahead, its mentor is
-- bookable, and it is either unbooked or held only by an unpaid booking whose hold has lapsed. SECURITY DEFINER because the
-- stale-hold check reads mentorship_sessions, which RLS hides from everyone but the two parties; so it re-derives the mentor
-- gate itself (approved, not paused) rather than leaning on a policy it would otherwise bypass (CLAUDE.md, 0109).
create or replace function public.open_mentor_slots(p_mentor_ids uuid[], p_now timestamptz default now())
returns table (id uuid, mentor_id uuid, start_at timestamptz, end_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.mentor_id, s.start_at, s.end_at
    from public.mentor_availability_slots s
    join public.mentor_profiles m
      on m.user_id = s.mentor_id and m.status = 'approved' and not m.self_paused
   where s.mentor_id = any (p_mentor_ids)
     and s.start_at > p_now
     and (
       not s.is_booked
       or exists (
         select 1 from public.mentorship_sessions x
          where x.availability_slot_id = s.id
            and x.status = 'pending_payment'
            and x.created_at <= p_now - public.mentor_unpaid_hold()
       )
     )
   order by s.start_at;
$$;

comment on function public.open_mentor_slots(uuid[], timestamptz) is
  'The slots a mentee can book now: ahead, mentor approved and not paused, and unbooked or held only by an unpaid booking whose 30-minute hold has lapsed.';

-- 3. Tidy: expire unpaid bookings whose hold lapsed (or whose slot started) and release their slots, atomically ---------------------------------------------------------------------
create or replace function public.expire_unpaid_mentor_sessions(p_now timestamptz default now())
returns table (session_id uuid, slot_id uuid)
language sql
security definer
set search_path = public
as $$
  with expired as (
    update public.mentorship_sessions
       set status = 'expired_unpaid', updated_at = p_now
     where status = 'pending_payment'
       and (scheduled_start <= p_now or created_at <= p_now - public.mentor_unpaid_hold())
    returning id, availability_slot_id
  ),
  released as (
    update public.mentor_availability_slots s
       set is_booked = false
      from expired e
     where s.id = e.availability_slot_id
    returning s.id
  )
  select e.id, e.availability_slot_id from expired e;
$$;

comment on function public.expire_unpaid_mentor_sessions(timestamptz) is
  'Tidies unpaid bookings: expires every pending_payment session whose 30-minute hold has lapsed or whose slot has started, and releases each slot, in one statement. The hold is already enforced at read and booking time (open_mentor_slots, book_mentor_session); this makes the stored status agree. Idempotent. service_role only.';

-- 4. The mentee cancels their own unpaid booking ----------------------------------------------------------------------------------------
create or replace function public.cancel_unpaid_mentor_session(p_session_id uuid, p_mentee_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with cancelled as (
    update public.mentorship_sessions
       set status = 'cancelled_by_mentee', updated_at = now()
     where id = p_session_id
       and mentee_id = p_mentee_id
       and status = 'pending_payment'
    returning availability_slot_id
  ),
  released as (
    update public.mentor_availability_slots s
       set is_booked = false
      from cancelled c
     where s.id = c.availability_slot_id
    returning s.id
  )
  select exists (select 1 from cancelled);
$$;

comment on function public.cancel_unpaid_mentor_session(uuid, uuid) is
  'Cancels the mentee''s own pending_payment session and releases its slot, in one statement. False when there was nothing to cancel (not theirs, already paid, already lapsed). service_role only; the caller resolves p_mentee_id from the session.';

-- 5. A payment that arrives for a booking that already lapsed ---------------------------------------------------------------------------
create or replace function public.settle_late_mentor_payment(p_session_id uuid, p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_slot uuid;
  v_locked uuid;
begin
  -- The row lock serialises this against the expiry sweep and a cancel: whichever got there first has finished.
  select status, availability_slot_id into v_status, v_slot
    from public.mentorship_sessions where id = p_session_id for update;

  if not found then
    return 'not_found';
  end if;
  if v_status not in ('expired_unpaid', 'cancelled_by_mentee') then
    -- pending_payment is the normal path (fulfilment handles it); anything else was already settled.
    return 'not_late';
  end if;

  -- Take the slot back only if it is still free AND still ahead. Conditional UPDATE: check and act in one statement.
  update public.mentor_availability_slots
     set is_booked = true
   where id = v_slot and is_booked = false and start_at > p_now
  returning id into v_locked;

  if v_locked is not null then
    update public.mentorship_sessions set status = 'awaiting_confirmation', updated_at = p_now where id = p_session_id;
    return 'reinstated';
  end if;

  -- The slot has passed or someone else booked it. The mentee paid for something that no longer exists: it must be refunded.
  update public.mentorship_sessions set status = 'payment_needs_refund', updated_at = p_now where id = p_session_id;
  return 'needs_refund';
end;
$$;

comment on function public.settle_late_mentor_payment(uuid, timestamptz) is
  'Called by fulfilment when a successful payment lands on a session that is expired_unpaid or cancelled_by_mentee. Returns reinstated (slot restored, awaiting the mentor), needs_refund (marked payment_needs_refund; the admin ops badge counts it), not_late (nothing to do) or not_found. service_role only.';

-- Grants: these are trusted-server operations (the caller resolves who the mentee is), exactly like book_mentor_session (0133) ----------
revoke all on function public.expire_unpaid_mentor_sessions(timestamptz) from public, anon, authenticated;
revoke all on function public.cancel_unpaid_mentor_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.settle_late_mentor_payment(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.expire_unpaid_mentor_sessions(timestamptz) to service_role;
grant execute on function public.cancel_unpaid_mentor_session(uuid, uuid) to service_role;
grant execute on function public.settle_late_mentor_payment(uuid, timestamptz) to service_role;
revoke all on function public.open_mentor_slots(uuid[], timestamptz) from public, anon;
grant execute on function public.open_mentor_slots(uuid[], timestamptz) to authenticated, service_role;
