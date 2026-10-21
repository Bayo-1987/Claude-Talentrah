-- CANARY, NOT FOR MERGE. Run 1: a table and a view with no GRANT, relying on automatic Data API access. The job "Grants under the new Data API rule" must FAIL on both.
create table public.grants_leg_canary (
  id         uuid primary key default gen_random_uuid(),
  note       text not null default 'canary',
  created_at timestamptz not null default now()
);
create view public.grants_leg_canary_view as
  select id, note, created_at from public.grants_leg_canary;
