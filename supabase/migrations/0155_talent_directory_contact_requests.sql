-- 0155 — let an employer actually contact a candidate they find in the
-- Talent Directory. Re-checked list_migrations on both projects immediately
-- before writing this: 0154 was each project's highest applied migration,
-- 0155 was free on both.
--
-- ── THE GAP ────────────────────────────────────────────────────────────
--
-- talent_directory_search (0135) lets a subscribed employer FIND a verified,
-- opted-in candidate. Nothing lets them do anything with the result — no
-- message thread, no contact-info reveal, no request mechanism. Confirmed
-- by grep: no candidate-contact/messaging code exists anywhere under
-- src/lib/talent-directory or src/app/employer/talent-directory.
--
-- ── THE CONSENT MODEL, DECIDED ─────────────────────────────────────────
--
-- TWO-STEP: an employer sends interest (with a short message); the
-- candidate decides whether to let their contact info reach that employer.
-- Opting into the directory (talent_directory_opt_in) makes a candidate
-- DISCOVERABLE — it was never framed, in 0135's own header or anywhere
-- else, as consent to be contacted directly. This codebase is consistently
-- privacy-conservative about exactly this class of question: the referral
-- leaderboard's own header reasons through "this is the first surface where
-- one user's activity is visible to others by default" before landing on
-- opt-in; talent_directory_search's own comment stresses that verified+opt-in
-- is a real search gate, not a formality. A one-step reveal (opting in
-- implies contactable) would be the first time this app hands a seeker's
-- real email to a third party without a decision made at THAT specific
-- moment — a materially bigger step than being findable.
--
-- ── WHETHER CONTACT INFO IS EVER DIRECTLY EXPOSED, DECIDED ─────────────
--
-- Never through the app UI. On approval, the candidate's email is relayed
-- to the SPECIFIC employer who asked via ONE transactional email (Resend,
-- same pattern as proactive-match-alert/send.ts) — never rendered in any
-- page an employer's browser loads. This is deliberately narrower than a
-- full in-app message thread, which would be new, ongoing infrastructure
-- this codebase has none of today (no thread/conversation table anywhere).
-- Building one is a materially larger feature than "let an employer make
-- contact once a candidate agrees" — the same reasoning Mentorship's own
-- migration (0133) picked Jitsi over building real Google Meet OAuth: the
-- lighter option that actually ships beats the fancier one that needs
-- infrastructure that doesn't exist yet. A real in-app thread is a
-- reasonable v2, not a v1 requirement.
--
-- ── WHY A NEW TABLE, MATCHING talent_verifications' OWN SHAPE ──────────
--
-- Narrow and purpose-built, same reference this codebase already has for
-- exactly this kind of record: an audit trail with NO client write policy
-- at all — every write goes through a SECURITY DEFINER function below, the
-- same way talent_verifications' own header describes for
-- resolve_talent_verification/release_talent_verification_claim.
--
-- ── WHY NO NEW RATE-LIMIT TABLE ─────────────────────────────────────────
--
-- consume_anonymous_rate_limit (0117) is already a generic, TEXT-keyed,
-- atomic fixed-window limiter with no assumption about what the key
-- represents (that migration's own header: "keyed on TEXT rather than a
-- user uuid"). An organization_id cast to text fits it exactly — a second,
-- uuid-keyed rate-limit table (mirroring api_rate_limits, 0038, which is
-- keyed on profiles(id) and cannot hold an organization id under its own FK)
-- would be a parallel primitive for the same concept this repo already
-- built once. Bucket 'talent_directory_contact', 20 requests per
-- organization per rolling-fixed 24h window — the same anchor as
-- unlistedLinkMint/jobBannerUpload (src/lib/api/rate-limit.ts): generous
-- against real recruiting activity, tight enough to bound how fast one
-- account could message the entire directory. A researched-anchor guess,
-- like every other number in this app (CLAUDE.md) — not validated.
--
-- ── THE ENTITLEMENT CHECK, MIRRORED NOT SHARED ─────────────────────────
--
-- talent_directory_search's own internal check answers "does auth.uid()
-- belong to ANY org with an active, unexpired subscription" — it has no
-- p_organization_id to check against, because a search isn't scoped to one
-- org for writing anything. This function answers a different question —
-- "does auth.uid() belong to THIS SPECIFIC org (already resolved server-side
-- by requireEmployer(), the same trust boundary claim_external_job_posting's
-- own header documents for p_organization_id), and does THAT org have an
-- active subscription" — genuinely a different query against the same two
-- tables, not a candidate for a single shared function without forcing one
-- of the two callers into an awkward loop. Same criteria, deliberately
-- re-stated rather than shared: active status, expires_at > now(), nothing
-- else.

create table public.talent_directory_contact_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null references public.profiles(id) on delete cascade,
  -- The specific org member who sent it, for audit only — never surfaced to
  -- the candidate as anything but "an employer". SET NULL rather than
  -- CASCADE: if that person later leaves the org or deletes their account,
  -- the org's own request history (and the candidate's decision on it)
  -- should not vanish with them.
  requested_by uuid references public.profiles(id) on delete set null,
  message text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.talent_directory_contact_requests is
  'Audit trail of employer interest sent to a Talent Directory candidate. No client write policy at all — every write goes through request_talent_directory_contact()/respond_to_talent_directory_contact_request() below, the same shape talent_verifications (0135) already establishes.';

