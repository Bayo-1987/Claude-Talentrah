-- 0135 — Talent Directory & Verification v1 (send-139, build-prompt §6.13).
--
-- ── SCOPE, STATED PLAINLY ───────────────────────────────────────────────────
--
-- §6.13 is a Phase 3 item CLAUDE.md marks deferred until the core
-- job-matching loop proves retention — building it now is a deliberate
-- override per explicit founder instruction to draft the remaining backlog
-- for parallel dispatch, not a claim the deferral reasoning stopped applying.
--
-- Three pieces are deliberately cut from this slice, named rather than
-- silently dropped:
--   * GLOBAL/DIASPORA EMPLOYER BILLING. Blocked on the same unresolved
--     multi-jurisdiction tax/KYC/GDPR legal review CLAUDE.md's own open
--     decisions already flag before any diaspora billing. Nothing here
--     distinguishes a "local" from a "diaspora" organisation with a schema
--     flag — the cut is enforced by omission: this slice builds exactly one
--     billing path (NGN via Paystack, see talent_directory_subscriptions
--     below), so an organisation with no route to a Naira card charge simply
--     has no path to an active subscription. Nothing to gate twice.
--   * HUMAN-REVIEWED VERIFICATION AS A PAID PREMIUM TIER. §6.13's own spec
--     names this as depending on Mentorship's mentor network — which did not
--     exist when send-139 was written (confirmed then via zero
--     Mentor/MentorshipSession scaffolding). Worth stating plainly since it
--     is no longer true by the time this migration lands: Mentorship shipped
--     immediately before this in the same dispatch (send-137). The cut is
--     kept anyway, honouring what THIS prompt actually asked for rather than
--     silently expanding scope because a blocker resolved mid-session — see
--     this PR's own description for why, and flagging human review as a
--     natural v2 lever now that a reviewer pool genuinely exists.
--   * CROSS-BORDER EOR/PAYROLL. Out of scope entirely, per the prompt.
--
-- ── VERIFICATION IS FULLY AUTOMATED IN v1 — NO NEW ADMIN PERMISSION ────────
--
-- Because human review is cut, there is no admin approval queue for
-- verification and therefore no new admin_permission value in this
-- migration (unlike Mentorship's mentor_review) — an AI grade resolves a
-- verification attempt synchronously, in the same request that spent the
-- credits for it. If a paid human-review tier ships later, that is the
-- moment a review queue and its own permission would be added.
--
-- ── WHY talent_portfolio_items IS NOT NAMED "portfolio" ANYTHING ELSE ──────
--
-- "Portfolio" already means something specific in this codebase's own
-- vocabulary — resume_templates has a real `slug = 'portfolio-grid'`
-- template. `talent_portfolio_items` avoids colliding with that meaning.
--
-- ── THE HIGHEST-RISK PART OF THIS SLICE: THE DIRECTORY SEARCH PATH ─────────
--
-- An employer querying across OTHER users' profile data is the same shape of
-- new risk 0125/0126 and referral_leaderboard (0130, cited directly by its
-- own header as anticipating this feature by name) already worked through:
-- widening profiles' own RLS SELECT policy would widen it for every other
-- function/query that inherits that policy too (0107/0108's own lesson,
-- cited throughout this repo). So NOTHING here touches profiles' existing
-- RLS. `talent_directory_search`/`talent_directory_portfolio_items` below
-- are narrow SECURITY DEFINER functions whose own WHERE clause is the ONLY
-- thing standing between "searchable directory" and "every seeker's data" —
-- exactly the reasoning `employer_applicant_status`/`is_org_member_for_application`
-- (0125) and `referral_leaderboard` (0130) already used. Proven directly in
-- tests/rls/talent-directory.test.ts, not assumed from the function's shape.
--
-- ── OPT-IN DEFAULT: FALSE ───────────────────────────────────────────────────
--
-- `talent_directory_opt_in` defaults false — the same "public visibility is
-- a bigger exposure change than anything automatic" reasoning
-- referral_leaderboard's own header already established for a structurally
-- identical decision (a user's data becoming visible to OTHER users by
-- default, for the first time, on that surface). Verification status alone
-- does not list anyone; opting in is a second, independent, explicit choice.
--
-- ── WHAT "VERIFIED" ACTUALLY GATES ──────────────────────────────────────────
--
-- Directory-visible ONLY IF verified AND opted in — both conditions, always,
-- with no path that skips either. Being verified does not itself expose
-- anything; opting in without being verified does not either. This is
-- spelled out because the send-139 prompt only implies the pairing rather
-- than stating it, and every WHERE clause below enforces it literally.
--
-- ── THE SUBSCRIPTION SHAPE: PASS-STYLE, NOT AD-WALLET-STYLE ────────────────
--
-- docs/employer-billing-plan.md's own "looks reusable, is not" section is
-- explicit: a Pass renewal is a fixed-price, fixed-date recharge; ad spend is
-- consumption against a budget. A monthly directory subscription is
-- obviously the former — so `talent_directory_subscriptions` mirrors
-- `user_passes`'s renewal-state columns (auto_renew_status,
-- next_renewal_date, authorization_code, renewal_attempt_count,
-- pending_renewal_reference, last_renewal_failure_at) rather than
-- `ad_wallets`'s prepaid-balance shape, scoped to `organization_id` because
-- `user_passes.user_id` is a hard FK to `profiles` with no org-owned
-- equivalent — reusing that table directly is not possible without breaking
-- its seeker-only shape, so this is a deliberate, parallel table, a
-- structural fork of the renewal job's own logic rather than a call into it
-- (src/lib/billing/renewals.ts is written directly against `user_passes`).

