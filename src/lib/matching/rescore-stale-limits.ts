/**
 * How long one call to the stale-score rescore route may run, in one place so a test can pin the relationship between the numbers.
 *
 * `maxDuration` itself must be a literal in the route file (Next reads segment config statically and cannot follow an import), so the route
 * declares `export const maxDuration = 300` and tests/matching/rescore-stale-limits.test.ts reads that literal and checks it against these.
 *
 * 300 s is Vercel's Hobby maximum (and the default); Pro allows up to 800 s (the repo's own check of the Vercel docs, 2026-10-01,
 * docs/resume-pdf-server-side-plan.md). The route is declared at the LOWER of the two so it is valid on either plan, and moving to Pro does
 * not change what it is allowed to do.
 */
export const RESCORE_PLATFORM_CEILING_SECONDS = 300;
/** The run stops itself, at a write boundary, this long after it started; the platform kills the function at maxDuration. */
export const RESCORE_SELF_STOP_MS = 200_000;
/** The self-stop must leave at least this much of maxDuration for the write in flight, the response and clock slack. */
export const RESCORE_MIN_HEADROOM_MS = 60_000;
