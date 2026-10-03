-- ROLLBACK for 0217 (scholarship deadline-note rules, #594). Not a migration: the exact undo, kept beside the file it undoes, outside
-- supabase/migrations so nothing that reads migrations ever applies it. Run it as `postgres` in the SQL Editor. To keep the schema ledger honest,
-- record it as a NEW migration (do not delete 0217's ledger row).
--
-- WHAT IT DOES: drops the two constraints and nothing else. No row changes, so nothing is lost; the only effect is that the database stops refusing
-- a verified listing with an unstamped deadline note and a note over 600 characters. The application-side guard (publicDeadlineNote) keeps an
-- unstamped note from being shown either way.

begin;

alter table public.scholarships
  drop constraint if exists scholarships_verified_note_needs_stamp,
  drop constraint if exists scholarships_deadline_note_max_600;

do $check$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.scholarships'::regclass
       and conname in ('scholarships_verified_note_needs_stamp', 'scholarships_deadline_note_max_600')
  ) then
    raise exception '0217 rollback: a deadline-note constraint is still present';
  end if;
end
$check$;

commit;
