/**
 * How long the ingest route may spend on the match-score refresh it now runs at its end, in one place so a test can pin the relationship
 * between the numbers (tests/matching/post-ingest-refresh-limits.test.ts).
 *
 * `maxDuration` itself must be a literal in the route file (Next reads segment config statically and cannot follow an import), so the route
 * declares `export const maxDuration = 300` and the test reads that literal and checks it against these.
 *
 * 300 s is Vercel's Hobby maximum (and the default); Pro allows more (docs/resume-pdf-server-side-plan.md, the repo's own check of the Vercel
 * docs, 2026-10-01). The route is declared at the LOWER of the two so it is valid on either plan; moving to Pro changes nothing here.
 *
 * ALL TIMES ARE MEASURED FROM THE ROUTE'S OWN START: ingestion, both expiry sweeps and the proactive alerts spend the budget first, and the
 * refresh gets what is left.
 */
export const PLATFORM_CEILING_SECONDS = 300;

/** The refresh stops starting new users once the route has run this long (it stops on a user boundary, so nothing is half-written). */
export const REFRESH_SELF_STOP_MS = 240_000;

/** The self-stop must leave at least this much of maxDuration for the user write in flight and the response. */
export const REFRESH_MIN_HEADROOM_MS = 45_000;

/** If fewer than this many ms remain before the self-stop when the refresh would start, it is skipped (with a logged reason) rather than started. */
export const REFRESH_MIN_USEFUL_MS = 20_000;