-- ── profiles: opt-in, verification state, availability metadata ───────────

alter table public.profiles
  add column talent_directory_opt_in boolean not null default false,
  add column talent_verification_status text not null default 'unverified'
    check (talent_verification_status in ('unverified', 'pending', 'verified', 'rejected')),
  add column talent_verification_score integer
    check (talent_verification_score is null or (talent_verification_score between 0 and 100)),
  add column talent_verified_at timestamptz,
  add column talent_available_for_hire boolean not null default false,
  add column talent_remote_ready boolean not null default false,
  add column talent_earliest_start_date date;

comment on column public.profiles.talent_directory_opt_in is
  'Default false, deliberately — a second, independent choice from verification. Column-grant-writable by the owner (see below); never implied by anything else.';
comment on column public.profiles.talent_verification_status is
  'unverified -> pending -> verified|rejected. Moves ONLY through runTalentVerification''s service-role writes and resolve_talent_verification()/release_talent_verification_claim() below — never client-writable, same trust-column reasoning as mentor_profiles.status (0132).';

-- 0030's own lesson again: a permissive row-owner UPDATE policy (added below)
-- would otherwise let a user rewrite every column on their own row, including
-- the three trust columns above. Column grant lists only the safe,
-- self-describing metadata; verification state stays out of this list.
revoke update on public.profiles from authenticated;
grant update (
  first_name, last_name, country, locale,
  farah_hint_dismissed_at, resume_skills_notice_dismissed_at, onboarding_skipped_at,
  talent_directory_opt_in, talent_available_for_hire, talent_remote_ready, talent_earliest_start_date
) on public.profiles to authenticated;

-- ── talent_portfolio_items: structured, not free-text ──────────────────────

create table public.talent_portfolio_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  url text,
  created_at timestamptz not null default now()
);

comment on table public.talent_portfolio_items is
  'Structured work-sample entries (send-139: "structured, not free-text"). RLS is OWNER-ONLY, deliberately — this repo''s highest-risk-part reasoning above applies here too: an employer reads another user''s items only through talent_directory_portfolio_items(), never through a widened SELECT policy on this table.';

alter table public.talent_portfolio_items enable row level security;

create policy "a user manages their own portfolio items" on public.talent_portfolio_items
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── talent_verifications: one row per AI-graded attempt, the audit trail ──

