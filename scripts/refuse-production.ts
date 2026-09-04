/**
 * A hard, non-overridable refusal to run a seed/catalog script against
 * production.
 *
 * Every write these scripts make targets whatever NEXT_PUBLIC_SUPABASE_URL
 * happens to be set to when they run — there is no separate "are you sure"
 * step, and .env.local is the only thing standing between a seed run and a
 * live user's data. The project ref is read directly out of that URL and
 * compared against production's own ref, not against NODE_ENV or any other
 * convention a misconfigured environment could spoof.
 *
 * Deliberately no override flag. Seeding or reactivating catalog rows is
 * not a legitimate production operation under any circumstance this repo
 * recognises — production reference-data changes go through a reviewed
 * migration (supabase/migrations/), never a script run against whichever
 * .env.local a laptop happens to have. If a script genuinely needs to touch
 * production, that is what the Supabase MCP connector is for (see
 * CLAUDE.md's "For one-off production work" note) — not this file.
 *
 * Throws rather than calling process.exit itself: both seed.ts and
 * seed-catalog.ts already funnel any thrown error from main() through
 * `.catch(err => { console.error(err); process.exit(1); })`, so throwing
 * gets the required "exit non-zero before writing anything" behaviour for
 * free, and keeps this function a plain, unit-testable check instead of a
 * process-terminating side effect.
 */
const PRODUCTION_PROJECT_REF = "nytwbbzfpytctjsoczzq";

export function refuseIfProduction(scriptName: string, supabaseUrl: string): void {
  const ref = supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (ref === PRODUCTION_PROJECT_REF) {
    throw new Error(
      `${scriptName} refuses to run against production (project ref ${PRODUCTION_PROJECT_REF}). ` +
        `Catalog and reference-data changes on production go through a reviewed migration in ` +
        `supabase/migrations/, never a script run against whatever NEXT_PUBLIC_SUPABASE_URL is ` +
        `currently set to. There is no override flag for this — point .env.local at a non-production ` +
        `project, or make the change as a migration instead.`,
    );
  }
}
