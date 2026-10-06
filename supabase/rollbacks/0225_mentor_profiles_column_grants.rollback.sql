-- 0225 ROLLBACK. Restores the privileges mentor_profiles had before 0225: SELECT on the whole table for authenticated and anon, and no column-level SELECT grants.
-- It undoes only what 0225 changed; INSERT/UPDATE/DELETE and every other privilege are untouched. Only apply it to back 0225 out.

revoke select (user_id, status, self_paused, display_name, bio, expertise_roles, expertise_industries, expertise_seniority, years_experience, base_price_ngn, reviews_verifications) on public.mentor_profiles from authenticated;
grant select on public.mentor_profiles to authenticated, anon;

-- Self-check: the migration fails (and rolls back) unless the privileges are back to the pre-0225 shape.
do $check$
declare
  c record;
  n integer;
begin
  for c in select a.attname::text as col from pg_attribute a where a.attrelid = 'public.mentor_profiles'::regclass and a.attnum > 0 and not a.attisdropped loop
    if not has_column_privilege('authenticated', 'public.mentor_profiles', c.col, 'SELECT') then raise exception '0225 rollback: authenticated cannot read mentor_profiles.%', c.col; end if;
    if not has_column_privilege('anon', 'public.mentor_profiles', c.col, 'SELECT') then raise exception '0225 rollback: anon cannot read mentor_profiles.%', c.col; end if;
  end loop;
  select count(*) into n from pg_attribute a, aclexplode(a.attacl) g
   where a.attrelid = 'public.mentor_profiles'::regclass and a.attnum > 0 and not a.attisdropped and a.attacl is not null and g.privilege_type = 'SELECT';
  if n <> 0 then raise exception '0225 rollback: % column-level SELECT grants remain (before 0225 there were none)', n; end if;
end
$check$;
