-- 0207 — the "your posting closes soon" reminder, and the one-click, single-use EXTEND link behind it. EMP-1 / E3.
--
-- ── WHAT THIS IS ──────────────────────────────────────────────────────────
--
-- Employer-posted jobs now default to closing in 30 days (the form and postJobAction, not this file). A posting that
-- closes without warning is a posting the employer did not mean to lose, so when one is about to close the employer is
-- emailed a link that extends it by 30 days from the date it was going to close.
--
-- This file is only the storage and the atomic steps. The cron route, the email and the confirm page are code.
--
-- ── SELF-CONTAINED, AND SAFE TO RUN TWICE ─────────────────────────────────
--
-- It depends only on `public.job_postings` (id, title, organization_id, source_type, status, expires_at: all there since
-- 0000/0053/0055) and nothing from 0204–0206, so it applies on a database that has 0203 and none of those. Every
-- statement is `if not exists` / `create or replace` / a repeatable revoke or grant, so a second apply changes nothing.
--
-- ── ONE TABLE IS BOTH THE "ALREADY REMINDED" MARKER AND THE LINK ──────────
--
-- `job_expiry_reminders` has one row per (posting, closing date). It is the marker (a row exists, so this closing date
-- has been reminded) and the single-use token (token_hash, used_at) at once, so the two cannot disagree.
--
--   unique (job_posting_id, closes_at)   a posting is reminded ONCE PER CLOSING DATE. Extending the posting changes
--                                        its closing date, so the extended date is reminded once in its turn, and a
--                                        second run on the same day finds the row and sends nothing.
--   token_hash                           sha256 of a random 256-bit token. The raw token exists only in the email; a
--                                        database read cannot reconstruct a working link.
--   used_at                              single use. Stamped by the same locked transaction that extends the posting.
--
-- ── WHO CAN SEE IT, AND WHO CAN CALL THE FUNCTIONS ────────────────────────
--
-- Nobody but the server. The table has RLS enabled with NO policy and every privilege revoked from public, anon and
-- authenticated (Supabase grants ALL on every new table to both client roles; a policy-less table with a wide grant is
-- not a closed table, so the revoke is explicit). It holds bearer-token hashes, and no client has a reason to know
-- which postings were reminded. No client can write it, so there is no column-grant question to answer.
--
-- FUNCTIONS: Postgres grants EXECUTE on a new function to PUBLIC by default, and revoking from `anon` and
-- `authenticated` alone does NOT remove that (they inherit it through PUBLIC). So each function is revoked from
-- `public, anon, authenticated` and granted to `service_role` only. All of them also pin `set search_path = ''` and
-- schema-qualify every reference, so a role that could create objects in another schema could not shadow one of ours.
-- tests/jobs/expiry-reminders/ calls every function as anon (and, CI-bound, as authenticated) and expects 42501.
--
-- ── THE WINDOW ────────────────────────────────────────────────────────────
--
-- A posting is due when it is open, an employer's own, and closes within the next 3 days: expires_at > now AND
-- expires_at <= now + 3 days, with no claim yet for its CURRENT closing date. Exactly-once comes from the unique claim
-- row, not from the window, so the window can be generous:
--
--   a missed day catches up: a run skipped for a day or two still finds the posting on the next run, because the window
--   is "closing soon" and not "closing in exactly 3 days";
--   a job published with 2 days left still gets its one reminder;
--   a job closing in 3 days and a minute is not reminded yet; one already past, or closed, never is.
--
-- ── WHY THE CLAIM COMES BEFORE THE SEND ───────────────────────────────────
--
-- The usual pattern here is send, then stamp, which is at-least-once: two overlapping runs (the cron and a manual POST)
-- can both send. "Exactly once" needs the claim to be the atomic step, so `claim_job_expiry_reminder` inserts the marker
-- first and only the run that inserted it sends. If the send then fails the caller deletes its own unsent claim, so the
-- next run retries. A run that dies between claim and send leaves a claim with no `sent_at`; after 30 minutes the claim
-- is treated as abandoned and the next run may take it over with a fresh token (the old token was never emailed).
--
-- ── WHY THE EXTEND IS ONE LOCKED TRANSACTION ──────────────────────────────
--
-- CLAUDE.md: anything that gates on a compared value must check and act atomically. `redeem_job_expiry_extend_token`
-- locks the token row (`for update`), so two concurrent uses of one link are serialised and the second sees `used_at`
-- set and answers 'used'. The extension itself is ONE conditional UPDATE — `where status = 'open' and source_type =
-- 'internal' and expires_at > now` — so the comparison and the write are the same statement, and the token is stamped
-- in the same transaction. A link that refuses (closed posting, external posting, no closing date) does NOT consume the
-- token. The row lock is pinned by a test that reads the live function's definition (job_expiry_function_definition):
-- a 10-way concurrency test cannot catch a missing lock on its own, because the race window is microseconds.
--
-- ── INTERNAL POSTINGS ONLY ────────────────────────────────────────────────
--
-- `due_job_expiry_reminders`, `claim_job_expiry_reminder` and the extend all say `source_type = 'internal'`. An
-- external posting follows its source (src/lib/jobs/expiry.ts): its `expires_at` is a fact a source stated, and nothing
-- here reads, reminds about or moves it. No existing row is touched by this migration (no backfill: a posting with no
-- closing date keeps none).

