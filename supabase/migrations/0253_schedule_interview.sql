-- 0253: schedule an interview. An employer offers 2 to 5 times for an application; the applicant books ONE; a time is booked by one person only (SCHEDULE-INTERVIEW, owner spec 10 Oct 2026; number assigned by the owner).
--
-- WHAT IT ADDS (all new; no existing table is altered; ONE small AFTER trigger is added, on employer_applicant_status, firing only on the value 'not_a_fit'; nothing is attached to applications):
--   public.interview_offers    one row per offer: the application, the job and the organisation (copied from the posting by the function, never from input), who made it, kind (video / phone / in_person), a note (<= 500 chars), status open | booked.
--                              UNIQUE (application_id) WHERE status = 'open': one open offer per application.
--   public.interview_slots     the offered times: starts_at (timestamptz, stored in UTC) and a length of 15 to 240 minutes. Two to five per offer (the function enforces the count).
--   public.interview_bookings  one row per booked interview (status booked | cancelled). THIS IS THE ATOMIC CLAIM: UNIQUE (offer_id), UNIQUE (slot_id) and UNIQUE (job_posting_id, starts_at) WHERE status = 'booked' (a cancelled time is free again). Two tabs, or two
--                              applicants offered the same time for one job: exactly one INSERT succeeds and the other gets 'slot_taken' ("That time was just taken"). Nothing else creates a booking, and no client can write any of these tables.
--   public.interview_offer_state(offer)            the single definition of "is this invitation still open": booked | cancelled | closed_job | closed_rejected | open | not_found. Read by the booking function and by the application.
--   public.create_interview_offer(...)             employer side; ownership and every rule checked in SQL; one unit of the organisation's 20/day message allowance (0256 claim_applicant_message) is claimed LAST.
--   public.book_interview_slot(...)                applicant side; ownership checked in SQL; atomic.
--   public.interview_overlaps(...)                 read for the UI-only warning (never a block): which BOOKED interviews of the same organisation overlap the times being offered.
--   public.cancel_stale_interview_bookings(), claim_interview_cancellation_emails(), release_interview_cancellation_email(): the backstop sweeper and the claim-once email.
--
-- WHEN A BOOKED INTERVIEW IS CANCELLED (owner decision, 10 Oct, v3). ONLY when the EMPLOYER marks the applicant 'not_a_fit' (employer_applicant_status.status). That is the only negative outcome the employer side has: its six values are new, reviewing, shortlisted,
-- interviewing, hired, not_a_fit, with no rejected / archived value, and no candidate "Withdraw application" action exists anywhere in the app. NOTHING on applications.stage cancels anything: a candidate archiving or rejecting a card in their OWN Job Tracker is their private record and
-- cancels no interview, books no time away and tells no employer. Closing the JOB does not cancel a booked interview either (an agreed time is not undone by a status change on the job), and 'hired' does not cancel (the interview is then part of a hire). The one trigger
-- (AFTER INSERT OR UPDATE OF status ON employer_applicant_status, firing only when the new value is 'not_a_fit') calls one idempotent function that sets the booking to 'cancelled' and its offer to 'cancelled' (the time is freed for others). A trigger that fails must never block
-- the employer's own action, so it swallows its error with a warning, and cancel_stale_interview_bookings() (called by the same daily routine that sends the cancellation emails) is the backstop that cancels anything the trigger missed. Moving the status back OUT of not_a_fit
-- later does not revive a cancelled booking (the time may already have been taken); the employer offers new times.
-- AN OPEN OFFER (nothing booked yet) is decided LIVE by interview_offer_state at the moment of booking and whenever a page lists offers: it is closed when the job is not open, or the employer marked the applicant 'not_a_fit' or 'hired'. Nothing the candidate does to their own
-- tracker card closes it (applications.stage is not read there). No trigger is needed for an open offer, so none can be forgotten.
-- THREE MORE CLOSE-OUTS (owner conditions, 10 Oct). (1) EXPIRED: an OPEN offer whose offered times have ALL passed closes itself: interview_offer_state answers 'expired' (live, no write needed), the booking function answers 'expired', create_interview_offer marks such an offer 'expired' before it looks for an open one (so it can never block a new invitation) and expire_interview_offers() (the daily routine) marks them. The 20/day unit it claimed is neither refunded nor counted again: nothing here touches applicant_messages. (2) CANDIDATE DELETION: when an applicant asks to delete their account (profiles.deletion_requested_at set, the 30-day window of 0212), ONE AFTER trigger closes their open offers and cancels their booked interviews (reason 'candidate_deleted'), marks the email as handled so NO email goes to the leaving account, and sends nobody a message; the employer's page just shows the interview cancelled. A hard delete later cascades every row away. Restoring the account does not revive a cancelled interview. (3) REMINDERS: bookings.reminder_sent_at and claim_interview_reminders(from, to, limit) / release_interview_reminder(booking): the same claim-once pattern as the cancellation email and the 0254 digest, so a reminder goes out once per booking, never to a cancelled booking or an account that asked to be deleted.
-- THE CANCELLATION EMAIL goes to the party who did NOT act, and to nobody else: the employer acted, so the APPLICANT is told, ONE neutral email (no reason, no "not a fit"). It is claimed exactly once per booking: claim_interview_cancellation_emails sets cancellation_email_sent_at with a
-- conditional UPDATE (skip locked), so a trigger that fires twice, two overlapping runs, or a retry send ONE email; release_interview_cancellation_email puts it back if the send failed. The claim names its recipient ('applicant', derived from who acted); there is no second recipient and no
-- employer email, because no candidate-side cancel exists. The trigger sends nothing itself. Manual cancel / reschedule is a later feature.
--
-- THE 20/DAY ALLOWANCE (ONE counter, owner rule: invitations share the organisation's 20 messages a day). The counter is 0256's public.claim_applicant_message(p_organization_id, p_application_id, p_job_posting_id, p_sender_user_id, p_kind, p_subject, p_body, p_daily_limit default 20) returns uuid:
-- one call takes a per-organisation advisory lock, counts today's (UTC) live rows and inserts one, so overlapping calls cannot both pass; it returns NULL, writing nothing, when the 20 are used. create_interview_offer calls it LAST, at run time, with kind 'interview_invite', and never anywhere else:
-- booking, confirmations, reminders, calendar files, 'None of these work' and cancellation notices do not touch it. ORDER: 0256 applies BEFORE 0253 in every hosted environment, but CI applies in numeric order (0253 first), so this migration neither requires nor calls that function at
-- creation or in its self-check (PL/pgSQL resolves the name only when create_interview_offer RUNS). The claim and the offer insert happen in the same transaction: if anything after the claim fails, the whole call rolls back and the unit is not lost. If the offer insert loses a race (another
-- open offer for the same application won), the claim is marked failed in the same call so the unit is returned. The claim's id is stored on the offer (message_id, no foreign key: the table belongs to 0256) and returned, so the app can free the unit if the invitation EMAIL later fails to send.
-- create_interview_offer validates everything else BEFORE claiming, so a refused call creates nothing and spends nothing.
--
-- STAGE. Booking moves the application from saved / applied to the existing stage 'interviewing' (never backwards from interviewing, offer, hired, rejected or archived) and the employer's applicant status from new / reviewing / shortlisted to 'interviewing'. The
-- applicant-facing label "Interview scheduled, <date>" is shown by the application from the booking; no enum value is added (the 0037 transition rule and every reader of the stage stay as they are).
--
-- ACCESS. RLS is on and ALL privileges are revoked from anon and authenticated: no policies, no column grants. Every read and write is a Server Action or route with the service role, after its own session and membership checks, calling the functions below (SECURITY DEFINER, empty search_path,
-- EXECUTE for service_role only: the 0249 / spend_credits_atomic shape). ADDITIVE for the running app: nothing deployed names any of this; applied BEFORE the code that uses it merges. Exact undo: supabase/rollbacks/0253_schedule_interview.rollback.sql.

create table public.interview_offers (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.applications (id) on delete cascade,
  job_posting_id  uuid not null references public.job_postings (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by      uuid references public.profiles (id) on delete set null,
  kind            text not null check (kind in ('video', 'phone', 'in_person')),
  note            text check (note is null or char_length(note) <= 500),
  status          text not null default 'open' check (status in ('open', 'booked', 'cancelled', 'expired')),
  message_id      uuid,
  created_at      timestamptz not null default now()
);
create unique index interview_offers_one_open_per_application on public.interview_offers (application_id) where status = 'open';
create index interview_offers_organization_idx on public.interview_offers (organization_id, created_at desc);
create index interview_offers_job_idx on public.interview_offers (job_posting_id);

create table public.interview_slots (
  id               uuid primary key default gen_random_uuid(),
  offer_id         uuid not null references public.interview_offers (id) on delete cascade,
  starts_at        timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 15 and 240),
  constraint interview_slots_offer_time_unique unique (offer_id, starts_at)
);
create index interview_slots_offer_idx on public.interview_slots (offer_id);

create table public.interview_bookings (
  id                         uuid primary key default gen_random_uuid(),
  offer_id                   uuid not null references public.interview_offers (id) on delete cascade,
  slot_id                    uuid not null references public.interview_slots (id) on delete cascade,
  application_id             uuid not null references public.applications (id) on delete cascade,
  job_posting_id             uuid not null references public.job_postings (id) on delete cascade,
  organization_id            uuid not null references public.organizations (id) on delete cascade,
  starts_at                  timestamptz not null,
  duration_minutes           integer not null check (duration_minutes between 15 and 240),
  status                     text not null default 'booked' check (status in ('booked', 'cancelled')),
  booked_at                  timestamptz not null default now(),
  cancelled_at               timestamptz,
  cancel_reason              text check (cancel_reason in ('not_a_fit', 'candidate_deleted')),
  cancellation_email_sent_at timestamptz,
  reminder_sent_at           timestamptz,
  constraint interview_bookings_one_per_offer unique (offer_id),
  constraint interview_bookings_one_per_slot unique (slot_id),
  constraint interview_bookings_cancelled_has_reason check ((status = 'cancelled') = (cancelled_at is not null and cancel_reason is not null))
);
-- A cancelled time is free again: the per-(job, time) key only binds BOOKED rows.
create unique index interview_bookings_one_per_job_time on public.interview_bookings (job_posting_id, starts_at) where status = 'booked';
create index interview_bookings_org_time_idx on public.interview_bookings (organization_id, starts_at) where status = 'booked';
create index interview_bookings_email_due_idx on public.interview_bookings (cancelled_at) where status = 'cancelled' and cancellation_email_sent_at is null;
create index interview_bookings_reminder_due_idx on public.interview_bookings (starts_at) where status = 'booked' and reminder_sent_at is null;

comment on table public.interview_bookings is
  '0253: one row per booked interview. The unique keys ARE the atomic claim: one booking per offer, per slot, and per (job, start time) while booked. Written only by book_interview_slot and the cancel functions. No client access.';

alter table public.interview_offers enable row level security;
alter table public.interview_slots enable row level security;
alter table public.interview_bookings enable row level security;
revoke all on table public.interview_offers from public, anon, authenticated;
revoke all on table public.interview_slots from public, anon, authenticated;
revoke all on table public.interview_bookings from public, anon, authenticated;

-- The one definition of "still open". Reads the employer's own status, the job, the offered times and whether the applicant asked to delete their account; NEVER the candidate's tracker stage.
create or replace function public.interview_offer_state(p_offer uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $f$
declare
  v record;
begin
  select o.status as ostatus, j.status as jstatus, eas.status as astatus, pr.deletion_requested_at as deleting,
         exists (select 1 from public.interview_slots s where s.offer_id = o.id and s.starts_at > pg_catalog.now()) as has_future
    into v
    from public.interview_offers o
    join public.applications a on a.id = o.application_id
    join public.profiles pr on pr.id = a.user_id
    join public.job_postings j on j.id = o.job_posting_id
    left join public.employer_applicant_status eas on eas.application_id = o.application_id
   where o.id = p_offer;
  if not found then return 'not_found'; end if;
  if v.ostatus = 'booked' then return 'booked'; end if;
  if v.ostatus = 'cancelled' then return 'cancelled'; end if;
  if v.ostatus = 'expired' then return 'expired'; end if;
  if v.jstatus is distinct from 'open'::public.job_status then return 'closed_job'; end if;
  if v.astatus in ('not_a_fit'::public.applicant_review_status, 'hired'::public.applicant_review_status) then return 'closed_rejected'; end if;
  if v.deleting is not null then return 'closed_deleted'; end if;
  if not v.has_future then return 'expired'; end if;
  return 'open';
end
$f$;
revoke all on function public.interview_offer_state(uuid) from public, anon, authenticated;
grant execute on function public.interview_offer_state(uuid) to service_role;
comment on function public.interview_offer_state(uuid) is
  '0253: is this interview invitation still open? booked | cancelled | expired (every offered time has passed) | closed_job | closed_rejected (employer marked not_a_fit or hired) | closed_deleted (the applicant asked to delete their account) | open | not_found. Live check; the candidate''s own tracker stage is never read. service_role only.';

-- Employer side. Returns (ok, outcome, offer_id, message_id). Outcomes: created, not_found (unknown application, or the caller is not a member of the organisation that owns the job: the same answer for both), job_not_open, application_closed, bad_kind, bad_note, bad_slots, already_open, rate_limited. A previous open offer whose times have all passed is expired first and does not block.
-- message_id is the id of the 0256 applicant_messages row that counted this invitation against the 20/day allowance (null unless created); the app frees that unit if the invitation email later fails to send.
create or replace function public.create_interview_offer(p_user uuid, p_application uuid, p_kind text, p_note text, p_slots jsonb)
returns table (ok boolean, outcome text, offer_id uuid, message_id uuid)
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_job uuid;
  v_org uuid;
  v_jstatus public.job_status;
  v_jsource public.job_source_type;
  v_title text;
  v_applied timestamptz;
  v_deleting timestamptz;
  v_astatus public.applicant_review_status;
  v_note text := nullif(pg_catalog.btrim(p_note), '');
  v_n integer;
  v_cnt integer;
  v_distinct integer;
  v_zoned integer;
  v_min timestamptz;
  v_max timestamptz;
  v_dmin integer;
  v_dmax integer;
  v_claim uuid;
  v_offer uuid;
begin
  select a.job_posting_id, a.applied_at, pr.deletion_requested_at, j.organization_id, j.status, j.source_type, j.title
    into v_job, v_applied, v_deleting, v_org, v_jstatus, v_jsource, v_title
    from public.applications a
    join public.job_postings j on j.id = a.job_posting_id
    join public.profiles pr on pr.id = a.user_id
   where a.id = p_application;
  if not found or v_org is null or v_jsource is distinct from 'internal'::public.job_source_type then
    return query select false, 'not_found'::text, null::uuid, null::uuid; return;
  end if;
  if not exists (select 1 from public.organization_members m where m.organization_id = v_org and m.user_id = p_user) then
    return query select false, 'not_found'::text, null::uuid, null::uuid; return;
  end if;
  if v_jstatus is distinct from 'open'::public.job_status then
    return query select false, 'job_not_open'::text, null::uuid, null::uuid; return;
  end if;
  select eas.status into v_astatus from public.employer_applicant_status eas where eas.application_id = p_application;
  -- Eligibility is what the employer can SEE (employer_job_applicants: applied, applicant not deleting) plus the employer's OWN status. The candidate's private tracker stage (applications.stage) is never read here: the employer must not be able to learn it.
  if v_applied is null or v_deleting is not null or v_astatus in ('not_a_fit'::public.applicant_review_status, 'hired'::public.applicant_review_status) then
    return query select false, 'application_closed'::text, null::uuid, null::uuid; return;
  end if;
  if p_kind is null or p_kind not in ('video', 'phone', 'in_person') then
    return query select false, 'bad_kind'::text, null::uuid, null::uuid; return;
  end if;
  if v_note is not null and pg_catalog.char_length(v_note) > 500 then
    return query select false, 'bad_note'::text, null::uuid, null::uuid; return;
  end if;
  v_n := case when p_slots is not null and pg_catalog.jsonb_typeof(p_slots) = 'array' then pg_catalog.jsonb_array_length(p_slots) else 0 end;
  if v_n < 2 or v_n > 5 then
    return query select false, 'bad_slots'::text, null::uuid, null::uuid; return;
  end if;
  begin
    select pg_catalog.count(*), pg_catalog.count(distinct s.t), pg_catalog.count(*) filter (where s.zoned), pg_catalog.min(s.t), pg_catalog.max(s.t), pg_catalog.min(s.d), pg_catalog.max(s.d)
      into v_cnt, v_distinct, v_zoned, v_min, v_max, v_dmin, v_dmax
      from (select (e ->> 'starts_at')::timestamptz as t,
                   (e ->> 'duration_minutes')::integer as d,
                   coalesce((e ->> 'starts_at') ~ '(Z|[+-][0-9]{2}:?[0-9]{2})$', false) as zoned
              from pg_catalog.jsonb_array_elements(p_slots) e) s;
  exception when others then
    return query select false, 'bad_slots'::text, null::uuid, null::uuid; return;
  end;
  -- every time carries an explicit UTC offset, all distinct, between one hour and 60 days from now; every length is 15 to 240
  if v_cnt is distinct from v_n or v_distinct is distinct from v_n or v_zoned is distinct from v_n
     or v_min is null or v_min < pg_catalog.now() + interval '1 hour' or v_max > pg_catalog.now() + interval '60 days'
     or v_dmin is null or v_dmin < 15 or v_dmax > 240 then
    return query select false, 'bad_slots'::text, null::uuid, null::uuid; return;
  end if;
  -- an open offer whose times have all passed has expired: close it now so it can never block a new invitation (its claimed 20/day unit stays counted; nothing here touches applicant_messages)
  update public.interview_offers o set status = 'expired'
   where o.application_id = p_application and o.status = 'open'
     and not exists (select 1 from public.interview_slots sl where sl.offer_id = o.id and sl.starts_at > pg_catalog.now());
  if exists (select 1 from public.interview_offers o where o.application_id = p_application and o.status = 'open') then
    return query select false, 'already_open'::text, null::uuid, null::uuid; return;
  end if;
  -- The ONE 20/day counter (0256), claimed LAST. It is resolved when this function RUNS, not when it is created. NULL = the organisation has used its 20 for the UTC day and nothing was written.
  v_claim := public.claim_applicant_message(v_org, p_application, v_job, p_user, 'interview_invite',
                                            pg_catalog.left('Interview invitation: ' || coalesce(nullif(pg_catalog.btrim(v_title), ''), 'a role'), 200),
                                            'Interview invitation (times offered).', 20);
  if v_claim is null then
    return query select false, 'rate_limited'::text, null::uuid, null::uuid; return;
  end if;
  insert into public.interview_offers (application_id, job_posting_id, organization_id, created_by, kind, note, message_id)
  values (p_application, v_job, v_org, p_user, p_kind, v_note, v_claim)
  on conflict (application_id) where status = 'open' do nothing
  returning id into v_offer;
  if v_offer is null then
    -- lost the race to another open offer for this application: hand the unit back (conditional, so it happens once)
    update public.applicant_messages set status = 'failed', failure_reason = 'interview offer not created: another open offer exists' where id = v_claim and status = 'claimed';
    return query select false, 'already_open'::text, null::uuid, null::uuid; return;
  end if;
  insert into public.interview_slots (offer_id, starts_at, duration_minutes)
  select v_offer, (e ->> 'starts_at')::timestamptz, (e ->> 'duration_minutes')::integer from pg_catalog.jsonb_array_elements(p_slots) e;
  return query select true, 'created'::text, v_offer, v_claim;
end
$f$;
revoke all on function public.create_interview_offer(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_interview_offer(uuid, uuid, text, text, jsonb) to service_role;
comment on function public.create_interview_offer(uuid, uuid, text, text, jsonb) is
  '0253: an organisation member offers 2 to 5 future times (explicit UTC offsets) for one applied application of their own job; claims one unit of the shared 20/day allowance (0256 claim_applicant_message) last. Never reads the candidate''s tracker stage. Returns (ok, outcome, offer_id, message_id). service_role only.';

-- Applicant side. Returns (ok, outcome, booking_id, starts_at). Outcomes: booked, not_found, not_owner, offer_closed, expired (every offered time has passed), already_booked, too_late (this one time has passed), slot_taken.
create or replace function public.book_interview_slot(p_user uuid, p_slot uuid)
returns table (ok boolean, outcome text, booking_id uuid, starts_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_offer uuid;
  v_app uuid;
  v_job uuid;
  v_owner uuid;
  v_start timestamptz;
  v_dur integer;
  v_org uuid;
  v_state text;
  v_booking uuid;
  v_con text;
begin
  select o.id, o.application_id, o.job_posting_id, o.organization_id, a.user_id, s.starts_at, s.duration_minutes
    into v_offer, v_app, v_job, v_org, v_owner, v_start, v_dur
    from public.interview_slots s
    join public.interview_offers o on o.id = s.offer_id
    join public.applications a on a.id = o.application_id
   where s.id = p_slot
     for update of o;
  if not found then
    return query select false, 'not_found'::text, null::uuid, null::timestamptz; return;
  end if;
  if v_owner is distinct from p_user then
    return query select false, 'not_owner'::text, null::uuid, null::timestamptz; return;
  end if;
  v_state := public.interview_offer_state(v_offer);
  if v_state = 'booked' then
    return query select false, 'already_booked'::text, null::uuid, null::timestamptz; return;
  elsif v_state = 'expired' then
    return query select false, 'expired'::text, null::uuid, null::timestamptz; return;
  elsif v_state = 'cancelled' then
    return query select false, 'offer_closed'::text, null::uuid, null::timestamptz; return;
  elsif v_state <> 'open' then
    return query select false, 'offer_closed'::text, null::uuid, null::timestamptz; return;
  end if;
  if v_start <= pg_catalog.now() then
    return query select false, 'too_late'::text, null::uuid, null::timestamptz; return;
  end if;
  begin
    insert into public.interview_bookings (offer_id, slot_id, application_id, job_posting_id, organization_id, starts_at, duration_minutes)
    values (v_offer, p_slot, v_app, v_job, v_org, v_start, v_dur)
    returning id into v_booking;
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    return query select false, (case v_con when 'interview_bookings_one_per_offer' then 'already_booked' else 'slot_taken' end)::text, null::uuid, null::timestamptz; return;
  end;
  update public.interview_offers set status = 'booked' where id = v_offer;
  update public.applications set stage = 'interviewing'::public.application_stage, updated_at = pg_catalog.now()
   where id = v_app and stage in ('saved'::public.application_stage, 'applied'::public.application_stage);
  insert into public.employer_applicant_status (application_id, status) values (v_app, 'interviewing'::public.applicant_review_status)
  on conflict (application_id) do update set status = 'interviewing'::public.applicant_review_status, updated_at = pg_catalog.now()
   where public.employer_applicant_status.status in ('new'::public.applicant_review_status, 'reviewing'::public.applicant_review_status, 'shortlisted'::public.applicant_review_status);
  return query select true, 'booked'::text, v_booking, v_start;
end
$f$;
revoke all on function public.book_interview_slot(uuid, uuid) from public, anon, authenticated;
grant execute on function public.book_interview_slot(uuid, uuid) to service_role;
comment on function public.book_interview_slot(uuid, uuid) is
  '0253: the applicant books one offered time. Atomic: the unique keys on interview_bookings decide, the loser gets slot_taken. Ownership checked here. Moves the application to interviewing (never backwards). service_role only.';

-- UI-only warning (never a block): which BOOKED interviews of this organisation overlap each time being offered. Empty for a non-member or malformed input. Returns (slot_index, booking_id, application_id, job_posting_id, starts_at, duration_minutes).
create or replace function public.interview_overlaps(p_user uuid, p_organization uuid, p_slots jsonb)
returns table (slot_index integer, booking_id uuid, application_id uuid, job_posting_id uuid, starts_at timestamptz, duration_minutes integer)
language plpgsql
stable
security definer
set search_path = ''
as $f$
begin
  if p_slots is null or pg_catalog.jsonb_typeof(p_slots) <> 'array' or pg_catalog.jsonb_array_length(p_slots) > 5
     or not exists (select 1 from public.organization_members m where m.organization_id = p_organization and m.user_id = p_user) then
    return;
  end if;
  return query
    select (x.ord - 1)::integer, b.id, b.application_id, b.job_posting_id, b.starts_at, b.duration_minutes
      from (select e.ord, (e.v ->> 'starts_at')::timestamptz as t, (e.v ->> 'duration_minutes')::integer as d
              from pg_catalog.jsonb_array_elements(p_slots) with ordinality as e(v, ord)) x
      join public.interview_bookings b
        on b.organization_id = p_organization and b.status = 'booked'
       and pg_catalog.tstzrange(b.starts_at, b.starts_at + pg_catalog.make_interval(mins => b.duration_minutes)) && pg_catalog.tstzrange(x.t, x.t + pg_catalog.make_interval(mins => x.d))
     order by x.ord, b.starts_at;
exception when others then
  return;
end
$f$;
revoke all on function public.interview_overlaps(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.interview_overlaps(uuid, uuid, jsonb) to service_role;
comment on function public.interview_overlaps(uuid, uuid, jsonb) is
  '0253: booked interviews of the organisation that overlap each proposed time (for a UI warning, never a block). Empty for a non-member. service_role only.';

-- Cancels the BOOKED interview of one application (idempotent: a second call finds nothing booked). Internal: no role may call it directly. The reason is the EMPLOYER's act; there is no candidate-side reason.
create or replace function public.cancel_interview_for_application(p_application uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_offer uuid;
  v_n integer := 0;
begin
  update public.interview_bookings
     set status = 'cancelled', cancelled_at = pg_catalog.now(), cancel_reason = p_reason
   where application_id = p_application and status = 'booked'
  returning offer_id into v_offer;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    update public.interview_offers set status = 'cancelled' where id = v_offer;
  end if;
  return v_n;
end
$f$;
revoke all on function public.cancel_interview_for_application(uuid, text) from public, anon, authenticated;

create or replace function public.interview_cancel_on_applicant_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $f$
begin
  perform public.cancel_interview_for_application(new.application_id, 'not_a_fit');
  return new;
exception when others then
  raise warning '0253: interview_cancel_on_applicant_status failed for application %: %', new.application_id, sqlerrm;
  return new;
end
$f$;
revoke all on function public.interview_cancel_on_applicant_status() from public, anon, authenticated;

create trigger interview_cancel_on_applicant_status
  after insert or update of status on public.employer_applicant_status
  for each row when (new.status = 'not_a_fit'::public.applicant_review_status)
  execute function public.interview_cancel_on_applicant_status();

-- Candidate deletion (0212's 30-day window): close the person's open offers and cancel their booked interviews. Nobody is emailed: the booking is marked as already handled
-- (cancellation_email_sent_at) and claim_interview_cancellation_emails only ever returns not_a_fit cancellations. Idempotent; returns how many bookings it cancelled.
create or replace function public.cancel_interviews_for_deleting_applicant(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_n integer;
begin
  with c as (
    update public.interview_bookings b
       set status = 'cancelled', cancelled_at = pg_catalog.now(), cancel_reason = 'candidate_deleted', cancellation_email_sent_at = pg_catalog.now()
      from public.applications a
     where a.id = b.application_id and a.user_id = p_user and b.status = 'booked'
    returning b.offer_id
  )
  update public.interview_offers o set status = 'cancelled' from c where o.id = c.offer_id;
  get diagnostics v_n = row_count;
  update public.interview_offers o set status = 'cancelled'
    from public.applications a
   where a.id = o.application_id and a.user_id = p_user and o.status = 'open';
  return v_n;
end
$f$;
revoke all on function public.cancel_interviews_for_deleting_applicant(uuid) from public, anon, authenticated;

create or replace function public.interview_close_on_deletion_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $f$
begin
  perform public.cancel_interviews_for_deleting_applicant(new.id);
  return new;
exception when others then
  raise warning '0253: interview_close_on_deletion_request failed for profile %: %', new.id, sqlerrm;
  return new;
end
$f$;
revoke all on function public.interview_close_on_deletion_request() from public, anon, authenticated;
create trigger interview_close_on_deletion_request
  after update of deletion_requested_at on public.profiles
  for each row when (old.deletion_requested_at is null and new.deletion_requested_at is not null)
  execute function public.interview_close_on_deletion_request();

-- Open offers whose offered times have ALL passed are marked expired (daily routine). Returns how many. The 20/day unit they claimed is not touched.
create or replace function public.expire_interview_offers()
returns integer
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_n integer;
begin
  update public.interview_offers o set status = 'expired'
   where o.status = 'open'
     and not exists (select 1 from public.interview_slots s where s.offer_id = o.id and s.starts_at > pg_catalog.now());
  get diagnostics v_n = row_count;
  return v_n;
end
$f$;
revoke all on function public.expire_interview_offers() from public, anon, authenticated;
grant execute on function public.expire_interview_offers() to service_role;

-- Backstop: cancels any BOOKED interview whose applicant the EMPLOYER marked not_a_fit, or who asked to delete their account (a trigger that failed or was bypassed). Reads nothing from applications.stage. Returns how many.
create or replace function public.cancel_stale_interview_bookings()
returns integer
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_k integer;
begin
  with c as (
    update public.interview_bookings b
       set status = 'cancelled', cancelled_at = pg_catalog.now(), cancel_reason = 'not_a_fit'
      from public.employer_applicant_status eas
     where eas.application_id = b.application_id and b.status = 'booked'
       and eas.status = 'not_a_fit'::public.applicant_review_status
    returning b.offer_id
  )
  update public.interview_offers o set status = 'cancelled' from c where o.id = c.offer_id;
  get diagnostics v_k = row_count;
  -- and anyone who asked to delete their account whose interviews the trigger missed (no email: marked handled)
  v_k := v_k + (select coalesce(pg_catalog.sum(public.cancel_interviews_for_deleting_applicant(x.user_id)), 0)::integer
                  from (select distinct a.user_id from public.interview_bookings b join public.applications a on a.id = b.application_id join public.profiles pr on pr.id = a.user_id
                         where b.status = 'booked' and pr.deletion_requested_at is not null) x);
  return v_k;
end
$f$;
revoke all on function public.cancel_stale_interview_bookings() from public, anon, authenticated;
grant execute on function public.cancel_stale_interview_bookings() to service_role;

-- ONE neutral cancellation email per cancelled booking, to the party who did NOT act: claim first (conditional UPDATE, skip locked), send, release on failure. The employer acted (not_a_fit), so the only recipient is the applicant.
create or replace function public.claim_interview_cancellation_emails(p_limit integer default 50)
returns table (booking_id uuid, application_id uuid, job_posting_id uuid, organization_id uuid, applicant_user_id uuid, starts_at timestamptz, recipient text)
language plpgsql
security definer
set search_path = ''
as $f$
begin
  return query
    with due as (
      select b.id from public.interview_bookings b
       where b.status = 'cancelled' and b.cancellation_email_sent_at is null and b.cancel_reason = 'not_a_fit'
       order by b.cancelled_at
       limit greatest(1, least(coalesce(p_limit, 50), 500))
       for update skip locked
    ), u as (
      update public.interview_bookings b set cancellation_email_sent_at = pg_catalog.now()
        from due where b.id = due.id
      returning b.id, b.application_id, b.job_posting_id, b.organization_id, b.starts_at, b.cancel_reason
    )
    select u.id, u.application_id, u.job_posting_id, u.organization_id, a.user_id, u.starts_at, 'applicant'::text
      from u join public.applications a on a.id = u.application_id;
end
$f$;
revoke all on function public.claim_interview_cancellation_emails(integer) from public, anon, authenticated;
grant execute on function public.claim_interview_cancellation_emails(integer) to service_role;

create or replace function public.release_interview_cancellation_email(p_booking uuid)
returns boolean
language sql
security definer
set search_path = ''
as $f$
  with r as (update public.interview_bookings set cancellation_email_sent_at = null where id = p_booking and status = 'cancelled' and cancellation_email_sent_at is not null returning 1)
  select exists (select 1 from r);
$f$;
revoke all on function public.release_interview_cancellation_email(uuid) from public, anon, authenticated;
grant execute on function public.release_interview_cancellation_email(uuid) to service_role;

-- ONE reminder per booking: claim first (conditional UPDATE, skip locked), send, release on failure. Only BOOKED interviews starting in [p_from, p_to), never an applicant who asked to delete their account.
create or replace function public.claim_interview_reminders(p_from timestamptz, p_to timestamptz, p_limit integer default 100)
returns table (booking_id uuid, application_id uuid, job_posting_id uuid, organization_id uuid, applicant_user_id uuid, starts_at timestamptz, duration_minutes integer)
language plpgsql
security definer
set search_path = ''
as $f$
begin
  return query
    with due as (
      select b.id from public.interview_bookings b
        join public.applications a on a.id = b.application_id
        join public.profiles pr on pr.id = a.user_id
       where b.status = 'booked' and b.reminder_sent_at is null and b.starts_at >= p_from and b.starts_at < p_to and pr.deletion_requested_at is null
       order by b.starts_at
       limit greatest(1, least(coalesce(p_limit, 100), 500))
       for update of b skip locked
    ), u as (
      update public.interview_bookings b set reminder_sent_at = pg_catalog.now()
        from due where b.id = due.id and b.status = 'booked' and b.reminder_sent_at is null
      returning b.id, b.application_id, b.job_posting_id, b.organization_id, b.starts_at, b.duration_minutes
    )
    select u.id, u.application_id, u.job_posting_id, u.organization_id, a.user_id, u.starts_at, u.duration_minutes
      from u join public.applications a on a.id = u.application_id;
end
$f$;
revoke all on function public.claim_interview_reminders(timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_interview_reminders(timestamptz, timestamptz, integer) to service_role;

create or replace function public.release_interview_reminder(p_booking uuid)
returns boolean
language sql
security definer
set search_path = ''
as $f$
  with r as (update public.interview_bookings set reminder_sent_at = null where id = p_booking and status = 'booked' and reminder_sent_at is not null returning 1)
  select exists (select 1 from r);
$f$;
revoke all on function public.release_interview_reminder(uuid) from public, anon, authenticated;
grant execute on function public.release_interview_reminder(uuid) to service_role;

-- Self-check: the migration fails (and nothing is kept) unless access is exactly as designed.
do $check$
declare
  t text;
begin
  foreach t in array array['interview_offers', 'interview_slots', 'interview_bookings'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception '0253: row level security is off on %', t; end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE') or has_table_privilege('authenticated', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE')
       or has_any_column_privilege('anon', 'public.' || t, 'SELECT, INSERT, UPDATE') or has_any_column_privilege('authenticated', 'public.' || t, 'SELECT, INSERT, UPDATE') then
      raise exception '0253: a client role holds a privilege on %', t;
    end if;
    if not has_table_privilege('service_role', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE') then raise exception '0253: service_role lost access to %', t; end if;
  end loop;
  if (select count(*) from pg_constraint where conrelid = 'public.interview_bookings'::regclass and contype = 'u' and conname in ('interview_bookings_one_per_offer', 'interview_bookings_one_per_slot')) <> 2
     or not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'interview_bookings_one_per_job_time' and indexdef like '%UNIQUE%' and indexdef like '%job_posting_id, starts_at%' and indexdef like '%status = ''booked''%') then
    raise exception '0253: the three unique keys that make the claim atomic are not all there';
  end if;
  if (select count(*) from pg_trigger where tgname in ('interview_cancel_on_applicant_status', 'interview_close_on_deletion_request') and not tgisinternal) <> 2 then
    raise exception '0253: the one cancel trigger (employer not_a_fit) is not there';
  end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.applications'::regclass and tgname like 'interview%') then
    raise exception '0253: nothing on applications may cancel an interview (the candidate''s own tracker cancels nothing)';
  end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('interview_offer_state', 'create_interview_offer', 'book_interview_slot', 'interview_overlaps', 'cancel_interview_for_application', 'interview_cancel_on_applicant_status', 'cancel_stale_interview_bookings', 'claim_interview_cancellation_emails', 'release_interview_cancellation_email', 'cancel_interviews_for_deleting_applicant', 'interview_close_on_deletion_request', 'expire_interview_offers', 'claim_interview_reminders', 'release_interview_reminder')
        and p.prosecdef and p.proconfig = array['search_path=""']) <> 14 then
    raise exception '0253: the fourteen functions must be SECURITY DEFINER with an empty search_path';
  end if;
  -- Smoke: PL/pgSQL only resolves names when a function RUNS, so a typo in a body would pass every structural check above. Call the read-only paths with random ids: each must answer 'not found' / empty without writing anything.
  if (select outcome from public.create_interview_offer(gen_random_uuid(), gen_random_uuid(), 'video', null, '[]'::jsonb)) is distinct from 'not_found' then raise exception '0253: create_interview_offer does not run'; end if;
  if (select outcome from public.book_interview_slot(gen_random_uuid(), gen_random_uuid())) is distinct from 'not_found' then raise exception '0253: book_interview_slot does not run'; end if;
  if public.interview_offer_state(gen_random_uuid()) is distinct from 'not_found' then raise exception '0253: interview_offer_state does not run'; end if;
  if exists (select 1 from public.interview_overlaps(gen_random_uuid(), gen_random_uuid(), '[]'::jsonb)) then raise exception '0253: interview_overlaps does not run'; end if;
  -- the close-out, claim and sweeper functions: the three tables are empty at this point, so each call finds nothing and writes nothing
  if public.cancel_interviews_for_deleting_applicant(gen_random_uuid()) <> 0 then raise exception '0253: cancel_interviews_for_deleting_applicant does not run'; end if;
  if public.cancel_stale_interview_bookings() <> 0 then raise exception '0253: cancel_stale_interview_bookings does not run'; end if;
  if public.expire_interview_offers() <> 0 then raise exception '0253: expire_interview_offers does not run'; end if;
  if exists (select 1 from public.claim_interview_cancellation_emails(1)) then raise exception '0253: claim_interview_cancellation_emails does not run'; end if;
  if exists (select 1 from public.claim_interview_reminders(pg_catalog.now(), pg_catalog.now() + interval '1 day', 1)) then raise exception '0253: claim_interview_reminders does not run'; end if;
  if public.release_interview_reminder(gen_random_uuid()) then raise exception '0253: release_interview_reminder does not run'; end if;
  if public.release_interview_cancellation_email(gen_random_uuid()) then raise exception '0253: release_interview_cancellation_email does not run'; end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('interview_offer_state', 'create_interview_offer', 'book_interview_slot', 'interview_overlaps', 'cancel_interview_for_application', 'interview_cancel_on_applicant_status', 'cancel_stale_interview_bookings', 'claim_interview_cancellation_emails', 'release_interview_cancellation_email', 'cancel_interviews_for_deleting_applicant', 'interview_close_on_deletion_request', 'expire_interview_offers', 'claim_interview_reminders', 'release_interview_reminder')
        and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) then
    raise exception '0253: no client role may execute any of the fourteen functions';
  end if;
  if has_function_privilege('anon', 'public.book_interview_slot(uuid, uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'public.book_interview_slot(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_interview_offer(uuid, uuid, text, text, jsonb)', 'EXECUTE') or has_function_privilege('authenticated', 'public.create_interview_offer(uuid, uuid, text, text, jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.interview_offer_state(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'public.interview_offer_state(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.book_interview_slot(uuid, uuid)', 'EXECUTE') then
    raise exception '0253: the functions must be executable by service_role only';
  end if;
end
$check$;
