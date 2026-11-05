begin;
set local lock_timeout = '3s';

-- Rollback of 0275 (the apply-by-email write path). Revert PR-E2b first: nothing may still call set_job_apply_email. It refuses to run while any audit row exists, because dropping the table would
-- erase the record of who set which address; export or archive the rows, then run it. It does not clear job_postings.apply_email (0274 owns that column) and does not touch any job.
do $guard$
begin
  if exists (select 1 from public.job_posting_apply_email_events) then
    raise exception '0275 rollback refused: job_posting_apply_email_events holds rows (archive them first)';
  end if;
end
$guard$;

-- 0246's INSERT policy expression, restored: 464 characters as Postgres deparses it, md5 af80642dd9f038db9a810f4d072f167c.
alter policy "org members can manage their org's internal postings" on public.job_postings
  with check (
    source_type = 'internal'::public.job_source_type
    and public.is_org_member(organization_id)
    and unlisted_at is null
    and removed_at is null
    and removal_reason is null
    and removed_by is null
    and admin_review_decision is null
    and admin_reviewed_at is null
    and admin_reviewed_by is null
    and banner_path is null
    and claimed_by_organization_id is null
    and claimed_at is null
    and import_feed_id is null
    and import_key is null
    and employer_closed_at is null
  );

drop function if exists public.set_job_apply_email(uuid, text);
drop table if exists public.job_posting_apply_email_events;

commit;
