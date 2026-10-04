# One-off production data fixes

Schema changes live in `supabase/migrations/` (numbered, replayed by CI on an empty database, recorded in production's migration ledger).
**A fix that edits specific production rows does not belong there**, and lives here instead.

Why separate:
- CI replays every migration on an **empty** database. A data fix names rows that exist only in production, so its exactly-one-row assertions
  would (correctly) fail there. These files are **NOT replayed by CI** and take **no migration number**.
- Production's migration ledger records versions for migrations applied through the connector. A data fix run with `execute_sql` writes no
  ledger row, so the drift check has nothing to compare and nothing to trip.

The format (enforced by `tests/supabase/data-fixes.test.ts`):
1. **Named by date**: `YYYY-MM-DD-what-it-does.sql`.
2. **One APPLY `DO` block**; every `UPDATE` in it is guarded by the row id plus the old value it expects (a deadline date, `close_tz is null`,
   or the note's exact current text) and is followed by `get diagnostics n = row_count; if n <> 1 then raise exception ...`. A `DO` block is
   atomic: one guard that matches nothing rolls the whole fix back, so it can never half-apply.
3. **A ROLLBACK block** in the same file, commented out, guarded by the new values.
4. A header that says who approved it, what it needs (e.g. which migration), and what is deliberately left untouched.

How one is applied:
1. Run the matching **dry run in a READ ONLY transaction** against production: which rows each guard matches, old versus new values.
2. Show that diff to the owner. **No production write without the owner's yes on the final diff.**
3. Validate the block on the preview project inside a transaction that raises at the end (rolled back), with the fixture rows inserted in
   that same transaction when the preview does not have them.
4. Apply the APPLY block with `execute_sql`, then verify read-only.

## Record
Because `execute_sql` writes no migration-ledger row, **the file itself is the record** of each apply. When a fix is applied, fill in its
RECORD section (the last block of the file) in the same PR: **when it was applied (UTC), who approved it, and the row count of each
statement** (each must be exactly 1, or the block raised and nothing changed), plus the result of the read-only checks that followed. A
file whose RECORD still says `<not yet applied>` has not been run.

## A fix that edits a scholarship's public text records the phrase check

Reviewer wording must never sit in a column an applicant can read (#704), and a hand-run fix bypasses the approval guard that normally stops it. So a data
fix whose APPLY block sets any public text column of `scholarships` carries, in its RECORD, a `Phrase check (before → after):` line with one `phrase: N → N`
count per reviewer phrase. Produce the numbers by running the read-only query that `reviewerCommentaryCountsQuery()` generates (in
`src/lib/scholarships/reviewer-commentary.ts`, from the same phrase list the approval guard uses) before and after the apply.
`tests/supabase/data-fixes.test.ts` fails a fix of that kind that omits it.

