-- 0093 — Instrumentation for Stage 3.1's resume-builder start states.
--
-- The founder's ask: "the resume builder opens an empty form... that
-- difference is what users are describing." /resume-builder/edit now offers
-- three start states before the editor appears — "Import my CV", "Start from
-- an example", "Start blank" — and this table is the funnel behind that
-- choice: which one people pick, and whether they actually finish (defined
-- here as: the resume they started gets saved or exported at least once).
--
-- Same shape and same reasoning as credit_gate_events
-- (0000_baseline_schema.sql) and country_default_events (0091): owner-
-- readable, service-role-written only (no INSERT policy for `authenticated`,
-- so a user cannot fabricate their own funnel numbers), and deliberately
-- best-effort from the app side — src/lib/resume-builder/start-events.ts
-- swallows its own failures, because a dropped analytics row must never break
-- resume creation, saving, or export.
--
-- WHY BOTH EVENTS CARRY start_state, RATHER THAN JOINING 'completed' BACK TO
-- 'selected' BY resume_id: a join works, but it makes the one query anyone
-- will actually run (completion rate by start state) two steps instead of one.
-- logResumeBuilderCompletion() looks up the resume's own 'selected' row once,
-- at completion time, and stamps its start_state onto the 'completed' row too
-- — so both numbers come out of a single group-by. See the helper file's own
-- header for exactly how "completed" is defined and why it is logged at most
-- once per resume rather than once per save.
create table public.resume_builder_start_events (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  -- The resume this choice produced. Nullable + SET NULL, not CASCADE: an
  -- event describing what a user did should outlive the specific resume row
  -- once they delete a builder draft (deleteResumeAction already allows
  -- that) — same reasoning applications.job_posting_id and
  -- country_default_events.job_posting_id were both given SET NULL for.
  resume_id uuid,
  start_state text not null,
  event_type text not null,
  created_at timestamp with time zone not null default now(),
  constraint resume_builder_start_events_pkey primary key (id),
  constraint resume_builder_start_events_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade,
  constraint resume_builder_start_events_resume_id_fkey foreign key (resume_id) references public.resumes(id) on delete set null,
  constraint resume_builder_start_events_start_state_check check (start_state in ('blank', 'example', 'import_base', 'import_upload')),
  constraint resume_builder_start_events_event_type_check check (event_type in ('selected', 'completed'))
);

alter table public.resume_builder_start_events enable row level security;

create policy "users can read their own resume builder start events" on public.resume_builder_start_events for select
  using (((select auth.uid()) = user_id));

-- The only access pattern this table needs: group by start_state/event_type
-- over a date range (the raw SQL documented in start-events.ts).
create index idx_resume_builder_start_events_analysis
  on public.resume_builder_start_events (start_state, event_type, created_at desc);