create table public.talent_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  ai_score integer check (ai_score is null or (ai_score between 0 and 100)),
  ai_feedback text,
  credit_ledger_id uuid references public.credit_ledger(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_at timestamptz
);

comment on table public.talent_verifications is
  'Audit trail of AI-graded verification attempts. profiles.talent_verification_status/_score/_verified_at (denormalised for the directory search WHERE clause) are kept in sync by resolve_talent_verification() below, in the same statement — never by a client write.';

alter table public.talent_verifications enable row level security;

create policy "a user reads their own verification history" on public.talent_verifications
  for select to authenticated
  using (user_id = auth.uid());

-- No client insert/update/delete policy at all — every write goes through
-- request_talent_verification_action's service-role calls and
-- resolve_talent_verification()/release_talent_verification_claim() below.

-- ── talent_directory_plans: a tiny catalog, same shape as `passes` ─────────

create table public.talent_directory_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_ngn integer not null,
  duration_days integer not null default 30,
  is_active boolean not null default true
);

comment on table public.talent_directory_plans is
  'Sourcing-tier subscription catalog, same extensibility shape as `passes` — new tiers are a seed row, not a migration. §6.13''s own researched anchor is ₦150k-250k/month, NOT VALIDATED, same caveat as every other price in this app.';

alter table public.talent_directory_plans enable row level security;

create policy "the active plan catalog is publicly readable" on public.talent_directory_plans
  for select to authenticated
  using (is_active = true);

insert into public.talent_directory_plans (name, price_ngn, duration_days) values
  ('Local Sourcing — Monthly', 200000, 30);

-- ── talent_directory_subscriptions: the Pass-shaped, org-owned recharge ────

