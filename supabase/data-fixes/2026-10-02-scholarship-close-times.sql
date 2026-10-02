-- 2026-10-02: closing times for six scholarships, and two public notes that quoted a time their official page does not support.
--
-- A ONE-OFF PRODUCTION DATA FIX, not a schema migration, so it lives in supabase/data-fixes/ (see README.md there) and not in
-- supabase/migrations/. It is NOT replayed by CI, which builds an empty database where these rows do not exist and where the
-- exactly-one-row assertions below would (correctly) fail. Requires 0204 (close_time / close_tz / close_at).
--
-- Owner-approved (S3-21a, 2026-10-02) after a dry-run diff. Every statement is guarded by the deadline DATE the official page was
-- checked against and by `close_tz is null` (or by the note's exact current text), and the whole fix is ONE DO block: each UPDATE
-- must touch exactly one row or the block raises and ROLLS BACK, so a guard that silently matches nothing can never half-apply it.
-- The trigger scholarships_set_close_at (0204) recomputes close_at for each row.
--
-- Left deliberately null (official page states no time/zone, contradicts itself, or could not be read): ETH, Open Doors, Commonwealth,
-- Trudeau, TUM, Pearson, Leeds, Boell.
--
-- APPLY (production, read-write, after the owner's yes on the final diff):  run this file's APPLY block.
-- ROLLBACK: the second block at the bottom restores exactly the old state, guarded by the new values.

-- ========================================== APPLY ==========================================
do $apply$
declare
  n integer;
begin
  -- Knight-Hennessy: closes 6 Oct 2026 20:00Z
  update public.scholarships set close_time = '13:00', close_tz = 'America/Los_Angeles'
   where id = '3db5eb60-aa6c-45ac-b8dd-bdb1dce4432e' and application_deadline = date '2026-10-06' and close_tz is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Knight-Hennessy: expected to update exactly 1 row, updated %', n; end if;

  -- Chevening: closes 6 Oct 2026 11:00Z
  update public.scholarships set close_time = '11:00', close_tz = 'UTC'
   where id = 'df5233e0-8963-4f84-b983-a76bd3f247f0' and application_deadline = date '2026-10-06' and close_tz is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Chevening: expected to update exactly 1 row, updated %', n; end if;

  -- Yenching: closes 30 Nov 2026 01:00Z
  update public.scholarships set close_time = '09:00', close_tz = 'Asia/Shanghai'
   where id = '4add46d0-e100-4e78-91f6-a99fefca6c4a' and application_deadline = date '2026-11-30' and close_tz is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Yenching: expected to update exactly 1 row, updated %', n; end if;

  -- Gates Cambridge: closes 8 Dec 2026 23:59Z
  update public.scholarships set close_time = '23:59', close_tz = 'Europe/London'
   where id = 'acd80953-4d11-47ec-b653-0fe78a8660fe' and application_deadline = date '2026-12-08' and close_tz is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Gates Cambridge: expected to update exactly 1 row, updated %', n; end if;

  -- UBC IMES: closes 16 Jan 2027 07:59Z
  update public.scholarships set close_time = '23:59', close_tz = 'America/Vancouver'
   where id = 'f796e831-2927-4e3d-9a98-e12b093fcf9e' and application_deadline = date '2027-01-15' and close_tz is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'UBC IMES: expected to update exactly 1 row, updated %', n; end if;

  -- Glasgow African Excellence: closes 31 Mar 2027 22:59Z
  update public.scholarships set close_time = '23:59', close_tz = 'Europe/London'
   where id = '0c74a979-529f-48c4-8259-7de54c7115c3' and application_deadline = date '2027-03-31' and close_tz is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Glasgow African Excellence: expected to update exactly 1 row, updated %', n; end if;

  -- ETH Zurich ESOP: remove the "12:59 CET" the official page does not support (it says both "11.59h MEZ" and "12.59 MEZ")
  update public.scholarships set deadline_note = 'The application window opens 1 November 2026 and closes 30 November 2026, for autumn semester 2027 entry.'
   where id = '0e9914d9-5101-43e1-be0c-69a34e8139d0' and deadline_note = 'The application window opens 1 November 2026 and closes 30 November 2026 at 12:59 CET, for autumn semester 2027 entry.';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ETH note: expected to update exactly 1 row, updated %', n; end if;

  -- Open Doors (AGU): remove "23:59 Moscow time" (not on the official page) and the now-untrue "quoted directly from"
  update public.scholarships set deadline_note = 'Registration for the 2026/27 cycle opens 20 August 2026 and closes 1 November 2026 (after which a participant can no longer edit their account or portfolio) — from od.globaluni.ru. After registration closes: Stage 1 portfolio results 13 November 2026; Stage 2 (competitive tasks/video) registration deadline 16 November 2026 for Bachelor''s/Master''s/PhD tracks, 6 December 2026 for the Postdoctoral video submission, with Stage 2 results 21 December 2026; Stage 3 interviews for Doctoral/Postdoctoral tracks run 22 December 2026-26 February 2027 (interview registration due 10 January 2027).'
   where id = '4cc04163-3b21-4c6d-84dd-b8c78b6f22f2' and deadline_note = 'Registration for the 2026/27 cycle opens 20 August 2026 and closes 1 November 2026, 23:59 Moscow time (after which a participant can no longer edit their account or portfolio) — quoted directly from od.globaluni.ru. After registration closes: Stage 1 portfolio results 13 November 2026; Stage 2 (competitive tasks/video) registration deadline 16 November 2026 for Bachelor''s/Master''s/PhD tracks, 6 December 2026 for the Postdoctoral video submission, with Stage 2 results 21 December 2026; Stage 3 interviews for Doctoral/Postdoctoral tracks run 22 December 2026-26 February 2027 (interview registration due 10 January 2027).';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Open Doors note: expected to update exactly 1 row, updated %', n; end if;
end
$apply$;

-- ========================================== ROLLBACK (not run; restores the old state) ==========================================
-- do $rollback$
-- declare n integer;
-- begin
--   update public.scholarships set close_time = null, close_tz = null
--    where id = '3db5eb60-aa6c-45ac-b8dd-bdb1dce4432e' and application_deadline = date '2026-10-06' and close_time = '13:00' and close_tz = 'America/Los_Angeles';
--   get diagnostics n = row_count;
--   if n <> 1 then raise exception 'rollback Knight-Hennessy: expected 1 row, got %', n; end if;
--   update public.scholarships set close_time = null, close_tz = null
--    where id = 'df5233e0-8963-4f84-b983-a76bd3f247f0' and application_deadline = date '2026-10-06' and close_time = '11:00' and close_tz = 'UTC';
--   get diagnostics n = row_count;
--   if n <> 1 then raise exception 'rollback Chevening: expected 1 row, got %', n; end if;
--   update public.scholarships set close_time = null, close_tz = null
--    where id = '4add46d0-e100-4e78-91f6-a99fefca6c4a' and application_deadline = date '2026-11-30' and close_time = '09:00' and close_tz = 'Asia/Shanghai';
--   get diagnostics n = row_count;
--   if n <> 1 then raise exception 'rollback Yenching: expected 1 row, got %', n; end if;
--   update public.scholarships set close_time = null, close_tz = null
--    where id = 'acd80953-4d11-47ec-b653-0fe78a8660fe' and application_deadline = date '2026-12-08' and close_time = '23:59' and close_tz = 'Europe/London';
--   get diagnostics n = row_count;
--   if n <> 1 then raise exception 'rollback Gates Cambridge: expected 1 row, got %', n; end if;
--   update public.scholarships set close_time = null, close_tz = null
--    where id = 'f796e831-2927-4e3d-9a98-e12b093fcf9e' and application_deadline = date '2027-01-15' and close_time = '23:59' and close_tz = 'America/Vancouver';
--   get diagnostics n = row_count;
--   if n <> 1 then raise exception 'rollback UBC IMES: expected 1 row, got %', n; end if;
--   update public.scholarships set close_time = null, close_tz = null
--    where id = '0c74a979-529f-48c4-8259-7de54c7115c3' and application_deadline = date '2027-03-31' and close_time = '23:59' and close_tz = 'Europe/London';
--   get diagnostics n = row_count;
--   if n <> 1 then raise exception 'rollback Glasgow African Excellence: expected 1 row, got %', n; end if;
--   update public.scholarships set deadline_note = 'The application window opens 1 November 2026 and closes 30 November 2026 at 12:59 CET, for autumn semester 2027 entry.'
--    where id = '0e9914d9-5101-43e1-be0c-69a34e8139d0' and deadline_note = 'The application window opens 1 November 2026 and closes 30 November 2026, for autumn semester 2027 entry.';
--   get diagnostics n = row_count;
--   if n <> 1 then raise exception 'rollback ETH note: expected 1 row, got %', n; end if;
--   update public.scholarships set deadline_note = 'Registration for the 2026/27 cycle opens 20 August 2026 and closes 1 November 2026, 23:59 Moscow time (after which a participant can no longer edit their account or portfolio) — quoted directly from od.globaluni.ru. After registration closes: Stage 1 portfolio results 13 November 2026; Stage 2 (competitive tasks/video) registration deadline 16 November 2026 for Bachelor''s/Master''s/PhD tracks, 6 December 2026 for the Postdoctoral video submission, with Stage 2 results 21 December 2026; Stage 3 interviews for Doctoral/Postdoctoral tracks run 22 December 2026-26 February 2027 (interview registration due 10 January 2027).'
--    where id = '4cc04163-3b21-4c6d-84dd-b8c78b6f22f2' and deadline_note = 'Registration for the 2026/27 cycle opens 20 August 2026 and closes 1 November 2026 (after which a participant can no longer edit their account or portfolio) — from od.globaluni.ru. After registration closes: Stage 1 portfolio results 13 November 2026; Stage 2 (competitive tasks/video) registration deadline 16 November 2026 for Bachelor''s/Master''s/PhD tracks, 6 December 2026 for the Postdoctoral video submission, with Stage 2 results 21 December 2026; Stage 3 interviews for Doctoral/Postdoctoral tracks run 22 December 2026-26 February 2027 (interview registration due 10 January 2027).';
--   get diagnostics n = row_count;
--   if n <> 1 then raise exception 'rollback Open Doors note: expected 1 row, got %', n; end if;
-- end
-- $rollback$;
