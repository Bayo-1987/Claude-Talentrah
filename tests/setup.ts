import { config } from "dotenv";
import { assertAllowedDbTarget } from "../scripts/db-target";

// Load .env.local BEFORE the guard reads it. The import above is hoisted, but
// the module has no top-level env reads — it looks at process.env when called.
config({ path: ".env.local" });


/**
 * Refuse to run the suite against a database it has no business writing to,
 * and say which one it is using either way.
 *
 * WHY THIS IS A GUARD AND NOT A NOTE IN A README. Every suite here creates real
 * auth users, organisations and job postings, and cleans them up by convention.
 * A `.env.local` that was never repointed looks and behaves exactly like a
 * correctly configured one until you check what it wrote. That happened twice
 * in one afternoon with production, unnoticed both times.
 *
 * IT NOW REFUSES THE SHARED HOSTED PROJECT TOO, which is the same failure one
 * step less obvious. Three sessions run against this repo at once; while every
 * local run pointed at one hosted project they deleted each other's fixtures,
 * and a suite asserting on a global count could fail for something another
 * session did a second earlier. CI stopped sharing in #214 — each job starts
 * its own ephemeral stack — and local runs had no equivalent until
 * `npm run db:local`.
 *
 * The banner matters as much as the refusal. "It works locally" is
 * unfalsifiable when the sentence does not say which database "locally" meant,
 * and that is exactly how the shared default went unnoticed.
 *
 * Both escape hatches exist because both targets have real uses, and neither is
 * reachable by drift: each has to be typed on the command line.
 */
assertAllowedDbTarget({
  context: "test suite",
  productionEscapeHatch: "ALLOW_TESTS_AGAINST_PRODUCTION",
  hostedEscapeHatch: "ALLOW_TESTS_AGAINST_HOSTED",
});
