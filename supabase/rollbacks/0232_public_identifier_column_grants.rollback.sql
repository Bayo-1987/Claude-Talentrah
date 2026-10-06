-- ROLLBACK of 0232: restores whole-table SELECT for anon and authenticated on the four tables (the per-column SELECT grants this migration made are removed first, so no column-level entry is left behind),
-- puts the organization_members insert rule back to its previous text (the subquery on organizations.created_by) and drops the helper function. Nothing else is touched: INSERT, UPDATE, DELETE and the other table
-- privileges of every role are as they were, because the migration did not change them.

drop policy "a user can join an organisation they created" on public.organization_members;
create policy "a user can join an organisation they created" on public.organization_members
  for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.organizations o where o.id = organization_members.organization_id and o.created_by = (select auth.uid())));
drop function public.is_organization_creator(uuid);

revoke select (cac_confirmed_at, claim_review_dismissed_at, created_at, description, domain, id, logo_url, name, updated_at, verification_reminder_48h_sent_at, verification_reminder_7d_sent_at, verified) on public.organizations from anon, authenticated;
grant select on table public.organizations to anon, authenticated;
revoke select (application_deadline, close_at, close_time, close_tz, created_at, cycle_year, deadline_note, deadline_verified_at, dedup_fingerprint, degree_levels, eligibility_age, eligibility_nationalities, eligibility_other, eligibility_prior_degree, field_tags, funding_covers, funding_type, host_institution, id, last_checked_at, moderated_at, moderation_status, official_url, program_name, provider, source_name, updated_at) on public.scholarships from anon, authenticated;
grant select on table public.scholarships to anon, authenticated;
revoke select (author, body, created_at, description, id, published_at, slug, status, title, updated_at) on public.blog_posts from anon, authenticated;
grant select on table public.blog_posts to anon, authenticated;
revoke select (created_at, id, mentor_id, rating, review_text) on public.mentorship_reviews from anon, authenticated;
grant select on table public.mentorship_reviews to anon, authenticated;

-- Self-check: the rollback fails (and rolls back) unless every live column of every table is readable by both roles again, no column-level SELECT entry is left, the helper function is gone and the rule is back to its previous form.
do $rbcheck$
declare
  rec record;
  c record;
  role_name text;
begin
  for rec in select * from (values ('organizations'), ('scholarships'), ('blog_posts'), ('mentorship_reviews')) as v(tbl) loop
    foreach role_name in array array['anon', 'authenticated'] loop
      if not has_table_privilege(role_name, ('public.' || rec.tbl)::regclass, 'SELECT') then
        raise exception '0232 rollback: % cannot read public.% as a whole table', role_name, rec.tbl;
      end if;
      for c in select a.attname::text as col, a.attacl from pg_attribute a where a.attrelid = ('public.' || rec.tbl)::regclass and a.attnum > 0 and not a.attisdropped loop
        if not has_column_privilege(role_name, ('public.' || rec.tbl)::regclass, c.col, 'SELECT') then
          raise exception '0232 rollback: % cannot read %.%', role_name, rec.tbl, c.col;
        end if;
        if c.attacl is not null and exists (select 1 from aclexplode(c.attacl) g where g.privilege_type = 'SELECT') then
          raise exception '0232 rollback: a column-level SELECT grant is left on %.%', rec.tbl, c.col;
        end if;
      end loop;
    end loop;
  end loop;
  if to_regprocedure('public.is_organization_creator(uuid)') is not null then
    raise exception '0232 rollback: public.is_organization_creator still exists';
  end if;
  if not exists (select 1 from pg_policy p where p.polrelid = 'public.organization_members'::regclass and p.polname = 'a user can join an organisation they created' and p.polcmd = 'a'
                   and pg_get_expr(p.polwithcheck, p.polrelid) like '%created_by%' and pg_get_expr(p.polwithcheck, p.polrelid) not like '%is_organization_creator%') then
    raise exception '0232 rollback: the organization_members insert rule is not back to its previous form';
  end if;
end
$rbcheck$;