-- At most one OUTSTANDING (pending) request per (org, candidate) pair — an
-- employer who wants to try again after a decline may (the audit trail
-- keeps both rows), but cannot queue a second ask on top of one still
-- awaiting an answer. A partial index, not a plain unique constraint, since
-- re-declining and re-approving history for the same pair is legitimate and
-- must not collide with itself.
create unique index talent_directory_contact_requests_pending_idx
  on public.talent_directory_contact_requests (organization_id, candidate_id)
  where status = 'pending';

create index talent_directory_contact_requests_candidate_idx
  on public.talent_directory_contact_requests (candidate_id, created_at desc);

alter table public.talent_directory_contact_requests enable row level security;

create policy "a candidate reads requests addressed to them" on public.talent_directory_contact_requests
  for select to authenticated
  using (candidate_id = auth.uid());

create policy "org members read their own org's sent requests" on public.talent_directory_contact_requests
  for select to authenticated
  using (public.is_org_member(organization_id));

-- No insert/update/delete policy at all — see this migration's own header.

-- ── THE SEND: employer -> candidate ─────────────────────────────────────
--
-- p_organization_id is resolved server-side by the calling Server Action
-- (requireEmployer(), reading membership through the user's own client) and
-- re-checked here against auth.uid() — not a client-forgeable authorisation,
-- the same trust boundary claim_external_job_posting (0128) documents for
-- its own p_organization_id.
create function public.request_talent_directory_contact(
  p_organization_id uuid,
  p_candidate_id uuid,
  p_message text
)
returns table (ok boolean, reason text, request_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_active boolean;
  v_candidate_eligible boolean;
  v_new_id uuid;
  v_limit record;
  v_message text;
begin
  select exists (
    select 1
    from public.organization_members om
    join public.talent_directory_subscriptions s on s.organization_id = om.organization_id
    where om.user_id = auth.uid()
      and om.organization_id = p_organization_id
      and s.status = 'active'
      and s.expires_at > now()
  ) into v_org_active;

  if not v_org_active then
    return query select false, 'not_subscribed'::text, null::uuid; return;
  end if;

  -- Re-verified here, not trusted from whatever the employer's own page last
  -- rendered — a candidate who opted out or lost verification between page
  -- load and this call must not be reachable, the same defense-in-depth
  -- claim_external_job_posting's own header describes for its match check.
  select exists (
    select 1 from public.profiles p
    where p.id = p_candidate_id
      and p.talent_directory_opt_in = true
      and p.talent_verification_status = 'verified'
  ) into v_candidate_eligible;

  if not v_candidate_eligible then
    return query select false, 'candidate_not_listed'::text, null::uuid; return;
  end if;

  v_message := btrim(coalesce(p_message, ''));
  if v_message = '' then
    return query select false, 'message_required'::text, null::uuid; return;
  end if;

  -- Atomic, per this repo's own standing rule for anything gating on a
  -- counted value (CLAUDE.md) — consume_anonymous_rate_limit's own INSERT
  -- ... ON CONFLICT DO UPDATE ... RETURNING is what makes this a real check-
  -- and-act rather than a read-then-write two concurrent requests could both
  -- pass.
  select * into v_limit
  from public.consume_anonymous_rate_limit(p_organization_id::text, 'talent_directory_contact', 20, 86400);

  if not v_limit.allowed then
    return query select false, 'rate_limited'::text, null::uuid; return;
  end if;

  insert into public.talent_directory_contact_requests (organization_id, candidate_id, requested_by, message)
  values (p_organization_id, p_candidate_id, auth.uid(), v_message)
  returning id into v_new_id;

  return query select true, 'ok'::text, v_new_id;
exception
  -- The partial unique index above — a pending request already exists for
  -- this exact pair.
  when unique_violation then
    return query select false, 'already_pending'::text, null::uuid;
end;
$$;

revoke all on function public.request_talent_directory_contact(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.request_talent_directory_contact(uuid, uuid, text) to service_role;

comment on function public.request_talent_directory_contact(uuid, uuid, text) is
  'Employer sends interest in a directory candidate. service_role only — the calling Server Action resolves organization_id via requireEmployer() first. Re-checks the org''s own active subscription and the candidate''s current opt-in+verified state independently, and rate-limits per organization (20/day) via consume_anonymous_rate_limit (0117).';

-- ── THE RESPONSE: candidate -> approve or decline ───────────────────────
--
-- service_role only, same shape as mark_mentor_session_confirmed (0133):
-- the calling Server Action resolves the candidate's own id from their
-- session first, then hands it in as p_candidate_id — checked against the
-- row's own candidate_id inside the function rather than trusted blindly.
create function public.respond_to_talent_directory_contact_request(
  p_request_id uuid,
  p_candidate_id uuid,
  p_approve boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated uuid;
begin
  update public.talent_directory_contact_requests
     set status = case when p_approve then 'approved' else 'declined' end,
         decided_at = now()
   where id = p_request_id
     and candidate_id = p_candidate_id
     and status = 'pending'
  returning id into v_updated;

  return v_updated is not null;
end;
$$;

revoke all on function public.respond_to_talent_directory_contact_request(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.respond_to_talent_directory_contact_request(uuid, uuid, boolean) to service_role;

comment on function public.respond_to_talent_directory_contact_request(uuid, uuid, boolean) is
  'Candidate approves or declines interest addressed to them. service_role only — the calling Server Action resolves the candidate''s own id from their session. Only ever moves a PENDING row belonging to that candidate; a stale double-click or a request that already has a decision is a no-op (returns false), not an error.';
