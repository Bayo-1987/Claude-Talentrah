import { config } from "dotenv";
import { afterEach, vi } from "vitest";
import { assertAllowedDbTarget } from "../scripts/db-target";
import { tripwire } from "./support/tripwire";

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

/*
 * THE TRIPWIRE FOR THE FARAH SPEND TALLY. The chat route reads and writes a database counter (src/lib/farah/spend-tally.ts) and fails closed when it cannot. A route test that does not
 * install the safe mocks would therefore either hit a real database (and write to a counter other tests assert on) or see the route answer 503 and fail somewhere unrelated. Neither says
 * what went wrong. So the module is replaced for EVERY test by an unsafe default that records the call and throws, and an afterEach turns any recorded call into a failure that names the
 * fix. The route swallows the thrown error (that is the fail-closed behaviour), which is why the check is in afterEach and not in the default itself.
 *
 * Ways around it, both explicit: a test installs the safe fake (tests/farah/support/route-mocks.ts, or its own vi.mock of the module), or a test of the module itself loads the real one
 * with vi.importActual. tests/farah/tally-isolation.test.ts keeps the list of files that may do either honest.
 */
vi.mock("@/lib/farah/spend-tally", () => {
  const touch = (name: string) => async () => {
    tripwire.touches.push(name);
    throw new Error(`UNSAFE DEFAULT: ${name}() was called without the safe route mocks`);
  };
  return { readSpendNano: touch("readSpendNano"), addSpendNano: touch("addSpendNano"), markHalfwayWarned: touch("markHalfwayWarned") };
});
afterEach(() => {
  const touched = tripwire.touches.splice(0);
  if (touched.length > 0) {
    throw new Error(
      `This test reached the REAL spend tally (${touched.join(", ")}) without the safe route mocks. Add vi.mock("@/lib/farah/spend-tally", ...) from tests/farah/support/route-mocks.ts ` +
        "(the route swallows the error and answers 503, which is why this check exists). A test of the tally module itself uses vi.importActual.",
    );
  }
});
