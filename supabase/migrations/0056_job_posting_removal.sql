-- 0056 — an operator can take a scam posting off the board, and put it back.
--
-- `removed` is not `closed`. Closed means the job ended; removed means WE
-- decided nobody should see this, and the two must stay distinguishable — a
-- posting closed by its source and a posting pulled for fraud are different
-- facts, and collapsing them loses the only record of the second.
--
-- Everything here is reversible on purpose. A moderator acting on a report is
-- often acting on one person's word, and a removal that cannot be undone turns
-- a mistaken report into a permanent one.

alter table public.job_postings
  add column removed_at timestamptz,
  add column removal_reason text;

comment on column public.job_postings.removed_at is
  'When an operator removed this posting. NULL for every posting that has not been.';
comment on column public.job_postings.removal_reason is
  'Why an operator removed it. Operator-written, never user-supplied.';

-- ---------------------------------------------------------------------------
-- Who can still see it
-- ---------------------------------------------------------------------------
--
-- The public loses sight of a removed posting; THE OWNING ORG DOES NOT.
--
-- `is_org_member(organization_id)` is deliberately left without the new
-- condition. An employer whose posting was pulled needs to be able to see that
-- it was, or the product's answer to "where did my job go?" is silence. That
-- is also why removal_reason exists as a column rather than a log line.
--
-- Note what this means for an external posting: it has no organization_id, so
-- there is no third branch to fall through to and it becomes invisible to
-- everyone but the service role. Correct — there is no employer here to owe an
-- explanation to, only a source we no longer trust.

drop policy "job postings are publicly readable" on public.job_postings;

create policy "job postings are publicly readable"
  on public.job_postings
  for select
  using (
    (source_type = 'external'::job_source_type and status <> 'removed'::job_status)
    or (
      exists (
        select 1 from public.organizations o
        where o.id = job_postings.organization_id and o.verified
      )
      and status <> 'removed'::job_status
    )
    or is_org_member(organization_id)
  );

-- ---------------------------------------------------------------------------
-- Who can change it
-- ---------------------------------------------------------------------------
--
-- Two halves doing two different jobs:
--
--   USING      status <> 'removed'  — an org cannot EDIT a removed posting.
--                                     Without this it could rewrite the title
--                                     and description of a listing it has been
--                                     told is a scam, and republish by other
--                                     means.
--   WITH CHECK status in (open, closed) — an org cannot REMOVE its own posting
--                                     and, more to the point, cannot RESTORE
--                                     one. Removal is an operator verb.
--
-- Together they are a trap door: `removed` is reachable only through the
-- service role, and only the service role gets out again.

drop policy "org members can update their org's internal postings" on public.job_postings;

create policy "org members can update their org's internal postings"
  on public.job_postings
  for update
  using (
    source_type = 'internal'::job_source_type
    and is_org_member(organization_id)
    and status <> 'removed'::job_status
  )
  with check (
    source_type = 'internal'::job_source_type
    and is_org_member(organization_id)
    and status in ('open'::job_status, 'closed'::job_status)
  );

-- ---------------------------------------------------------------------------
-- The two new columns are not the org's to write
-- ---------------------------------------------------------------------------
--
-- RLS decides WHICH ROWS; grants decide WHICH COLUMNS. `job_postings` carries
-- a table-level UPDATE grant to authenticated and anon, so without this an org
-- could set removal_reason on its own live posting — writing moderation
-- history it does not own — even though the policies above stop it setting the
-- status. Same shape as 0026/0027/0028/0030.
--
-- Order matters: a table-level grant overrides a column-level revoke, so the
-- table grant has to go first and the safe columns come back by name.
--
-- Both roles keep exactly what they had. anon has no UPDATE policy path at all
-- (is_org_member is false for it), so this changes nothing for anon today; it
-- is re-granted identically rather than dropped so that this migration is not
-- also a silent behaviour change to a role it was not about.

revoke update on public.job_postings from authenticated, anon;

grant update (
  source_type, organization_id, title, company_name, company_logo_url,
  location, work_type, employment_type, seniority, years_experience_min,
  description, structured_jd, external_url, external_source, status,
  posted_at, last_checked_at, dedup_fingerprint, created_at, id
) on public.job_postings to authenticated, anon;

-- ---------------------------------------------------------------------------
-- The ingest must not un-remove a posting
-- ---------------------------------------------------------------------------
--
-- THIS IS THE PART THE FEATURE DOES NOT WORK WITHOUT, and it is invisible from
-- the policies above.
--
-- `ingestAllSources` upserts every posting a source returns with
-- `status: 'open'`, on conflict of dedup_fingerprint. So an operator removes a
-- scam posting at 21:00, the cron runs at 05:00, the source still serves it,
-- and it is back on the board with nobody told. The policies cannot stop this
-- — the ingest runs as the service role, which is exactly the role that is
-- supposed to be able to set status.
--
-- The rule: once removed, a posting leaves that state only by an update that
-- ALSO clears removed_at. The admin route's restore does both in one
-- statement; the ingest's upsert never mentions removed_at, so its
-- `status = 'open'` is silently declined and the row stays removed.
--
-- SILENTLY, and not with an exception, on purpose. One ingest run upserts
-- every posting from a source in a single statement, so raising here would
-- fail the whole batch — one removed scam listing would stop real jobs being
-- ingested. A NOTICE records it instead.
--
-- A trigger rather than app-layer code for the same reason 0037 used one for
-- `hired`: any rule that lives only in TypeScript is reachable around.

create or replace function public.preserve_job_posting_removal()
returns trigger
language plpgsql
-- Pinned empty and every name qualified. Supabase's own linter flags a
-- mutable search_path on any function, and a trigger that decides whether a
-- moderation decision holds is not the one to leave resolvable by whatever
-- schema the caller happens to have in front.
set search_path = ''
as $$
begin
  if old.status = 'removed'::public.job_status
     and new.status is distinct from 'removed'::public.job_status
     and new.removed_at is not null
  then
    raise notice 'job_posting % stayed removed: an update tried to set status=% without clearing removed_at', old.id, new.status;
    new.status := old.status;
    new.removed_at := old.removed_at;
    new.removal_reason := old.removal_reason;
  end if;
  return new;
end;
$$;

create trigger preserve_job_posting_removal
  before update on public.job_postings
  for each row
  execute function public.preserve_job_posting_removal();
