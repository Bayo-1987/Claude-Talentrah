/**
 * Whether a QA fixture page (/dev/*) may be served. Never on the live site.
 *
 * Fixtures mount real components with no auth and no database so an e2e can drive them. CI exercises them against the
 * production BUILD (NODE_ENV=production), so NODE_ENV cannot tell CI from the live deployment; Vercel's `VERCEL_ENV` can
 * ("production" only on the live site, absent in CI, "preview" on preview deployments). Each fixture page calls
 * `notFound()` when this returns false (tests/dev/dev-fixture-guard.test.ts).
 */
export function isDevFixtureAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV !== "production";
}
