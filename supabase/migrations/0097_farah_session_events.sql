-- 0097 — Stage 21's second follow-up: which entry point starts a Farah
-- session, and whether that session ever gets a second user message.
--
-- THE QUESTION THIS ANSWERS: whether per-task Farah threads are ever worth
-- building. If most sessions are one question and done, they aren't.
--
-- WHY "SESSION" MEANS ONE PANEL MOUNT, NOT A STORED CONCEPT. There is no
-- session/thread table in this app — farah_messages is a flat per-user list,
-- and building real threads is explicitly out of scope for this counter (the
-- counter is what decides whether threads are worth building at all, so it
-- can't depend on them existing). `session_id` is a UUID the client
-- generates once per FarahPanel mount and sends with every chat request from
-- that mount — see src/components/app-shell/farah-panel.tsx. It is not
-- persisted or reused across a page reload, which is the honest, best-effort
-- boundary this counter accepts: a reload mid-conversation undercounts that
-- one session's message count rather than overcounting it, which is the
-- safer direction to be wrong in for a metric deciding whether to invest in
-- real threads.
--
-- SAME SHAPE AND SAME REASONING as resume_builder_start_events (0093):
-- owner-readable, service-role-written only (no INSERT policy for
-- `authenticated`, so a user cannot fabricate their own funnel numbers), and
-- best-effort from the app side — src/lib/farah/session-events.ts swallows
-- its own failures, because a dropped analytics row must never break a
-- Farah reply that already cost real money in credits or pass allowance.
--
-- WHY TWO EVENT ROWS PER SESSION RATHER THAN ONE ROW WITH A BOOLEAN COLUMN:
-- copying resume_builder_start_events's own pattern exactly, for the same
-- reason it was chosen there — both events carry entry_point, so the one
-- query anyone will actually run (how often does a session reach a second
-- message, broken down by what started it) is a single group-by, no join.
-- src/lib/farah/session-events.ts looks up the ORIGINAL entry_point from the
-- 'started' row when logging 'reached_second_message', rather than trusting
-- whatever a later call happens to pass — same reasoning as
-- logResumeBuilderCompletion's own lookup of the resume's 'selected' row.
create table public.farah_session_events (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null,
  -- Only the three quick actions that actually start a CHAT carry their own
  -- key here (interview-prep, career-advisor, salary-negotiation) — CV
  -- Builder and Cover Letter Builder are plain navigation links to a
  -- different flow (src/lib/farah/quick-actions.ts) and never reach
  -- chat/route.ts at all, so those two keys can never appear in this column.
  entry_point text not null,
  event_type text not null,
  created_at timestamp with time zone not null default now(),
  constraint farah_session_events_pkey primary key (id),
  constraint farah_session_events_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade,
  constraint farah_session_events_entry_point_check check (
    entry_point in ('interview-prep', 'career-advisor', 'salary-negotiation', 'free_text')
  ),
  constraint farah_session_events_event_type_check check (event_type in ('started', 'reached_second_message'))
);

alter table public.farah_session_events enable row level security;

create policy "users can read their own farah session events" on public.farah_session_events for select
  using (((select auth.uid()) = user_id));

-- The only access pattern this table needs: group by entry_point/event_type,
-- and looking up a session's own 'started' row by session_id.
create index idx_farah_session_events_analysis
  on public.farah_session_events (entry_point, event_type, created_at desc);

create index idx_farah_session_events_session_id
  on public.farah_session_events (session_id, event_type);
