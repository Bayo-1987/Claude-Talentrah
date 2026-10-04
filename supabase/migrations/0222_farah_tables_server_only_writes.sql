-- 0222: message history is written by the server only.
--
-- The chat route saves each exchange with the service role, and nothing else writes farah_messages. So the signed-in role and the anonymous role hold no write privilege on it: INSERT and DELETE are
-- revoked here (UPDATE was revoked by 0041). Reading is unchanged: the signed-in role keeps SELECT and the owner-only policy still decides which rows it sees. The service role is untouched, and so is account
-- deletion: the profiles foreign key (ON DELETE CASCADE) is performed by Postgres as the table owner and does not use these grants.
-- farah_session_events is already written by the server only (the service role, src/lib/farah/session-events.ts; its write privileges for the signed-in role were revoked by 0151). The same revoke is repeated
-- for it so that holds for the anonymous role as well; where a privilege is already absent the statement changes nothing.
--
-- WHEN IT APPLIES: only after the route change that moves the save to the service role is deployed and READY in production. Applied earlier, the route's own save would be refused.
-- WHAT IT DOES NOT TOUCH: row level security, the policies, SELECT, the service role, any other table.
-- THE UNDO (supabase/rollbacks/0222_farah_tables_server_only_writes.rollback.sql) puts INSERT and DELETE on farah_messages back for the signed-in role, which is what the project's default privileges had given it.

revoke insert, update, delete on table public.farah_messages from public, anon, authenticated;
revoke insert, update, delete on table public.farah_session_events from public, anon, authenticated;

-- Checks itself when it is applied: the apply fails, and nothing is kept, if the privileges did not come out as written.
do $check$
declare
  t   text;
  r   name;
  p   text;
begin
  foreach t in array array['public.farah_messages', 'public.farah_session_events'] loop
    foreach r in array array['anon', 'authenticated'] loop
      foreach p in array array['insert', 'update', 'delete'] loop
        if pg_catalog.has_table_privilege(r, t::regclass, p) then
          raise exception '0222 self-check: % still holds % on %', r, p, t;
        end if;
      end loop;
    end loop;
    if exists (
      select 1
        from pg_catalog.aclexplode(coalesce((select relacl from pg_catalog.pg_class where oid = t::regclass), pg_catalog.acldefault('r', (select relowner from pg_catalog.pg_class where oid = t::regclass)))) a
       where a.grantee = 0 and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    ) then
      raise exception '0222 self-check: PUBLIC still holds a write privilege on %', t;
    end if;
  end loop;

  -- what must still work
  if not pg_catalog.has_table_privilege('authenticated', 'public.farah_messages'::regclass, 'select') then
    raise exception '0222 self-check: the signed-in role lost SELECT on public.farah_messages';
  end if;
  if not pg_catalog.has_table_privilege('authenticated', 'public.farah_session_events'::regclass, 'select') then
    raise exception '0222 self-check: the signed-in role lost SELECT on public.farah_session_events';
  end if;
  foreach p in array array['select', 'insert', 'delete'] loop
    if not pg_catalog.has_table_privilege('service_role', 'public.farah_messages'::regclass, p) then
      raise exception '0222 self-check: service_role lost % on public.farah_messages', p;
    end if;
  end loop;
  if not pg_catalog.has_table_privilege('service_role', 'public.farah_session_events'::regclass, 'insert') then
    raise exception '0222 self-check: service_role lost INSERT on public.farah_session_events';
  end if;
end
$check$;