create table if not exists public.job_expiry_reminders (
  id uuid primary key default gen_random_uuid(),
  job_posting_id uuid not null references public.job_postings (id) on delete cascade,
  -- The `expires_at` this reminder, and the link in it, are for. The link stops working at this moment.
  closes_at timestamptz not null,
  -- sha256 hex of the raw token. Unique, so a hash can only ever name one reminder.
  token_hash text not null unique,
  -- When the claim was taken (the caller's clock, not necessarily the database's: see claim_job_expiry_reminder).
  created_at timestamptz not null default now(),
  -- Set after the email was handed to the mailer. A claim with no sent_at is an attempt in flight, or an abandoned one.
  sent_at timestamptz,
  -- Set by redeem_job_expiry_extend_token in the same transaction that extends the posting.
  used_at timestamptz,
  constraint job_expiry_reminders_one_per_closing unique (job_posting_id, closes_at)
);

comment on table public.job_expiry_reminders is
  'One row per (employer posting, closing date): the marker that the closing reminder was claimed, and the single-use token behind its Extend link. Service role only.';

alter table public.job_expiry_reminders enable row level security;
-- Deliberately NO policy: with RLS on and none defined, every non-bypassing role is denied. The revoke is the second lock.
revoke all on public.job_expiry_reminders from public, anon, authenticated;
grant all on public.job_expiry_reminders to service_role;

