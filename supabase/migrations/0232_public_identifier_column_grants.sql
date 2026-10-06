-- 0232: internal identifiers and moderation notes are no longer readable by signed-out visitors or signed-in users on four public listings.
-- Explicit per-column SELECT grants (the 0218 pattern).
--
-- WHAT. On four tables, SELECT is no longer granted on the whole table to anon or authenticated: each of the two roles is granted SELECT on every column by name except the withheld columns below. They hold the user
-- identifier of the person who created, edited or reviewed a row, a moderation note, or an employer's company-registration details, and the application reads them only on the server (the service role) or, for the
-- employer's own company-registration details, through a server read of that employer's own organisation. Withheld columns:
--   organizations: cac_number, cac_business_name, cac_confirmed_by, created_by
--   scholarships: moderation_note, moderated_by
--   blog_posts: created_by, updated_by
--   mentorship_reviews: reviewer_id, session_id
--
-- ONE POLICY CHANGES WITH IT. The insert rule on organization_members, "a user can join an organisation they created", asked whether the caller created the organisation by reading organizations.created_by in a subquery. A subquery in a rule is
-- evaluated with the caller's own privileges, so once created_by is withheld that insert would fail for every employer who creates an organisation. The rule now calls public.is_organization_creator(uuid), a SECURITY
-- DEFINER function (the is_org_member pattern: STABLE, search_path pinned to public) that answers the same question as a boolean, and no other part of the rule changes. The function may be executed by authenticated and
-- service_role only; the rule applies to authenticated only. No other rule, view or SECURITY INVOKER function reads a withheld column (checked in the catalogue before this was written).
--
-- CONSEQUENCES. select * and an embed such as organizations(*) on these four tables now fail 42501 for the API roles, and so does a read of a withheld column by name, as a filter or as UPDATE ... RETURNING; a column added
-- later is unreadable until a migration grants it (tests/rls/identifier-column-grants.test.ts holds that). INSERT, UPDATE and DELETE column and table grants, and everything for service_role, are unchanged. Application code
-- that read a withheld column, or used select(*) / (*) on these tables through the signed-in or signed-out client, must be changed first (it is listed in the pull request).

create or replace function public.is_organization_creator(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $f$
  select exists (
    select 1
    from public.organizations o
    where o.id = p_organization_id
      and o.created_by = (select auth.uid())
  );
$f$;

revoke all on function public.is_organization_creator(uuid) from public, anon;
grant execute on function public.is_organization_creator(uuid) to authenticated, service_role;

drop policy "a user can join an organisation they created" on public.organization_members;
create policy "a user can join an organisation they created" on public.organization_members
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_organization_creator(organization_id));

revoke select on table public.organizations from anon, authenticated;
grant select (cac_confirmed_at, claim_review_dismissed_at, created_at, description, domain, id, logo_url, name, updated_at, verification_reminder_48h_sent_at, verification_reminder_7d_sent_at, verified) on public.organizations to anon, authenticated;

revoke select on table public.scholarships from anon, authenticated;
grant select (application_deadline, close_at, close_time, close_tz, created_at, cycle_year, deadline_note, deadline_verified_at, dedup_fingerprint, degree_levels, eligibility_age, eligibility_nationalities, eligibility_other, eligibility_prior_degree, field_tags, funding_covers, funding_type, host_institution, id, last_checked_at, moderated_at, moderation_status, official_url, program_name, provider, source_name, updated_at) on public.scholarships to anon, authenticated;

revoke select on table public.blog_posts from anon, authenticated;
grant select (author, body, created_at, description, id, published_at, slug, status, title, updated_at) on public.blog_posts to anon, authenticated;

revoke select on table public.mentorship_reviews from anon, authenticated;
grant select (created_at, id, mentor_id, rating, review_text) on public.mentorship_reviews to anon, authenticated;

-- Self-check: the migration fails (and rolls back) unless every live column of every table is in the intended state for both roles, the function is closed to anon and the rule uses it.
do $check$
declare
  rec record;
  c record;
  role_name text;
begin
  for rec in select * from (values
    ('organizations', array['cac_number', 'cac_business_name', 'cac_confirmed_by', 'created_by']),
    ('scholarships', array['moderation_note', 'moderated_by']),
    ('blog_posts', array['created_by', 'updated_by']),
    ('mentorship_reviews', array['reviewer_id', 'session_id'])
  ) as v(tbl, withheld) loop
    foreach role_name in array array['anon', 'authenticated'] loop
      for c in select a.attname::text as col from pg_attribute a where a.attrelid = ('public.' || rec.tbl)::regclass and a.attnum > 0 and not a.attisdropped loop
        if c.col = any (rec.withheld) then
          if has_column_privilege(role_name, ('public.' || rec.tbl)::regclass, c.col, 'SELECT') then
            raise exception '0232: % is still granted SELECT on %.%', role_name, rec.tbl, c.col;
          end if;
        elsif not has_column_privilege(role_name, ('public.' || rec.tbl)::regclass, c.col, 'SELECT') then
          raise exception '0232: % cannot read %.% (a live column missing from the grant list)', role_name, rec.tbl, c.col;
        end if;
      end loop;
    end loop;
    for c in select a.attname::text as col from pg_attribute a where a.attrelid = ('public.' || rec.tbl)::regclass and a.attnum > 0 and not a.attisdropped loop
      if not has_column_privilege('service_role', ('public.' || rec.tbl)::regclass, c.col, 'SELECT') then
        raise exception '0232: service_role lost SELECT on %.%', rec.tbl, c.col;
      end if;
    end loop;
  end loop;
  if has_function_privilege('anon', 'public.is_organization_creator(uuid)', 'EXECUTE') or not has_function_privilege('authenticated', 'public.is_organization_creator(uuid)', 'EXECUTE') or not has_function_privilege('service_role', 'public.is_organization_creator(uuid)', 'EXECUTE')
     or exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) g where p.oid = 'public.is_organization_creator(uuid)'::regprocedure and g.grantee = 0) then
    raise exception '0232: public.is_organization_creator has the wrong execute privileges';
  end if;
  if not exists (select 1 from pg_policy p where p.polrelid = 'public.organization_members'::regclass and p.polname = 'a user can join an organisation they created' and p.polcmd = 'a'
                   and pg_get_expr(p.polwithcheck, p.polrelid) like '%is_organization_creator%' and pg_get_expr(p.polwithcheck, p.polrelid) not like '%created_by%'
                   and (select array_agg(r.rolname::text) from pg_roles r where r.oid = any (p.polroles)) = array['authenticated']) then
    raise exception '0232: the organization_members insert rule is not in the intended shape';
  end if;
end
$check$;
