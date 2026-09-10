-- 0131 — Farah's proactive "exceptional match, even if you're not looking"
-- alert (send-138 — build-prompt §6.10's own worked example).
--
-- RENUMBERED FROM 0128. Written and applied to both Supabase projects under
-- 0128 while three other branches were independently in flight on the same
-- repo; by the time this PR was ready to merge, "Claim your listing" had
-- already taken 0128 (and 0129) and merged first. The content below is
-- exactly what ran — this is a filename change for the directory's own
-- sequencing, not a second apply: the ledger entry these statements produced
-- on both projects still reads `0128_proactive_match_alerts`, unchanged: an
-- applied migration is history that does not get rewritten, the same
-- precedent 0129 itself set one commit before this one. Nothing here needs
-- re-running against either database.
--
-- ── WHY THIS IS A SEPARATE PREFERENCE, A SEPARATE FLAG, AND A NEW TABLE ────
--
-- Three deliberately independent pieces, mirroring 0083/0080's own split for
-- the weekly digest rather than reusing it:
--
--   feature_flags.proactive_match_alert   does the product send this AT ALL
--   email_preferences.proactive_match_alert  does THIS PERSON want it
--   proactive_match_alerts (new table)    has this exact (user, job) already
--                                          fired, and when did this user last
--                                          get ANY alert of this type
--
-- A shared flag with the digest would mean a product owner could not ship one
-- without the other. A shared preference column would mean unsubscribing from
-- the weekly digest also silences the rare, high-value alert (or the reverse)
-- — two different asks, sharing a column that only remembers one answer.
--
-- ── WHY `proactive_match_alerts` IS BOTH THE RATE LIMIT AND THE DEDUP LOCK ──
--
-- Its primary key is (user_id, job_posting_id): a second INSERT for the same
-- pair is rejected by the constraint, not by a read-then-write race — the
-- same "check and act in one statement" reasoning CLAUDE.md already states
-- for spend_credits_atomic, applied here to "has this exact alert already
-- fired" instead of a balance. The sending code inserts this row FIRST and
-- only proceeds to actually notify if the insert succeeded, so two
-- overlapping ingest runs racing the same new posting cannot both alert the
-- same user for it.
--
-- The same table's `max(sent_at)` for a user is also the rate-limit clock —
-- one table answers both questions rather than a second one drifting from
-- it. It also doubles as the digest's own new exclusion set (this migration wires
-- digest/send.ts to skip a job already recorded here for that user): a job
-- this alert already surfaced is not news to the digest either, the same
-- reasoning the digest already applies to a saved/applied job.
--
-- ── WHY THE IN-APP HALF IS A NEW `user_notifications` TABLE ────────────────
--
-- Nothing in this codebase persists an in-app notification today — every
-- existing proactive send (the digest) is email-only. §6.10 specs this alert
-- as "in-app + email" explicitly, and an in-app notification that vanishes on
-- reload is not really "in-app" — it needs a row. Deliberately minimal: one
-- table, owner-readable, one column (`read_at`) the owner may write, nothing
-- else. This is infrastructure the ask genuinely requires, not scope creep —
-- see this migration's own header for the alternative considered (a
-- dismissed-boolean column, `farah_hint_dismissed`'s own pattern) and why it
-- does not fit here: that pattern is for ONE fixed piece of UI chrome shown
-- to everyone once, not an unbounded stream of per-user, per-event messages.

alter table public.email_preferences
  add column proactive_match_alert boolean not null default true;

comment on column public.email_preferences.proactive_match_alert is
  'Whether THIS PERSON wants the rare "exceptional match, even if you are not looking" alert (send-138). Separate from job_match_digest on purpose — see this migration's own header.';

insert into public.feature_flags (key, label, enabled) values
  ('proactive_match_alert', 'Proactive "exceptional match" alerts', false);

create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- A short machine key ("proactive_match_alert"), not a free-text label —
  -- this is the first in-app notification type this app has, and a type
  -- column is what lets a future second type share the table without a
  -- migration.
  type text not null,
  title text not null,
  body text not null,
  -- Where "see it" goes, e.g. /jobs/<id>. Nullable: not every notification
  -- type this table might carry in the future needs a destination.
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

comment on table public.user_notifications is
  'In-app notification stream, one row per message. First consumer: send-138''s proactive match alert. Owner-readable; only read_at is owner-writable.';

alter table public.user_notifications enable row level security;

create policy "user notifications are owner-readable" on public.user_notifications
  for select to authenticated
  using (user_id = auth.uid());

create policy "user notifications are owner-updatable" on public.user_notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No INSERT policy for authenticated/anon, deliberately — RLS with zero
-- matching policies for a command denies it outright regardless of the
-- table-level grant CLAUDE.md notes Supabase applies broadly. Only
-- service_role (which bypasses RLS) ever creates a row here.
--
-- 0030's own lesson, applied again: a row policy restricts ROWS, never
-- columns, so the UPDATE policy above would let an owner rewrite title/body/
-- type on their own row without this. read_at is the only column a
-- notification's own reader has any legitimate reason to write.
revoke update on public.user_notifications from authenticated;
grant update (read_at) on public.user_notifications to authenticated;

create index user_notifications_user_id_created_at_idx
  on public.user_notifications (user_id, created_at desc);

create table public.proactive_match_alerts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_posting_id uuid not null references public.job_postings(id) on delete cascade,
  score integer not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, job_posting_id)
);

comment on table public.proactive_match_alerts is
  'One row per (user, job) this alert ever fired for — the INSERT succeeding is the send-once lock (this migration's own header), and max(sent_at) per user is the rate-limit clock. Service-role only, same reasoning as email_preferences'' token: nothing here is a value a client should read or write directly.';

alter table public.proactive_match_alerts enable row level security;
-- No policies at all, deliberately — service_role only. Matches
-- email_preferences' own "no policies" treatment of its bearer token.

create index proactive_match_alerts_user_id_sent_at_idx
  on public.proactive_match_alerts (user_id, sent_at desc);

/*
 * Flips `email_preferences.proactive_match_alert` using the SAME bearer
 * token the digest's own `email_unsubscribe` already reads — one row, one
 * token, two independently-flippable preferences. A NEW function rather than
 * widening `email_unsubscribe` itself: that function's own shape (name,
 * return columns) is already live in shipped digest emails, and CLAUDE.md's
 * own convention throughout this codebase is additive extension, not
 * reshaping a function every existing caller already depends on.
 */
create or replace function public.proactive_match_alert_set_preference(
  p_token text,
  p_enabled boolean default false
)
returns table (matched boolean, proactive_match_alert boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  update public.email_preferences
     set proactive_match_alert = p_enabled,
         updated_at = now()
   where unsubscribe_token = p_token
  returning user_id into v_user;

  if v_user is null then
    return query select false, false;
  else
    return query select true, p_enabled;
  end if;
end;
$$;

revoke all on function public.proactive_match_alert_set_preference(text, boolean) from public;
grant execute on function public.proactive_match_alert_set_preference(text, boolean) to service_role;

comment on function public.proactive_match_alert_set_preference(text, boolean) is
  'Flip a user''s proactive-match-alert preference using their existing unsubscribe token (0083). SECURITY DEFINER for the same reason as email_unsubscribe: email_preferences is service_role-only, so the token never reaches a client-side query.';
