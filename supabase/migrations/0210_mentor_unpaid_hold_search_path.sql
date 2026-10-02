-- 0210: pin search_path on mentor_unpaid_hold() (the only public function Supabase's security advisor flags).
--
-- WHY. 0203 created `public.mentor_unpaid_hold()` (the 30 minutes an unpaid mentor booking holds its slot) without a pinned search_path. The
-- advisor reports it as "Function Search Path Mutable", and checking the production catalog (every public function without a `search_path=` in its
-- proconfig, extension-owned excluded) returns exactly this one function: the advisor's count of 1 and the catalog agree. The body references no
-- database object, so pinning it to the empty string changes nothing it does; it only stops a caller's search_path from ever mattering.
--
-- HOW: ALTER, not create-or-replace. `alter function ... set search_path = ''` changes the function's config and nothing else, so the body cannot
-- drift from 0203's. (A create-or-replace restates the body: the unmerged 0208 on talentrah-preview did that, and applying 0203 after it would silently
-- have un-pinned it.) Idempotent: on a database where the pin is already present (talentrah-preview, where the unmerged 0208 set it) this is a no-op.
--
-- ALSO ADDED: function_search_path_audit(), a service-role-only read of every public function's search_path config, so a test can assert it from
-- the catalog (supabase-js cannot query pg_proc). It is read by tests, never by the app.
--
-- Additive in effect (no behaviour change), so it is applied to production BEFORE the merge, after a dry run and the owner's yes.

alter function public.mentor_unpaid_hold() set search_path = '';

do $$
begin
  if (select extract(epoch from public.mentor_unpaid_hold())) is distinct from 1800 then
    raise exception 'mentor_unpaid_hold() no longer returns 30 minutes after the search_path pin';
  end if;
  if (select proconfig::text from pg_catalog.pg_proc where proname = 'mentor_unpaid_hold' and pronamespace = 'public'::regnamespace) is distinct from '{"search_path=\"\""}' then
    raise exception 'mentor_unpaid_hold() search_path is not pinned to the empty string';
  end if;
end $$;

create or replace function public.function_search_path_audit()
returns table (function_name text, identity_args text, security_definer boolean, search_path_config text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.proname::text,
    pg_catalog.pg_get_function_identity_arguments(p.oid),
    p.prosecdef,
    (select c from pg_catalog.unnest(p.proconfig) c where c like 'search_path=%' limit 1)
  from pg_catalog.pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.prokind = 'f'
    and not exists (select 1 from pg_catalog.pg_depend d where d.objid = p.oid and d.deptype = 'e')
$$;

comment on function public.function_search_path_audit() is
  'Every public function with its search_path config (null when mutable), 0210. Service role only; read by tests, never by the app.';

revoke all on function public.function_search_path_audit() from public, anon, authenticated;
grant execute on function public.function_search_path_audit() to service_role;
