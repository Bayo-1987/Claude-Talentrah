-- 0057 — a seeker can report a posting. The other half of 0056.
--
-- 0056 gave an operator the power to remove a scam listing. This is how they
-- learn there is one: the people reading the board see the fraud long before
-- anyone auditing it does, and without a way to say so the removal power has
-- no input.
--
-- SAME WRITE-ONLY SHAPE AS `feedback` (0054), for the same reason and one
-- more. A report is an accusation against a named company, written by a named
-- user. Letting any signed-in user read the table would expose both halves —
-- who accused whom — and letting the accused employer read it would be worse.
-- So: insert only, and SELECT/UPDATE/DELETE revoked as privileges rather than
-- merely left unpolicied. A missing policy is undone by adding one; a missing
-- grant has to be restored on purpose, in SQL, in a diff.
--
-- THE UNIQUE CONSTRAINT IS THE RATE LIMIT. One report per person per posting,
-- enforced by the database. Not a courtesy: the GET on
-- /api/admin/moderate-job-posting ranks postings by how many distinct people
-- reported them, and an operator acting on that count needs it to mean
-- "twelve people" and not "one person, twelve times". Without the constraint
-- the count is an applause meter, and the loudest complainer decides which
-- employer gets pulled.
--
-- WHY THE COUNT IS NOT A TRIGGER ON job_postings. Nothing here auto-removes
-- anything, and nothing writes a running total onto the posting. Removal stays
-- a human decision made against a real reason (0056 requires one), because a
-- threshold that removes automatically is a brigading tool pointed at whoever
-- a competitor dislikes.

create type public.job_report_reason as enum (
  'scam',
  'closed_but_listed',
  'discriminatory',
  'other'
);

create table public.job_posting_reports (
  id uuid primary key default gen_random_uuid(),
  job_posting_id uuid not null references public.job_postings(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason public.job_report_reason not null,
  details text,
  created_at timestamptz not null default now(),

  -- One report per person per posting. See above: this is what makes the
  -- operator's count mean distinct people.
  constraint job_posting_reports_one_per_reporter unique (job_posting_id, reporter_id),

  -- Optional, but not optionally blank: "   " is worse than null because it
  -- looks like the reporter said something.
  constraint job_posting_reports_details_not_blank
    check (details is null or length(btrim(details)) > 0)
);

-- The operator's queue reads "which postings, ordered by how many people".
create index job_posting_reports_posting_idx
  on public.job_posting_reports (job_posting_id);

-- CASCADE on job_posting_id, deliberately. A posting can be deleted outright
-- (the ingest never does, but a hard delete is possible), and a report about a
-- row that no longer exists is unactionable. CASCADE on reporter_id for the
-- same reason as feedback: §8 requires account deletion to be real, and there
-- is no anonymised form of "this person accused this company" worth keeping.

alter table public.job_posting_reports enable row level security;

create policy "seekers can report a posting once"
  on public.job_posting_reports
  for insert
  to authenticated
  with check (reporter_id = auth.uid());

revoke select, update, delete on public.job_posting_reports from authenticated, anon;

comment on table public.job_posting_reports is
  'Write-only. Seekers insert their own reports; nobody but the service role can read them. One per reporter per posting — the uniqueness is what makes the operator queue count people rather than clicks.';
