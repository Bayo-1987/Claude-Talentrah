-- 2026-10-03: the ASU / Mastercard Foundation Scholars listing shows a reviewer's note as its deadline (#594). Record the deadline the programme itself publishes
-- (verified, with the source) and move the reviewer text out of the public column.
--
-- A ONE-OFF PRODUCTION DATA FIX, not a schema migration, so it lives in supabase/data-fixes/ (see README.md there). NOT replayed by CI.
-- It must be applied BEFORE migration 0217, which adds the constraint this row would violate.
--
-- SOURCE of the deadline: the programme's own page, https://mcfscholars.asu.edu/phase-three-innovation-and-technology , read 2026-10-03, 2027-2028 intake:
--   "Submit your application by Sunday, September 27, 2026 at 23:59 GMT"
-- (The official application form, asu.co1.qualtrics.com, is JavaScript-rendered and shows no text; the programme page is what states the date.)
-- close_tz is 'UTC', not 'GMT': it gives the same instant (2026-09-27T23:59:00Z, dry-run checked) and is already used by another row, where 'GMT' is new here.
--
-- The one UPDATE is guarded by the row id, by md5 of the current deadline_note (it fires only on exactly the 698-character text that was dry-run), by
-- status 'verified' and by there being no deadline and no verified stamp yet. It sits in ONE DO block that raises, and so rolls back, unless exactly 1 row changed.
-- The trigger scholarships_set_close_at (0204) computes close_at. Status is left 'verified': the cycle has closed, so the daily expiry sweep withdraws the listing
-- ("Cycle deadline passed.") on its own, as for every other lapsed listing.
--
-- Left deliberately untouched: every other scholarship (the READ ONLY audit found this the only verified row with a note and no verified stamp).
--
-- APPROVAL: pending the owner's yes on this dry-run diff. NEEDS: nothing before it; migration 0217 needs it.
-- APPLY (production, read-write, after the owner's yes):  run this file's APPLY block.
-- ROLLBACK: the second block at the bottom restores the old state, guarded by the new values.

-- ========================================== APPLY ==========================================
do $apply$
declare
  n integer;
begin
  update public.scholarships
     set application_deadline = date '2026-09-27',
         close_time = time '23:59',
         close_tz = 'UTC',
         deadline_verified_at = now(),
         moderation_note = 'Data fix #594, 2026-10-03. Deadline taken from the programme''s own page https://mcfscholars.asu.edu/phase-three-innovation-and-technology, 2027-2028 intake: "Submit your application by Sunday, September 27, 2026 at 23:59 GMT". The cycle has closed, so the daily expiry sweep withdraws the listing. Reviewer text moved here from deadline_note: ' || deadline_note,
         deadline_note = null
   where id = 'b78fa6f6-85d4-496a-9b60-d950abf7f416'
     and md5(deadline_note) = 'd8b421a7eede5bc6947f7263cd5ba8d1'
     and moderation_status = 'verified'
     and application_deadline is null
     and deadline_verified_at is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ASU deadline: expected to update exactly 1 row, updated %', n; end if;
end
$apply$;

-- ========================================== ROLLBACK (not run; restores the old state) ==========================================
-- do $rollback$
-- declare n integer;
-- begin
--   -- the moved reviewer text is everything after the fixed prefix in moderation_note
--   update public.scholarships
--      set deadline_note = substring(moderation_note from position('Reviewer text moved here from deadline_note: ' in moderation_note) + length('Reviewer text moved here from deadline_note: ')),
--          moderation_note = null, application_deadline = null, close_time = null, close_tz = null, deadline_verified_at = null
--    where id = 'b78fa6f6-85d4-496a-9b60-d950abf7f416' and application_deadline = date '2026-09-27' and close_tz = 'UTC' and deadline_note is null
--      and moderation_note like 'Data fix #594, 2026-10-03.%';
--   get diagnostics n = row_count;
--   if n <> 1 then raise exception 'rollback ASU deadline: expected 1 row, got %', n; end if;
--   -- (a rollback re-publishes the reviewer text as a public deadline: run it only to undo a mistaken apply, never to leave the row live)
-- end
-- $rollback$;

-- ========================================== RECORD (filled in when the APPLY block is run; execute_sql writes no ledger row) ==========================================
-- Applied at (UTC): 2026-10-03 17:23:48 (production nytwbbzfpytctjsoczzq; the stamp written by now() in the apply block)
-- Approved by:      the owner, in chat, 2026-10-03 ("(a) yes, apply the ASU deadline fix")
-- Row counts:       1 row updated (the block raises unless exactly 1). Read back read-only afterwards: moderation_status verified, application_deadline
--                   2026-09-27, close_time 23:59, close_tz UTC, close_at 2026-09-27 23:59:00+00 (the trigger computed it), deadline_note null,
--                   moderation_note begins "Data fix #594, 2026-10-03." Table-wide at 17:36 UTC: 49 rows, 46 verified, 0 verified rows with a note and no
--                   stamp, 0 notes over 600 characters (so migration 0217's constraints validate).
-- Phrase check (before → after): rows table-wide carrying each reviewer phrase in a public text column, as produced by reviewerCommentaryCountsQuery()
--   (src/lib/scholarships/reviewer-commentary.ts). Before = read from the row's text before the apply; after = measured read-only 2026-10-03 after it.
--   a human should: 1 → 0
--   not independently confirmed: 1 → 1
--   not machine-verified: 1 → 0
--   needs a human to confirm: 1 → 1
--   see moderation_note: 1 → 1
--   The three that remain are in the eligibility columns, which this fix deliberately did not touch (the listing is withdrawn by the expiry sweep; tracked in #704).
