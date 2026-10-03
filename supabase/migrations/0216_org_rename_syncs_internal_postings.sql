-- 0216 — an organisation rename reaches the organisation's own postings. S2-13, option (a).
--
-- ── THE BUG ───────────────────────────────────────────────────────────────
-- `job_postings.company_name` is a COPY of `organizations.name`, taken when an employer posts (postJobAction). Nothing updated it when the
-- organisation was renamed, so the public job page, the feed, the sitemap titles and the JSON-LD kept the old name. Measured on production
-- 2026-10-03 (read-only): 4 internal postings, 1 out of step, the Growth Marketer posting reading "Talentrah Portal" under an organisation
-- renamed to "Talentrah" on 2026-10-02 15:31Z. External postings carry a company a SOURCE stated and have no organisation (0 external
-- postings with an organization_id), so they are not part of this.
--
-- ── WHAT THIS DOES ────────────────────────────────────────────────────────
-- One AFTER UPDATE OF name trigger on `organizations`, firing only when the name really changed, that sets `company_name` on that
-- organisation's INTERNAL postings (any status: a closed posting still shows on its own page and in the employer's list) where it
-- differs. Nothing else moves: not another organisation's postings, not an external posting, not a posting after a non-name edit.
--
-- It is SECURITY DEFINER because `company_name` here is a derived copy, not something the renaming employer is editing: gating the write
-- on the employer's own job_postings policies (and on which columns happen to be UPDATE-granted to `authenticated`) would make the copy
-- depend on grants that exist for other reasons. `search_path = ''`, every reference schema-qualified, EXECUTE revoked from public, anon
-- and authenticated (a trigger function needs no grant to be fired by its trigger). It does not touch `structured_jd` or `seniority`, so
-- `match_scores_invalidate_on_jd_change` does not fire and no score is recomputed by a rename.
--
-- ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────
-- No backfill. The one row that is already wrong is fixed by a separate, owner-approved data fix (supabase/data-fixes/), after a dry run,
-- not as a side effect of a migration. Additive: a function and a trigger, nothing existing is altered. Apply BEFORE merging
-- (supabase/migrations/README.md).

create or replace function public.sync_org_name_to_internal_postings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.job_postings
     set company_name = new.name
   where organization_id = new.id
     and source_type = 'internal'
     and company_name is distinct from new.name;
  return null;
end;
$$;

revoke all on function public.sync_org_name_to_internal_postings() from public, anon, authenticated;

drop trigger if exists organizations_sync_name_to_postings on public.organizations;
create trigger organizations_sync_name_to_postings
  after update of name on public.organizations
  for each row
  when (old.name is distinct from new.name)
  execute function public.sync_org_name_to_internal_postings();

-- Self-check, in the shape 0207 and 0192 use: fail the apply loudly rather than leave something that looks locked and isn't.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'organizations_sync_name_to_postings' and tgrelid = 'public.organizations'::regclass and not tgisinternal) then
    raise exception 'organizations_sync_name_to_postings was not created';
  end if;
  if has_function_privilege('anon', 'public.sync_org_name_to_internal_postings()', 'execute')
     or has_function_privilege('authenticated', 'public.sync_org_name_to_internal_postings()', 'execute') then
    raise exception 'sync_org_name_to_internal_postings must not be executable by anon or authenticated';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.sync_org_name_to_internal_postings()'::regprocedure) then
    raise exception 'sync_org_name_to_internal_postings must be SECURITY DEFINER';
  end if;
end $$;