create table public.talent_directory_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.talent_directory_plans(id),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- 'pending_payment' is the initial state, exactly mirroring 0132's own
  -- mentor_session pattern: the row exists (so payment_transactions.product_id
  -- has something to point at) before payment is confirmed, but it grants NO
  -- access until fulfillPayment flips it to 'active' — talent_directory_search
  -- and talent_directory_portfolio_items only ever check status='active', so
  -- an abandoned or failed checkout never becomes directory access nobody
  -- paid for.
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'active', 'lapsed', 'canceled')),
  auto_renew_status text check (auto_renew_status in ('active', 'canceled', 'lapsed')),
  next_renewal_date date,
  authorization_code text,
  renewal_attempt_count integer not null default 0,
  pending_renewal_reference text,
  last_renewal_failure_at timestamptz,
  renewal_reminder_sent_at timestamptz,
  payment_transaction_id uuid references public.payment_transactions(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.talent_directory_subscriptions is
  'Org-owned, Pass-shaped monthly subscription (renewal columns mirror user_passes) — see 0135''s own header for why this is a parallel table rather than a reuse of user_passes, whose user_id is a hard profiles FK with no org-owned equivalent.';

-- Only one ACTIVE subscription per org — a second purchase while one is
-- already active would be a duplicate charge waiting to happen, not a
-- legitimate second seat (this slice sells directory ACCESS, not per-seat
-- licensing).
create unique index talent_directory_subscriptions_one_active_per_org
  on public.talent_directory_subscriptions (organization_id)
  where status = 'active';

alter table public.talent_directory_subscriptions enable row level security;

create policy "an org member reads their own org's subscription" on public.talent_directory_subscriptions
  for select to authenticated
  using (public.is_org_member(organization_id));

-- No client insert/update policy — purchase is a service-role write from the
-- initiating Server Action (same shape as payment_transactions itself, which
-- has never had a client insert policy since 0006), and renewal is the daily
-- cron's service-role write, mirroring runPassRenewalJob exactly.

-- ── payment_transactions: the fourth direct-payment product type ──────────

alter table public.payment_transactions
  add constraint payment_transactions_talent_directory_subscription_requires_product
  check (product_type <> 'talent_directory_subscription' or product_id is not null);

-- ── resolve_talent_verification: the atomic two-table state flip ──────────
--
-- talent_verifications AND profiles must move together — a partial write
-- (the attempt marked verified but the denormalised profile column left
-- stale, or vice versa) would make the directory search function's WHERE
-- clause disagree with the audit trail. Guarded by `status = 'pending'` on
-- the first UPDATE so this is idempotent: calling it twice for the same
-- attempt is a no-op the second time, not a double-grant.
create or replace function public.resolve_talent_verification(
  p_verification_id uuid,
  p_user_id uuid,
  p_verified boolean,
  p_score integer,
  p_feedback text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_status text := case when p_verified then 'verified' else 'rejected' end;
  v_updated uuid;
begin
  update public.talent_verifications
     set status = v_new_status, ai_score = p_score, ai_feedback = p_feedback, decided_at = now()
   where id = p_verification_id and user_id = p_user_id and status = 'pending'
  returning id into v_updated;

  if v_updated is null then
    return false;
  end if;

  update public.profiles
     set talent_verification_status = v_new_status,
         talent_verification_score = p_score,
         talent_verified_at = case when p_verified then now() else null end
   where id = p_user_id;

  return true;
end;
$$;

revoke all on function public.resolve_talent_verification(uuid, uuid, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.resolve_talent_verification(uuid, uuid, boolean, integer, text) to service_role;

-- ── release_talent_verification_claim: the compensating rollback ──────────
--
-- Mirrors auto_apply_claim_submission's own "claim first, release on
-- failure" idiom (0034) — runTalentVerification claims 'pending'
-- BEFORE the LLM call and credit spend; if either fails (a balance that
-- changed mid-request is the documented, accepted race — same shape
-- scholarship actions already accept), this reverts the claim so the user
-- can simply retry rather than being stuck 'pending' forever with nothing
-- to resolve it.
create or replace function public.release_talent_verification_claim(
  p_user_id uuid,
  p_verification_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set talent_verification_status = 'unverified'
   where id = p_user_id and talent_verification_status = 'pending';

  delete from public.talent_verifications
   where id = p_verification_id and user_id = p_user_id and status = 'pending';
end;
$$;

revoke all on function public.release_talent_verification_claim(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_talent_verification_claim(uuid, uuid) to service_role;

-- ── talent_directory_search / talent_directory_portfolio_items ─────────────
--
-- Both SECURITY DEFINER, both re-derive the caller's entitlement from
-- auth.uid() (never a client-supplied organization id — the same reasoning
-- `employer_job_applicants`/`employer_view_resume` (0125) already state for
-- why they never take an org id as an argument), and both repeat the SAME
-- verified+opt-in WHERE clause independently rather than sharing a view, so
-- neither can be reached by forgetting the other's guard.
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

  -- p_candidate_id is how the candidate DETAIL page reuses this exact
  -- function (and its exact entitlement + verified+opt-in WHERE clause)
  -- rather than a second lookup path — a stale or guessed id that no
  -- longer qualifies returns zero rows here, the same as a plain search
  -- that matches nothing.
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
    order by p.talent_verified_at desc
    limit least(coalesce(p_limit, 20), 50)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.talent_directory_search(boolean, boolean, integer, integer, uuid) from public, anon;
grant execute on function public.talent_directory_search(boolean, boolean, integer, integer, uuid) to authenticated;

create or replace function public.talent_directory_portfolio_items(p_candidate_id uuid)
returns table (id uuid, title text, description text, url text)
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

  if not exists (
    select 1 from public.profiles p
    where p.id = p_candidate_id
      and p.talent_directory_opt_in = true
      and p.talent_verification_status = 'verified'
  ) then
    return;
  end if;

  return query
    select i.id, i.title, i.description, i.url
    from public.talent_portfolio_items i
    where i.user_id = p_candidate_id
    order by i.created_at;
end;
$$;

revoke all on function public.talent_directory_portfolio_items(uuid) from public, anon;
grant execute on function public.talent_directory_portfolio_items(uuid) to authenticated;
