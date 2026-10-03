-- 0217: two database rules on a scholarship's deadline note (#594).
--
-- WHAT WENT WRONG. `scholarships.deadline_note` is the copy an applicant reads in place of a date when a provider genuinely has no single deadline
-- ("varies by partner institution"). The model has always said a note is valid only alongside a verified-deadline stamp (`deadline_verified_at`, see
-- src/lib/scholarships/types.ts), and nothing enforced it. A listing went public whose "deadline" was a reviewer's remark that a human should confirm
-- the date before publishing, on every surface at once, because each surface printed the column itself. The row was corrected first, by
-- supabase/data-fixes/2026-10-03-scholarship-asu-deadline-594.sql (applied to production 2026-10-03). The application now asks one function
-- (publicDeadlineNote) before showing a note, and this migration makes the database refuse the two shapes that caused and could repeat it.
--
-- 1. scholarships_verified_note_needs_stamp
--      moderation_status <> 'verified' or deadline_note is null or deadline_verified_at is not null
--    A VERIFIED (publicly visible) listing may carry a deadline note only if its deadline was verified. It deliberately does not bind pending or
--    rejected rows: a reviewer's working note may sit on a row nobody can see, and the rule bites at the moment of publishing, which is where the
--    harm was. Consequence worth knowing: a listing added by hand (the admin form never sets a stamp) that carries a note cannot be approved until
--    the note is removed. That is intended: a deadline is not verified by whoever typed it.
--
-- 2. scholarships_deadline_note_max_600
--      deadline_note is null or char_length(deadline_note) <= 600
--    A note is a short statement, not a report. 600 characters fits every note in production today, but not by much: the longest, on a verified
--    listing quoting a two-round calendar, is 590 (read-only, 2026-10-03; 38 listings carry a note). The cap exists to stop commentary being written
--    into a public field, and it is deliberately not applied by truncating: text is never cut, a longer note is refused and shortened by a person.
--    tests/scholarships/seed-note-limits.test.ts keeps the notes in the source config under it, because one over-length note fails the whole
--    nightly upsert batch it is in. The admin form shows a live count against it.
--
-- Additive in effect: no column, table or policy changes, and no rows change. Both constraints are added VALIDATED, so they are checked against every
-- existing row as they are added and the statement fails (changing nothing) if any row breaks either rule. Checked read-only against production
-- immediately before the data fix, then again after it: after the fix every one of the 49 rows satisfies both. Applied to production BEFORE the merge,
-- after the data fix, after a rolled-back dry run and the owner's yes. The undo is supabase/rollbacks/0217_scholarship_note_rules.rollback.sql.

alter table public.scholarships
  add constraint scholarships_verified_note_needs_stamp
    check (moderation_status <> 'verified' or deadline_note is null or deadline_verified_at is not null),
  add constraint scholarships_deadline_note_max_600
    check (deadline_note is null or char_length(deadline_note) <= 600);

-- Self-check: both rules exist and were validated against the existing rows. A constraint left NOT VALID would look present and enforce only new writes.
do $check$
declare
  n integer;
begin
  select count(*) into n
    from pg_constraint
   where conrelid = 'public.scholarships'::regclass
     and conname in ('scholarships_verified_note_needs_stamp', 'scholarships_deadline_note_max_600')
     and contype = 'c'
     and convalidated;
  if n <> 2 then
    raise exception '0217: expected both deadline-note constraints present and validated, found %', n;
  end if;
end
$check$;
