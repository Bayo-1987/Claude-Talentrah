-- 0139 — Mentor payouts (Mentorship v2, part 1).
--
-- 0133 shipped session booking, payment collection and the no-show sweep, but
-- deliberately cut automated mentor payouts for v1: "the mentor's 85% share
-- (mentor_payout_ngn) is recorded per session so a human can run that payout
-- manually, off-platform, for v1 — not disbursed by code." This migration is
-- that missing half: real Paystack Transfers, paid automatically by a cron,
-- with the same idempotency discipline this repo already requires of anything
-- that moves money (spend_credits_atomic 0035, auto_apply_claim_submission
-- 0034, the pass-renewal indeterminate-retry design 0043).
--
-- Dispatched in parallel with three sibling Mentorship-v2 tasks (video call
-- integration, seeker-paid-visibility, human-review-verification-tier) that
-- may also touch `mentor_profiles`. Re-checked immediately before writing this
-- file: `mentor_profiles` on both nytwbbzfpytctjsoczzq and dozaffzgqkbarxtlclsj
-- had exactly the twelve columns 0133 created — no sibling had landed columns
-- there yet — and `0136` was free in supabase/migrations/ and in both
-- projects' own `schema_migrations` at that moment (highest real migration on
-- all three was 0135). This migration was applied to both projects, and this
-- PR opened, under that name.
--
-- **RENUMBERED 0136 → 0139 after opening the PR**, per this repo's own
-- convention (supabase/migrations/README.md: "whichever PR lands second
-- renumbers") — a FILE rename only, `git mv`, neither database touched. Not
-- a two-way collision but a genuine pile-up: re-checking `list_migrations`
-- immediately before opening the PR showed THREE different migrations had
-- landed as `0136` (this one, `0136_talent_directory_boost_enum_value`, and
-- `0136_talent_directory_human_review_enum`), with matching collisions at
-- `0137` (two claimants) and `0138` (two more, unrelated to `0136`). This
-- migration is recorded in both projects' `schema_migrations` under the name
-- `0136_mentor_payouts` — the applied name and the committed filename now
-- permanently disagree, the same accepted cosmetic mismatch 0061's own header
-- documents for exactly this situation. `0139` was chosen as the next number
-- strictly above every migration number visible in either ledger at
-- renumbering time (0136, 0137 and 0138 were each already claimed at least
-- twice), not by coordinating with the other sessions — a further collision
-- at 0139 from a task this session has no visibility into is possible and
-- would be resolved the same way, by whichever of us renumbers second.
--
-- ── WHY THIS IS FIRST OUTBOUND MONEY, AND WHAT THAT CHANGES ─────────────────
--
-- Every payment path before this one COLLECTS: a user or an org pays
-- Talentrah, and `fulfillPayment` (src/lib/billing/fulfill.ts) grants
-- something in response. This is the reverse — Talentrah pays a mentor — and
-- Paystack Transfers is a genuinely different API (recipients, transfer
-- references, an OTP-approval step some account tiers still require) from the
-- Charges API every existing payment path uses. Same provider though, per
-- this repo's own "prefer the existing provider" habit — no new payment rail.
--
-- ── THE HOLD WINDOW, DECIDED AND WHY ─────────────────────────────────────────
--
-- A session becomes payout-eligible 72 HOURS after `scheduled_end`, once its
-- status is `completed`. Chosen over a shorter window because the mentee's
-- real protection against a no-show that slips past confirmation (a mentor
-- who confirmed but never actually joined the call) is a human complaint
-- reaching the team through Feedback/support — there is no video-call
-- attendance signal in v1 (`meeting_link` is a plain Jitsi URL, per 0133's own
-- header), so 72 hours is chosen as plausible time for that complaint to
-- surface before money leaves the platform, not derived from any measured
-- complaint-latency data.
--
-- ── THE BAD-REVIEW-CLAWBACK QUESTION, DECIDED AND WHY ────────────────────────
--
-- A bad review is PURELY INFORMATIONAL and never blocks or claws back a
-- payout. Deliberately, for three reasons:
--   1. A 1-5 star rating is a satisfaction signal, not evidence the session
--      didn't happen or was fraudulent — a mentor can deliver a real,
--      correctly-attended session and still get a bad rating for the advice
--      itself, and that is not a financial dispute.
--   2. Gating real money on a star rating is exactly the kind of fuzzy,
--      discretionary financial gate CLAUDE.md's own atomicity rule argues
--      against in spirit: every payout decision here is a clean boolean
--      (session completed? hold window passed? mentor in good standing?),
--      never "does the aggregate rating clear some threshold this week."
--   3. This schema already has a real, deliberate hold lever that doesn't
--      need inventing: `mentor_profiles.status`. A mentor under genuine
--      dispute can be suspended by an admin (existing `mentor_review`
--      permission, existing UI) — and `attemptPayout` (see
--      src/lib/mentorship/payouts.ts) refuses to pay a session whose mentor is
--      not currently `approved`. That is the hold mechanism: an explicit,
--      attributed admin action, not an automatic reaction to a star count.
--
-- ── IDEMPOTENCY, THE NON-NEGOTIABLE PART ─────────────────────────────────────
--
-- Three separate mechanisms, each closing a different way this could double-
-- pay, mirroring src/lib/billing/fulfill.ts and src/lib/billing/renewals.ts:
--
--   1. `mentor_payouts.session_id` is UNIQUE. `sync_mentor_payout_rows` below
--      is an `INSERT ... ON CONFLICT (session_id) DO NOTHING` — it can run
--      from any number of concurrent cron ticks, forever, and a payout row is
--      created for a given session AT MOST ONCE, ever. This is the same
--      anchor `mentorship_sessions.availability_slot_id` already uses to stop
--      a slot being double-booked.
--   2. `claim_mentor_payout` is ONE `UPDATE ... WHERE status IN ('pending',
--      'failed') ... RETURNING`, the same one-statement check-and-act shape
--      CLAUDE.md requires for anything gating on a compared value
--      (spend_credits_atomic 0035, book_mentor_session 0133). Two concurrent
--      attempts at the same row — a cron tick racing an admin's manual retry,
--      or two overlapping cron ticks — can only ever have one succeed at
--      claiming it; the other gets zero rows back and does nothing. A stale
--      claim (a crashed process left at `processing`) is reclaimable after 15
--      minutes — the workable form of a claim lock docs/production-migration-
--      apply.md already settled on for exactly this failure mode: a bare
--      advisory lock cannot survive a crash, a claim ROW with a TTL can.
--   3. Once claimed, `attemptPayout` (TypeScript, since it calls Paystack's
--      HTTP API mid-flow) follows renewals.ts's own indeterminate-failure
--      shape: a reference Paystack never affirmatively resolved is NEVER
--      abandoned and NEVER retried with a fresh reference — it's re-verified
--      first, exactly the same "settle before you re-attempt" rule that stops
--      a Pass renewal from double-charging a card. Real tests proving this —
--      concurrent-fire, sequential-retry-after-failure, and resume-after-
--      indeterminate — live in tests/mentorship/payout-idempotency.test.ts.
--
-- ── WHY A NEW TABLE, NOT A `payment_transactions` ROW ────────────────────────
--
-- `payment_transactions` is money coming INTO Talentrah — every one of its
-- product types (credit_pack, pass, ad_wallet_topup, talent_directory_
-- subscription, mentor_session) is something a user or org paid Talentrah
-- for. This is the opposite direction, and conflating them would mean a
-- single table's `amount` column sometimes means "charged to" and sometimes
-- "paid out to," which is precisely the kind of ambiguity a real ledger must
-- not have.

-- ── mentor_profiles: bank details, additive only ────────────────────────────
--
-- NONE of these five columns are added to the `authenticated` UPDATE grant
-- below (0133's own grant list is left untouched) — deliberately, mirroring
-- 0028's `organizations.verified`: "no client can write it; it is set
-- server-side... and nowhere else." `payout_account_name` in particular must
-- never be a free-typed field per this task's own brief — it is written ONLY
-- by saveMentorPayoutDetailsAction (src/lib/mentorship/payout-details.ts)
-- after Paystack's own /bank/resolve confirms the name that account number
-- and bank code actually belong to, using the service-role client. A mentor
-- who could PATCH these directly could set an account name that does not
-- match the number, defeating the entire point of resolving it first.
alter table public.mentor_profiles
  add column payout_bank_code text,
  add column payout_account_number text,
  -- Resolved via Paystack's account-resolution endpoint — never client input.
  add column payout_account_name text,
  -- Paystack's transfer-recipient code, created once and reused for every
  -- future payout to this mentor rather than re-created each time.
  add column payout_recipient_code text,
  add column payout_bank_verified_at timestamptz;

comment on column public.mentor_profiles.payout_account_name is
  'Resolved via Paystack /bank/resolve at save time — never trust a free-typed account name. Written only by the service-role save action, never granted to authenticated.';

-- ── mentor_payouts ───────────────────────────────────────────────────────────
create table public.mentor_payouts (
  id uuid primary key default gen_random_uuid(),
  -- UNIQUE is the idempotency anchor for ROW CREATION: sync_mentor_payout_rows'
  -- own ON CONFLICT (session_id) DO NOTHING depends on this existing.
  session_id uuid not null unique references public.mentorship_sessions(id),
  mentor_id uuid not null references public.mentor_profiles(user_id),
  -- Snapshot of mentorship_sessions.mentor_payout_ngn at the moment this row
  -- is created, never re-read later — same "priced once, frozen" reasoning
  -- 0133's own price_ngn/platform_commission_ngn/mentor_payout_ngn triad uses.
  amount_ngn integer not null check (amount_ngn >= 0),
  status text not null default 'pending' check (status in ('pending', 'processing', 'paid', 'failed')),
  eligible_at timestamptz not null,
  attempt_count integer not null default 0,
  -- Set exactly while one attempt's Paystack outcome is unresolved (a
  -- timeout, a 5xx, or Paystack's own "pending"/"otp" transfer status). Kept
  -- — never cleared — until a later run's verify call resolves it one way or
  -- the other. A UNIQUE constraint here (not a partial index — NULLs never
  -- collide under a plain UNIQUE constraint, so every row that has never had
  -- an outstanding attempt is unaffected) means the same reference can never
  -- be attached to two rows at once.
  pending_transfer_reference text unique,
  -- Paystack's own id for a transfer, once known (from initiate or verify).
  paystack_transfer_code text,
  -- Human-readable reason for the most recent failure/indeterminate outcome —
  -- what the admin dashboard shows so "why is this failed" never requires a
  -- log dive.
  failure_reason text,
  last_attempted_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.mentor_payouts is
  'One row per session ever paid out (or attempted). session_id UNIQUE is what makes row-creation idempotent across any number of cron ticks; claim_mentor_payout''s conditional UPDATE is what makes an individual ATTEMPT idempotent under concurrency. Read only by admins (service role) and the payout cron — no client-facing RLS policy at all, same posture as admin_users (0060).';

create index mentor_payouts_status_eligible_idx on public.mentor_payouts (status, eligible_at);
create index mentor_payouts_mentor_id_idx on public.mentor_payouts (mentor_id);

alter table public.mentor_payouts enable row level security;

-- No policies at all, and every privilege revoked from anon/authenticated —
-- exactly 0060's admin_users posture, for the same reason: a missing policy
-- is undone by adding one, in a reviewable diff; a missing grant has to be
-- restored in SQL. A mentor's own payout history is not exposed to them in
-- this v1 slice (out of this task's brief, which asks for ADMIN visibility
-- only) — the admin dashboard reads this table with the service-role client,
-- same as every other admin surface in this repo (financialHealth,
-- pendingMentorApplications, findPerson).
revoke all on public.mentor_payouts from anon, authenticated;

-- ── sync_mentor_payout_rows: creates a payout row for every newly-completed,
-- paid session that doesn't have one yet ──────────────────────────────────
--
-- A free/volunteer session (mentor_payout_ngn = 0, i.e. price_ngn = 0 — see
-- book_mentor_session's own v_payout computation) never gets a row: there is
-- nothing to pay out, and a $0 payout row would just be dashboard noise an
-- admin has to read past.
create or replace function public.sync_mentor_payout_rows()
returns integer
language sql
security definer
set search_path = public
as $$
  with inserted as (
    insert into public.mentor_payouts (session_id, mentor_id, amount_ngn, eligible_at)
    select s.id, s.mentor_id, s.mentor_payout_ngn, s.scheduled_end + interval '72 hours'
    from public.mentorship_sessions s
    where s.status = 'completed'
      and s.mentor_payout_ngn > 0
    on conflict (session_id) do nothing
    returning 1
  )
  select count(*)::integer from inserted;
$$;

revoke all on function public.sync_mentor_payout_rows() from public, anon, authenticated;
grant execute on function public.sync_mentor_payout_rows() to service_role;

comment on function public.sync_mentor_payout_rows() is
  'Idempotent row-creation for eligible sessions — INSERT ... ON CONFLICT (session_id) DO NOTHING, so calling this any number of times from any number of concurrent cron ticks creates at most one mentor_payouts row per session, ever. service_role only.';

-- ── claim_mentor_payout: the one atomic statement the whole payout attempt
-- leans on ───────────────────────────────────────────────────────────────
--
-- Same shape as book_mentor_session (0133) and admin_moderate_mentor_
-- application (0133): a conditional UPDATE ... RETURNING, so two concurrent
-- callers (a cron tick and an admin's manual retry, or two overlapping cron
-- ticks) can only ever have one actually claim a given row.
--
-- The stale-claim TTL (15 minutes) is the workable form of a claim lock this
-- repo already settled on in docs/production-migration-apply.md's own
-- analysis of the migration-apply race: "the workable form is a claim ROW
-- with a TTL... a bare advisory lock cannot survive a crash." Without it, a
-- process that crashed between claiming a row and resolving it would leave
-- that payout stuck at `processing` forever, with no way for anything —
-- automatic or manual — to ever pick it up again.
create or replace function public.claim_mentor_payout(p_payout_id uuid)
returns table (
  id uuid,
  session_id uuid,
  mentor_id uuid,
  amount_ngn integer,
  pending_transfer_reference text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.mentor_payouts mp
     set status = 'processing',
         attempt_count = mp.attempt_count + 1,
         last_attempted_at = now(),
         updated_at = now()
   where mp.id = p_payout_id
     and (
       mp.status in ('pending', 'failed')
       or (mp.status = 'processing' and mp.last_attempted_at < now() - interval '15 minutes')
     )
  returning mp.id, mp.session_id, mp.mentor_id, mp.amount_ngn, mp.pending_transfer_reference, mp.attempt_count;
end;
$$;

revoke all on function public.claim_mentor_payout(uuid) from public, anon, authenticated;
grant execute on function public.claim_mentor_payout(uuid) to service_role;

comment on function public.claim_mentor_payout(uuid) is
  'Atomically claims one payout row for an attempt. Only a row currently pending/failed, or stuck at processing for 15+ minutes (a crashed prior attempt), can be claimed. Returns no row otherwise — the caller must treat that as "someone else has this" and do nothing. service_role only.';
