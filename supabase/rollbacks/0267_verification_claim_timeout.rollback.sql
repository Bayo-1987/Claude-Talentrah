-- ROLLBACK of 0267: removes the 72-hour review-claim timeout. Drops the one function; nothing else was added, so nothing else is touched.
-- Reviews it already released stay released (pending, no reviewer): that is an ordinary state the reviewer's own release produces, and putting them back as claimed would invent a claim nobody made.
-- The code that calls the function (the daily mentorship sweep, src/lib/mentorship/sweep.ts) must be rolled back first, or the sweep reports a failed release on every run until it is.
-- Run only on the owner's separate approval.
drop function public.release_stale_verification_claims(timestamptz, interval);