-- ── the window, in one place ──────────────────────────────────────────────
-- Used by both the listing and the claim so the two cannot disagree about who is due.
create or replace function public.expiry_reminder_window_ok(p_closes_at timestamptz, p_now timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_closes_at is not null
     and p_closes_at >  p_now
     and p_closes_at <= p_now + interval '3 days';
$$;

-- ── who is due ────────────────────────────────────────────────────────────
-- Read-only. A posting is due when it is an open employer posting inside the window and has no live claim for its
-- CURRENT closing date. A claim is live when it was sent, or was taken less than 30 minutes ago.
create or replace function public.due_job_expiry_reminders(p_now timestamptz default now(), p_limit int default 200)
returns table (job_posting_id uuid, title text, organization_id uuid, closes_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select j.id, j.title, j.organization_id, j.expires_at
  from public.job_postings j
  where j.source_type = 'internal'
    and j.status = 'open'
    and public.expiry_reminder_window_ok(j.expires_at, p_now)
    and not exists (
      select 1
      from public.job_expiry_reminders r
      where r.job_posting_id = j.id
        and r.closes_at = j.expires_at
        and (r.sent_at is not null or r.created_at >= p_now - interval '30 minutes')
    )
  order by j.expires_at, j.id
  limit greatest(p_limit, 0);
$$;

-- ── take the claim ────────────────────────────────────────────────────────
-- ONE statement. Returns the closing date claimed, or no row if the posting is not due, someone else holds the claim,
-- or this closing date was already reminded. The conditions are re-checked here, not trusted from the listing, because
-- the posting can change between the two calls (closed, edited, extended).
create or replace function public.claim_job_expiry_reminder(
  p_job_posting_id uuid,
  p_token_hash text,
  p_now timestamptz default now()
)
returns table (closes_at timestamptz)
language sql
set search_path = ''
as $$
  insert into public.job_expiry_reminders as r (job_posting_id, closes_at, token_hash, created_at)
  select j.id, j.expires_at, p_token_hash, p_now
  from public.job_postings j
  where j.id = p_job_posting_id
    and j.source_type = 'internal'
    and j.status = 'open'
    and public.expiry_reminder_window_ok(j.expires_at, p_now)
  on conflict (job_posting_id, closes_at) do update
    set token_hash = excluded.token_hash,
        created_at = excluded.created_at
    -- Only an ABANDONED claim may be taken over: unsent, unused, and older than 30 minutes.
    where r.sent_at is null
      and r.used_at is null
      and r.created_at < p_now - interval '30 minutes'
  returning r.closes_at;
$$;

-- ── the one-click extend ──────────────────────────────────────────────────
-- Outcomes, and what each means for the page:
--   extended         expires_at moved forward 30 days from its CURRENT value; the token is now used.
--   invalid          no such token (mistyped, tampered, or never issued).
--   used             the link was already used. title and new_expires_at carry the posting's CURRENT closing date.
--   expired          the closing date the link was issued for has passed.
--   closed           the posting is no longer open (closed, removed, or a draft). NOTHING is consumed.
--   no_closing_date  the posting has no closing date or is not an employer posting. NOTHING is consumed.
create or replace function public.redeem_job_expiry_extend_token(p_token_hash text, p_now timestamptz default now())
returns table (outcome text, job_posting_id uuid, title text, new_expires_at timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  r public.job_expiry_reminders%rowtype;
  v_title text;
  v_new timestamptz;
  v_source text;
  v_status text;
begin
  -- Serialises concurrent uses of one link: the second caller blocks here, then reads used_at.
  select * into r from public.job_expiry_reminders where token_hash = p_token_hash for update;
  if not found then
    return query select 'invalid'::text, null::uuid, null::text, null::timestamptz;
    return;
  end if;

  if r.used_at is not null then
    -- Say what the posting closes on NOW, so "already extended" can name the date.
    select j.title, j.expires_at into v_title, v_new from public.job_postings j where j.id = r.job_posting_id;
    return query select 'used'::text, r.job_posting_id, v_title, v_new;
    return;
  end if;

  if r.closes_at <= p_now then
    return query select 'expired'::text, r.job_posting_id, null::text, null::timestamptz;
    return;
  end if;

  -- Check and act in ONE statement. `expires_at > p_now` is the compared value; the write is conditional on it.
  update public.job_postings j
     set expires_at = j.expires_at + interval '30 days'
   where j.id = r.job_posting_id
     and j.source_type = 'internal'
     and j.status = 'open'
     and j.expires_at is not null
     and j.expires_at > p_now
  returning j.title, j.expires_at into v_title, v_new;

  if not found then
    -- Nothing moved and nothing is consumed. Work out which refusal this is, only to tell the person the truth.
    select j.source_type::text, j.status::text, j.expires_at into v_source, v_status, v_new
      from public.job_postings j where j.id = r.job_posting_id;
    if v_source is distinct from 'internal' or v_new is null then
      return query select 'no_closing_date'::text, r.job_posting_id, null::text, null::timestamptz;
    elsif v_status is distinct from 'open' then
      return query select 'closed'::text, r.job_posting_id, null::text, null::timestamptz;
    else
      return query select 'expired'::text, r.job_posting_id, null::text, null::timestamptz;
    end if;
    return;
  end if;

  update public.job_expiry_reminders set used_at = p_now where id = r.id;

  return query select 'extended'::text, r.job_posting_id, v_title, v_new;
end;
$$;

-- ── a catalog reader, for ONE test ────────────────────────────────────────
-- Lets tests/jobs/expiry-reminders read the live definition of the four functions above (PostgREST cannot reach
-- pg_proc), so the row lock in redeem_job_expiry_extend_token is pinned by a test that fails if a rewrite drops it.
-- Same idea as data_api_grants_snapshot() (0193). Restricted to our own function names; service role only.
create or replace function public.job_expiry_function_definition(p_name text)
returns text
language sql
stable
set search_path = ''
as $$
  select pg_catalog.pg_get_functiondef(p.oid)
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = p_name
    and p_name in (
      'expiry_reminder_window_ok',
      'due_job_expiry_reminders',
      'claim_job_expiry_reminder',
      'redeem_job_expiry_extend_token'
    )
  limit 1;
$$;

-- ── grants: service_role ONLY ─────────────────────────────────────────────
revoke execute on function public.expiry_reminder_window_ok(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.due_job_expiry_reminders(timestamptz, int) from public, anon, authenticated;
revoke execute on function public.claim_job_expiry_reminder(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.redeem_job_expiry_extend_token(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.job_expiry_function_definition(text) from public, anon, authenticated;
grant execute on function public.expiry_reminder_window_ok(timestamptz, timestamptz) to service_role;
grant execute on function public.due_job_expiry_reminders(timestamptz, int) to service_role;
grant execute on function public.claim_job_expiry_reminder(uuid, text, timestamptz) to service_role;
grant execute on function public.redeem_job_expiry_extend_token(text, timestamptz) to service_role;
grant execute on function public.job_expiry_function_definition(text) to service_role;

-- Self-check, in the shape 0192 and 0191 use: fail the apply loudly rather than leave something that looks locked and isn't.
do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'job_expiry_reminders' and c.relrowsecurity
  ) then
    raise exception 'job_expiry_reminders did not end up with row level security enabled';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'job_expiry_reminders' and grantee in ('anon', 'authenticated', 'PUBLIC')
  ) then
    raise exception 'job_expiry_reminders must grant nothing to anon, authenticated or PUBLIC';
  end if;
  -- EXECUTE through PUBLIC is the grant that survives a revoke from anon/authenticated alone: check it directly.
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'expiry_reminder_window_ok', 'due_job_expiry_reminders', 'claim_job_expiry_reminder',
        'redeem_job_expiry_extend_token', 'job_expiry_function_definition'
      )
      and (
        has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
      )
  ) then
    raise exception 'a job_expiry function is still executable by anon or authenticated';
  end if;
end $$;
