-- 0133 — Mentorship Marketplace v1 (send-137, build-prompt §6.11).
--
-- ── SCOPE, STATED PLAINLY ───────────────────────────────────────────────────
--
-- §6.11 is a Phase 3 item CLAUDE.md marks deferred until the core
-- job-matching loop proves retention — building it now is a deliberate
-- override per explicit founder instruction to draft the remaining backlog
-- for parallel dispatch, not a claim the deferral reasoning stopped applying.
--
-- Two real pieces of the full spec are deliberately cut from this slice:
--   * AUTOMATED MENTOR PAYOUTS. §6.7 already made the identical call for
--     referral rewards ("prefer credit rewards over cash — avoids KYC/payout
--     infra"). Talentrah collects the full payment; the mentor's 85% share
--     (mentor_payout_ngn below) is recorded per session so a human can run
--     that payout manually, off-platform, for v1 — not disbursed by code.
--   * VIDEO CALL INTEGRATION. §6.11 flags this `[DECIDE]` and recommends an
--     existing provider over building one. `meeting_link` (below) is a plain
--     text field, populated at confirmation time by a Jitsi Meet room URL
--     (no API key, no OAuth, genuinely joinable) — swappable later for a real
--     provider integration without a schema change.
--
-- ── WHY `mentor_profiles` IS A SEPARATE TABLE FROM `profiles` ───────────────
--
-- Exactly the reasoning `admin_users` already established for admin identity:
-- `profiles` is the table whose grant list exists to grow, and mentor-specific
-- fields (bio, price, vetting state) belong nowhere near the seeker-facing
-- row. This ALSO answers the mentor/seeker dual-role question directly: one
-- `profiles.id` can own a `mentor_profiles` row AND keep applying to jobs as
-- normal — the two identities never collide because they live in different
-- tables, the same way an admin can also be a seeker (0060's own reasoning).
--
-- ── THE STATE MACHINE, AND WHY `awaiting_confirmation` EXISTS ───────────────
--
-- pending_payment            -- a PAID booking, before Paystack confirms it
-- awaiting_confirmation      -- payment done (or free — same state either
--                               way, see below) — waiting on the MENTOR
-- confirmed                  -- mentor confirmed; meeting_link is set
-- completed                  -- scheduled_end has passed
-- cancelled_mentor_no_confirm -- the mentor never confirmed by the deadline
-- refunded                   -- terminal, once a refund was requested
--
-- A FREE session skips `pending_payment` (book_mentor_session below inserts
-- it straight into `awaiting_confirmation`) because there is no payment to
-- wait for — but it does NOT skip mentor confirmation. §6.11's own no-show
-- risk (a mentor who never shows up) applies identically whether or not
-- money changed hands, so the confirmation gate — and therefore the
-- cancellation policy that enforces it — is not something a free session
-- gets to skip.
--
-- ── THE NO-SHOW / CANCELLATION POLICY, DECIDED AND WHY ──────────────────────
--
-- Nothing in §6.11 specs this, and it is exactly the kind of real-money edge
-- case that becomes a support fire if left unhandled. Chosen: a mentor who
-- has not confirmed by 24 HOURS before the scheduled start is auto-cancelled
-- (`cancelled_mentor_no_confirm`), and a paid session is refunded via
-- Paystack automatically (mentorship-sweep.ts). 24 hours because it mirrors
-- the ordinary "24-hour cancellation window" convention most booking
-- platforms already train users to expect, and it leaves the mentee a
-- realistic amount of runway to book someone else for the same slot rather
-- than finding out at the last minute. Enforced by a cron sweep
-- (src/app/api/admin/mentorship-sweep/route.ts), matching this repo's own
-- established shape for time-based state changes (closeExpiredInternalPostings,
-- runPassRenewalJob) rather than a client-side check that only fires if
-- someone happens to load a page.

create table public.mentor_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')),
  bio text,
  -- Free-text tags, matching how this app already tags things it has no
  -- fixed enum for: resume_templates.industry_category (text, not an enum)
  -- and structured_jd.skills (a plain text array) are the precedent § 6.11
  -- itself points at ("reuse the same taxonomy job filters and resume
  -- template categories already use, not a new one") — neither of those is
  -- an enum, so text[] here is the honest match, not a new taxonomy.
  expertise_roles text[] not null default '{}',
  expertise_industries text[] not null default '{}',
  -- Seniority IS an existing enum (jobs already use it) — reused directly.
  expertise_seniority public.seniority_level[] not null default '{}',
  years_experience integer check (years_experience is null or years_experience >= 0),
  -- Null = free/volunteer, per §6.11's own recommendation that this be the
  -- real v1 default rather than a bootstrap-only fallback (GrowthMentor's
  -- ~85% volunteer rate cited directly in the build prompt).
  base_price_ngn integer check (base_price_ngn is null or base_price_ngn >= 0),
  applied_at timestamptz not null default now(),
  reviewed_at timestamptz,
  -- References profiles, not admin_users — exactly 0064's reasoning for
  -- moderated_by/reviewed_by/removed_by (and 0119/0120's admin_reviewed_by/
  -- cac_confirmed_by): a revoked admin account should still resolve as a
  -- named person in this trail.
  reviewed_by uuid references public.profiles(id) on delete set null,
  review_note text
);

comment on table public.mentor_profiles is
  'Mentor identity and vetting state, separate from profiles — 0133''s own header explains why, mirroring admin_users. No mentor is publicly listed before status=approved.';

alter table public.mentor_profiles enable row level security;

create policy "mentor profiles are approved-and-public, or visible to the mentor themself" on public.mentor_profiles
  for select to authenticated
  using (status = 'approved' or user_id = auth.uid());

-- `with check (... and status = 'pending')` is what stops a client from
-- inserting their own row pre-approved — RLS restricts ROWS, not the VALUES
-- within an otherwise-permitted row, so this has to be spelled out in the
-- check clause rather than assumed from the column's own default.
create policy "a user can apply to become a mentor for themselves, pending only" on public.mentor_profiles
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');

create policy "a mentor can edit their own profile row" on public.mentor_profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 0030's own lesson again: the row policy above permits the UPDATE
-- STATEMENT; this column grant is what actually decides which columns move.
-- status/reviewed_at/reviewed_by/review_note stay admin-only regardless of
-- what the row policy would otherwise allow.
revoke update on public.mentor_profiles from authenticated;
grant update (bio, expertise_roles, expertise_industries, expertise_seniority, years_experience, base_price_ngn)
  on public.mentor_profiles to authenticated;

create table public.mentor_availability_slots (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references public.mentor_profiles(user_id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  is_booked boolean not null default false,
  created_at timestamptz not null default now(),
  constraint mentor_availability_slots_end_after_start check (end_at > start_at)
);

comment on table public.mentor_availability_slots is
  'Open slots a mentor has posted. is_booked flips true ONLY via book_mentor_session — never a direct client UPDATE, which is what makes double-booking a single-statement question rather than a client-side race.';

alter table public.mentor_availability_slots enable row level security;

create policy "availability is visible for approved mentors, or to the mentor themself" on public.mentor_availability_slots
  for select to authenticated
  using (
    mentor_id = auth.uid()
    or exists (
      select 1 from public.mentor_profiles mp
      where mp.user_id = mentor_availability_slots.mentor_id and mp.status = 'approved'
    )
  );

create policy "a mentor posts their own open slots" on public.mentor_availability_slots
  for insert to authenticated
  with check (mentor_id = auth.uid());

create policy "a mentor removes their own still-open slots" on public.mentor_availability_slots
  for delete to authenticated
  using (mentor_id = auth.uid() and is_booked = false);

-- No UPDATE policy for authenticated, deliberately: nothing but
-- book_mentor_session (SECURITY DEFINER) may ever flip is_booked. A direct
-- client UPDATE here would be exactly the read-then-write race this whole
-- design exists to avoid.

create table public.mentorship_sessions (
  id uuid primary key default gen_random_uuid(),
  -- Deliberately NO ON DELETE action (defaults to NO ACTION), same reasoning
  -- CLAUDE.md already states for job_postings/payment_transactions on
  -- organizations: a mentor's payment/session history must not silently
  -- vanish if their account is deleted. This means deleting a mentor's
  -- profiles row is blocked while they have session history — account
  -- deletion has to handle that explicitly, not by cascading it away.
  mentor_id uuid not null references public.mentor_profiles(user_id),
  mentee_id uuid not null references public.profiles(id) on delete cascade,
  availability_slot_id uuid not null unique references public.mentor_availability_slots(id),
  session_type text not null check (
    session_type in ('resume_review', 'mock_interview', 'career_strategy', 'negotiation_strategy', 'quick_question')
  ),
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  -- Server-computed at booking time (book_mentor_session), never trusted
  -- from a client — the exact same principle payment_transactions.amount
  -- already follows for credit packs and passes.
  price_ngn integer not null default 0,
  platform_commission_ngn integer not null default 0,
  mentor_payout_ngn integer not null default 0,
  status text not null default 'pending_payment' check (
    status in (
      'pending_payment', 'awaiting_confirmation', 'confirmed', 'completed',
      'cancelled_mentor_no_confirm', 'refunded'
    )
  ),
  meeting_link text,
  mentor_confirmed_at timestamptz,
  mentee_notes text,
  mentor_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mentorship_sessions_commission_split_sums check (
    platform_commission_ngn + mentor_payout_ngn = price_ngn
  )
);

comment on table public.mentorship_sessions is
  'One booked mentorship session. price/commission/payout are computed once, at booking, and never recomputed later — the commission_split_sums CHECK is what makes "the split always accounts for the full price" a schema-level guarantee, not just a convention book_mentor_session happens to follow.';

alter table public.mentorship_sessions enable row level security;

create policy "a session is readable by either party" on public.mentorship_sessions
  for select to authenticated
  using (mentor_id = auth.uid() or mentee_id = auth.uid());

-- No INSERT policy for authenticated — booking only ever happens through
-- book_mentor_session, which is what makes the slot-lock and the price
-- computation atomic with the row's own creation.

create policy "either party can update their own session row" on public.mentorship_sessions
  for update to authenticated
  using (mentor_id = auth.uid() or mentee_id = auth.uid())
  with check (mentor_id = auth.uid() or mentee_id = auth.uid());

-- Column grants split by WHICH party may write WHICH column — a row policy
-- alone would let either party rewrite price_ngn, status, or the other
-- party's notes. mentor_confirmed_at/meeting_link/status changes all go
-- through SECURITY DEFINER functions below, not a direct client UPDATE.
revoke update on public.mentorship_sessions from authenticated;
grant update (mentee_notes, mentor_notes) on public.mentorship_sessions to authenticated;

-- ── WHY A TRIGGER, NOT JUST THE COLUMN GRANT ABOVE ─────────────────────────
--
-- A Postgres column grant is per ROLE, not per ROW — `authenticated` is one
-- shared role for every signed-in user, so granting UPDATE on mentor_notes
-- makes it writable by whichever party's row policy happens to pass, not
-- specifically the mentor. The column grant above is necessary (0030's own
-- lesson: without it neither column is writable at all) but not sufficient
-- to express "the MENTEE may change mentee_notes and the MENTOR may change
-- mentor_notes" — that is a claim about WHICH ROW-SPECIFIC PARTY the caller
-- is, which only a trigger reading auth.uid() against the row's own
-- mentor_id/mentee_id can enforce. Caught by
-- tests/rls/mentorship.test.ts, which is the guard that actually proves it.
create or replace function public.enforce_mentorship_session_notes_ownership()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.mentee_notes is distinct from old.mentee_notes and auth.uid() <> old.mentee_id then
    raise exception 'NOT_YOUR_NOTES: only the mentee may change mentee_notes';
  end if;
  if new.mentor_notes is distinct from old.mentor_notes and auth.uid() <> old.mentor_id then
    raise exception 'NOT_YOUR_NOTES: only the mentor may change mentor_notes';
  end if;
  return new;
end;
$$;

create trigger mentorship_sessions_notes_ownership
  before update on public.mentorship_sessions
  for each row
  execute function public.enforce_mentorship_session_notes_ownership();

create table public.mentorship_reviews (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.mentorship_sessions(id) on delete cascade,
  mentor_id uuid not null references public.mentor_profiles(user_id),
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  review_text text,
  created_at timestamptz not null default now()
);

comment on table public.mentorship_reviews is
  'One review per completed session, from the mentee side only — the UNIQUE on session_id is what stops a second review of the same session, and the INSERT policy''s own subquery is what stops reviewing a session that never completed or was never yours.';

alter table public.mentorship_reviews enable row level security;

create policy "reviews of approved mentors are publicly readable" on public.mentorship_reviews
  for select to authenticated
  using (
    exists (select 1 from public.mentor_profiles mp where mp.user_id = mentorship_reviews.mentor_id and mp.status = 'approved')
  );

create policy "a mentee may review their own COMPLETED session, once" on public.mentorship_reviews
  for insert to authenticated
  with check (
    reviewer_id = auth.uid()
    and exists (
      select 1 from public.mentorship_sessions s
      where s.id = session_id and s.mentee_id = auth.uid() and s.status = 'completed' and s.mentor_id = mentorship_reviews.mentor_id
    )
  );

-- ── payment_transactions: the third direct-payment product type ───────────
--
-- Additive only — matches 0050's own precedent for ad_wallet_topup exactly.
-- credit_pack/pass/ad_wallet_topup's own CHECKs are untouched; this is a
-- separate constraint for the new branch alone.
alter table public.payment_transactions
  add constraint payment_transactions_mentor_session_requires_product
  check (product_type <> 'mentor_session' or product_id is not null);

-- ── book_mentor_session: the one atomic statement this whole feature leans on ──
--
-- Locks the slot, prices the session server-side, and creates the session
-- row — all as ONE UPDATE ... WHERE is_booked = false, matching
-- auto_apply_claim_submission's own "several conditions held together under
-- one lock" shape (CLAUDE.md's own cited pattern) rather than a read-then-act
-- check in application code. Two mentees hitting the same slot at once can
-- only ever have one UPDATE actually match a row; the other gets zero rows
-- back and raises SLOT_UNAVAILABLE.
--
-- service_role only, exactly like spend_credits_atomic (0035) and
-- auto_apply_claim_submission (0034) — p_mentee_id is a trusted parameter the
-- calling Server Action already resolved via requireUser()'s own session
-- lookup, not something this function re-derives from auth.uid(). A
-- service-role call has no session context to read one from anyway.
--
-- PRICING DUPLICATES src/lib/mentorship/pricing.ts'S OWN CONSTANTS
-- (0.15 commission, 1.25 premium multiplier, ₦6,000 quick-question flat) ON
-- PURPOSE, not by oversight — the booking write MUST happen inside this one
-- atomic statement, which rules out calling out to application code
-- mid-transaction. tests/mentorship/commission-split.test.ts cross-checks
-- this SQL's own output against that TS module for the same inputs
-- specifically so the two cannot silently drift without a test noticing.
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
  v_price integer;
  v_commission integer;
  v_payout integer;
  v_session_id uuid;
begin
  if p_session_type not in ('resume_review', 'mock_interview', 'career_strategy', 'negotiation_strategy', 'quick_question') then
    raise exception 'INVALID_SESSION_TYPE';
  end if;

  /*
   * `mentor_availability_slots.mentor_id` is qualified here, deliberately —
   * this function's own `returns table (..., mentor_id uuid, ...)` clause
   * implicitly declares a PL/pgSQL variable named `mentor_id` in scope for
   * the whole function body, so a bare `mentor_id` in this RETURNING clause
   * is genuinely ambiguous between that output parameter and the table
   * column, and Postgres refuses it outright (42702) rather than guessing.
   * Caught by tests/mentorship/commission-split.test.ts's own DB
   * cross-check, which could not book a single session before this fix.
   */
  update public.mentor_availability_slots
     set is_booked = true
   where id = p_availability_slot_id
     and is_booked = false
  returning mentor_availability_slots.mentor_id, start_at, end_at into v_mentor_id, v_start, v_end;

  if v_mentor_id is null then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  -- A mentor cannot book their own listing as a mentee. Nothing in the
  -- schema shape forbids mentor_id = mentee_id on mentorship_sessions (both
  -- are plain FKs), so this has to be an explicit check here rather than an
  -- assumption from the table definition — see
  -- tests/mentorship/dual-role-isolation.test.ts, which is the guard that
  -- actually proves it.
  if p_mentee_id = v_mentor_id then
    update public.mentor_availability_slots set is_booked = false where id = p_availability_slot_id;
    raise exception 'CANNOT_BOOK_OWN_LISTING';
  end if;

  select status, base_price_ngn into v_mentor_status, v_base_price
  from public.mentor_profiles where user_id = v_mentor_id;

  if v_mentor_status is distinct from 'approved' then
    -- Roll the lock back — this mentor is not (or no longer) bookable, e.g.
    -- suspended after the slot was already posted.
    update public.mentor_availability_slots set is_booked = false where id = p_availability_slot_id;
    raise exception 'MENTOR_NOT_APPROVED';
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

revoke all on function public.book_mentor_session(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.book_mentor_session(uuid, uuid, text) to service_role;

comment on function public.book_mentor_session(uuid, uuid, text) is
  'Atomically locks a slot, prices the session server-side, and creates the mentorship_sessions row. SECURITY DEFINER because mentor_availability_slots has no client UPDATE policy at all (0133''s own header) — this is the one place is_booked may ever flip.';

-- ── mark_mentor_session_confirmed: the mentor's own confirmation step ──────
--
-- Sets mentor_confirmed_at and the meeting link, moves status to confirmed.
-- SECURITY DEFINER so the mentor's own client (which per the column grants
-- above cannot write `status` or `meeting_link` directly) can still trigger
-- exactly this one transition, and only for a session actually awaiting it.
--
-- service_role only, same reasoning as book_mentor_session above:
-- p_mentor_id is the id confirmMentorSessionAction already resolved via
-- requireUser()'s own session lookup, checked against the session row's own
-- mentor_id in the WHERE clause rather than trusted blindly — a
-- service-role call has no auth.uid() to check against even if it wanted to.
create or replace function public.mark_mentor_session_confirmed(
  p_session_id uuid,
  p_mentor_id uuid,
  p_meeting_link text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated uuid;
begin
  update public.mentorship_sessions
     set status = 'confirmed', mentor_confirmed_at = now(), meeting_link = p_meeting_link, updated_at = now()
   where id = p_session_id
     and mentor_id = p_mentor_id
     and status = 'awaiting_confirmation'
  returning id into v_updated;

  return v_updated is not null;
end;
$$;

revoke all on function public.mark_mentor_session_confirmed(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mark_mentor_session_confirmed(uuid, uuid, text) to service_role;

-- ── admin_moderate_mentor_application: the vetting decision ────────────────
--
-- EXACT same shape as admin_moderate_job_posting (0079): p_actor is passed IN
-- by the caller (requirePermission("mentor_review") already resolved it
-- server-side, in decideMentorApplicationAction — see moderation/actions.ts's
-- own header on why that id is not a claim), and permission-check +
-- state-transition happen together in one statement so two admins opening the
-- same application cannot both "win".
create or replace function public.admin_moderate_mentor_application(
  p_actor uuid,
  p_mentor_user_id uuid,
  p_decision text,
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
  if p_decision not in ('approved', 'rejected') then
    return query select false, 'bad_decision'::text; return;
  end if;
  if p_decision = 'rejected' and nullif(btrim(coalesce(p_note, '')), '') is null then
    -- Same reasoning as every other reject-needs-a-reason gate in this admin
    -- surface (0079's own scholarship/job-posting functions): a rejection
    -- with no note leaves the applicant nothing to correct before reapplying.
    return query select false, 'reason_required'::text; return;
  end if;

  update public.mentor_profiles
     set status = p_decision,
         reviewed_at = now(),
         reviewed_by = p_actor,
         review_note = nullif(btrim(coalesce(p_note, '')), '')
   where user_id = p_mentor_user_id
     and status = 'pending'
  returning user_id into v_updated;

  if v_updated is null then
    return query select false, 'not_pending'::text; return;
  end if;
  return query select true, 'ok'::text;
end;
$$;

revoke all on function public.admin_moderate_mentor_application(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_moderate_mentor_application(uuid, uuid, text, text) to service_role;

comment on function public.admin_moderate_mentor_application(uuid, uuid, text, text) is
  'Approve or reject a pending mentor application. service_role only, called from decideMentorApplicationAction after requirePermission("mentor_review") — matches admin_moderate_job_posting''s own split exactly: the Server Action resolves and passes the actor, this checks the permission and moves the state atomically.';
