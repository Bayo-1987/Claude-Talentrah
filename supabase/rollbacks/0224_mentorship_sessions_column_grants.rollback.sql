-- 0224 ROLLBACK. Restores the privileges mentorship_sessions had before 0224: SELECT on the whole table for authenticated and anon, and no
-- column-level SELECT grants. It undoes only what 0224 changed; the UPDATE grants on the two note columns and every other privilege are untouched. Only apply it to back 0224 out.

revoke select (id, mentor_id, mentee_id, availability_slot_id, session_type, scheduled_start, scheduled_end, price_ngn, platform_commission_ngn, mentor_payout_ngn, status, meeting_link, mentor_confirmed_at, created_at, updated_at, reminder_sent_at) on public.mentorship_sessions from authenticated;
grant select on public.mentorship_sessions to authenticated, anon;

-- Self-check: the migration fails (and rolls back) unless the privileges are back to the pre-0224 shape.
do $check$
declare
  c record;
  n integer;
begin
  for c in select a.attname::text as col from pg_attribute a where a.attrelid = 'public.mentorship_sessions'::regclass and a.attnum > 0 and not a.attisdropped loop
    if not has_column_privilege('authenticated', 'public.mentorship_sessions', c.col, 'SELECT') then
      raise exception '0224 rollback: authenticated cannot read mentorship_sessions.%', c.col;
    end if;
    if not has_column_privilege('anon', 'public.mentorship_sessions', c.col, 'SELECT') then
      raise exception '0224 rollback: anon cannot read mentorship_sessions.%', c.col;
    end if;
  end loop;
  select count(*) into n
    from pg_attribute a, aclexplode(a.attacl) g
   where a.attrelid = 'public.mentorship_sessions'::regclass and a.attnum > 0 and not a.attisdropped and a.attacl is not null and g.privilege_type = 'SELECT';
  if n <> 0 then
    raise exception '0224 rollback: % column-level SELECT grants remain (before 0224 there were none)', n;
  end if;
end
$check$;
