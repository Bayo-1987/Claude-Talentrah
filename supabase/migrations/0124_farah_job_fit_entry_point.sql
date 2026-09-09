-- 0124 — send-100: a new Farah chat entry point for a job-seeded conversation
-- ("Ask Farah" on a job card).
--
-- WHY THIS IS A CONSTRAINT REBUILD, NOT `alter type ... add value`.
-- farah_session_events.entry_point (0097) is a plain `text` column with a
-- CHECK constraint, not a Postgres enum — unlike credit_reason/
-- credit_gate_outcome (0123), which really are enums and can be widened with
-- `add value if not exists`. A CHECK constraint has no equivalent "add one
-- more allowed value" operation; the only way to widen it is to drop and
-- recreate it with the new value included. Confirmed directly against
-- 0097's own text before writing this, rather than assumed from 0123's
-- pattern.
alter table public.farah_session_events
  drop constraint farah_session_events_entry_point_check;

alter table public.farah_session_events
  add constraint farah_session_events_entry_point_check check (
    entry_point in ('interview-prep', 'career-advisor', 'salary-negotiation', 'free_text', 'job_fit')
  );
