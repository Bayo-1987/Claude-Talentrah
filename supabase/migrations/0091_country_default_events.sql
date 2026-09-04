-- 0091 — Instrumentation for Stage 12's country-defaulted feed.
--
-- "Instrument: apply rate and click-through before and after the country
-- default, split by whether the user kept or cleared it. That number decides
-- whether this was worth doing." This table is the whole mechanism: three
-- event types (feed_view, detail_view, apply), each carrying country_state
-- so a later query can group by kept/cleared/none and compare apply rates.
--
-- detail_view is an explicit, named approximation of "click-through" — this
-- codebase has no client-side click beacon anywhere yet (confirmed by
-- searching for one before writing this), so a real feed-card-click event
-- isn't available this pass. Landing on /jobs/[id] with a country_state
-- attached is the closest real signal without inventing new client
-- instrumentation, and is called out as an approximation, not the real thing,
-- everywhere it's read.
--
-- Same shape as credit_gate_events (0000_baseline_schema.sql) and the same
-- reasoning: owner-readable, service-role-written only, no INSERT policy so
-- a user cannot fabricate their own funnel data. Written from
-- src/lib/jobs/country-events.ts, which — like logCreditGateEvent — swallows
-- its own failures; a dropped analytics row must never break the feed.
create table public.country_default_events (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  event_type text not null,
  country_state text not null,
  job_posting_id uuid,
  tab text,
  created_at timestamp with time zone not null default now(),
  constraint country_default_events_pkey primary key (id),
  constraint country_default_events_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade,
  -- SET NULL, not CASCADE: an event describing what a user did should
  -- outlive the specific posting once Stage 5b starts deleting rows — the
  -- same reasoning applications.job_posting_id was set to SET NULL for.
  constraint country_default_events_job_posting_id_fkey foreign key (job_posting_id) references public.job_postings(id) on delete set null,
  constraint country_default_events_event_type_check check (event_type in ('feed_view', 'detail_view', 'apply')),
  constraint country_default_events_country_state_check check (country_state in ('kept', 'cleared', 'none'))
);

alter table public.country_default_events enable row level security;

create policy "users can read their own country default events" on public.country_default_events for select
  using (((select auth.uid()) = user_id));

-- The only access pattern this table needs: group by event_type/country_state
-- over a date range (the raw SQL documented in country-events.ts).
create index idx_country_default_events_analysis
  on public.country_default_events (event_type, country_state, created_at desc);
