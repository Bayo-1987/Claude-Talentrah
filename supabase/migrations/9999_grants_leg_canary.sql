-- CANARY, NOT FOR MERGE. Run 2: the same table and view with explicit grants and the end-of-file self-check. The job "Grants under the new Data API rule" must PASS on it.
-- revoke everything first, grant only the verbs used, one explicit grant list per role, then a self-check that fails the migration if a grant is missing or an unexpected one exists.
create table public.grants_leg_canary (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null,
  label      text not null,
  created_at timestamptz not null default now()
);
alter table public.grants_leg_canary enable row level security;
create policy grants_leg_canary_anon_read on public.grants_leg_canary for select to anon using (true);
create policy grants_leg_canary_own on public.grants_leg_canary for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

revoke all on public.grants_leg_canary from public, anon, authenticated, service_role;
grant select on public.grants_leg_canary to anon;
grant select, insert, update, delete on public.grants_leg_canary to authenticated;
grant select, insert, update, delete on public.grants_leg_canary to service_role;

-- The view runs with the caller's privileges (security_invoker), so it adds no access the table does not already give; only service_role may read it.
create view public.grants_leg_canary_view with (security_invoker = true) as
  select id, owner_id, label, created_at from public.grants_leg_canary;
revoke all on public.grants_leg_canary_view from public, anon, authenticated, service_role;
grant select on public.grants_leg_canary_view to service_role;

do $check$
declare
  expected jsonb := '{"public.grants_leg_canary": {"anon": ["SELECT"], "authenticated": ["DELETE","INSERT","SELECT","UPDATE"], "service_role": ["DELETE","INSERT","SELECT","UPDATE"]}, "public.grants_leg_canary_view": {"anon": [], "authenticated": [], "service_role": ["SELECT"]}}';
  rel text;
  who text;
  found text[];
  want text[];
begin
  for rel in select * from jsonb_object_keys(expected) loop
    for who in select * from jsonb_object_keys(expected -> rel) loop
      select coalesce(array_agg(privilege_type order by privilege_type), '{}') into found
        from information_schema.role_table_grants where table_schema = 'public' and table_name = split_part(rel, '.', 2) and grantee = who;
      select coalesce(array_agg(x order by x), '{}') into want from jsonb_array_elements_text(expected -> rel -> who) x;
      raise notice '% grants for %: %', rel, who, found;
      if found <> want then
        raise exception '% self-check: % holds % but should hold % (missing or unexpected grant)', rel, who, found, want;
      end if;
    end loop;
    if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = split_part(rel, '.', 2) and grantee not in ('postgres','anon','authenticated','service_role')) then
      raise exception '% self-check: a grant to a role outside the expected set', rel;
    end if;
  end loop;
end
$check$;
