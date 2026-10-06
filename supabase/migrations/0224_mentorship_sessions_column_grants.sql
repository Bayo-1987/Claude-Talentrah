-- 0224: mentorship_sessions column privileges, explicit per-column SELECT grants (the 0218 pattern).
--
-- WHAT. SELECT on public.mentorship_sessions is no longer granted on the whole table to authenticated and anon. authenticated is granted SELECT on 14 of the 18 columns, by name; the four it is
-- not granted are mentee_notes, mentor_notes, platform_commission_ngn and mentor_payout_ngn (product decisions, owner, 4 and 5 Oct 2026: each note is private to its author, and the two amounts
-- are server-side only). anon is granted none (it has no policy on this table and no public reader: public pages use definer functions). The two note columns are written by the app (their
-- UPDATE grants are untouched and the 0133 trigger still enforces authorship) and are read only on the server, with the service role. The booking function writes both amounts as a definer
-- function and the payment and settlement code reads them with the service role; neither is touched here.
--
-- CONSEQUENCES. select * on this table now fails 42501 for the API roles, and so does a read of one of the four columns by name or an UPDATE ... RETURNING of one; a column added later is
-- unreadable until a migration grants it (tests/rls/mentorship-sessions-column-grants.test.ts holds that). No code reads any of the four through a session client
-- (tests/mentorship/commission-split.test.ts reads the amounts with the service role). anon's INSERT, UPDATE and DELETE grants are NOT touched here (they wait for the broader revoke).
-- The service role is unaffected.

revoke select on public.mentorship_sessions from authenticated, anon;
grant select (id, mentor_id, mentee_id, availability_slot_id, session_type, scheduled_start, scheduled_end, price_ngn, status, meeting_link, mentor_confirmed_at, created_at, updated_at, reminder_sent_at) on public.mentorship_sessions to authenticated;

-- Self-check: the migration fails (and rolls back) unless every live column is in the intended state for each role.
do $check$
declare
  c record;
begin
  for c in select a.attname::text as col from pg_attribute a where a.attrelid = 'public.mentorship_sessions'::regclass and a.attnum > 0 and not a.attisdropped loop
    if has_column_privilege('anon', 'public.mentorship_sessions', c.col, 'SELECT') then
      raise exception '0224: anon is still granted SELECT on mentorship_sessions.%', c.col;
    end if;
    if c.col in ('mentee_notes', 'mentor_notes', 'platform_commission_ngn', 'mentor_payout_ngn') then
      if has_column_privilege('authenticated', 'public.mentorship_sessions', c.col, 'SELECT') then
        raise exception '0224: authenticated is still granted SELECT on mentorship_sessions.% (a server-only column)', c.col;
      end if;
      if c.col in ('mentee_notes', 'mentor_notes') and not has_column_privilege('authenticated', 'public.mentorship_sessions', c.col, 'UPDATE') then
        raise exception '0224: authenticated lost UPDATE on mentorship_sessions.% (the app could no longer write this column)', c.col;
      end if;
    elsif not has_column_privilege('authenticated', 'public.mentorship_sessions', c.col, 'SELECT') then
      raise exception '0224: authenticated cannot read mentorship_sessions.% (a live column missing from the grant list)', c.col;
    end if;
    if c.col in ('platform_commission_ngn', 'mentor_payout_ngn', 'mentee_notes', 'mentor_notes') and not has_column_privilege('service_role', 'public.mentorship_sessions', c.col, 'SELECT') then
      raise exception '0224: service_role lost SELECT on mentorship_sessions.%', c.col;
    end if;
  end loop;
end
$check$;
