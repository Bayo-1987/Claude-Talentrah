import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #156 regression guard.
 *
 * PR #444 proved — via a temporary sabotage test (a file whose own
 * assertions all pass, with an `afterAll` that deletes a guaranteed-
 * nonexistent user id), since deleted rather than kept running on every
 * CI run — that Vitest's default reporter (no `--reporter` flag, which is
 * what `npm test`/CI's own `vitest run` actually use) silently drops
 * hook-level `console.*` output on a FULLY PASSING file. That is exactly
 * the condition these four log lines exist for: the process whose
 * teardown deletes another run's live fixture is very likely to report as
 * passing itself. `process.stdout.write` bypasses that suppression;
 * `console.warn`/`console.error`/`console.log` do not.
 *
 * Nothing else guards against a future "cleanup" reflexively swapping one
 * of these back to `console.*` — it reads more natural, and most of the
 * codebase legitimately uses `console.*` elsewhere (including OTHER lines
 * in these same two files, which this test deliberately does not touch —
 * see `callerOf`'s scoping below). Reverting would look like an
 * improvement and produce a build that passes silently, which is the
 * exact failure mode #156 is about. This is a static source check rather
 * than a permanent version of the real sabotage test — the real one
 * (delete a genuine Supabase user, wait on the round trip) has too much
 * overhead to run on every CI invocation just to pin a logging channel.
 */

const LOGGING_CALLS = /\b(process\.stdout\.write|console\.(?:warn|error|log))\(/g;

/**
 * Which logging call a given anchor string is written inside, found by
 * scanning backward from the anchor's position for the nearest preceding
 * logging-call open-paren. Deliberately NOT scoped by function name or
 * line number — both files have other, legitimate `console.warn` calls
 * (e.g. global-teardown.ts's "could not list accounts to sweep") that
 * this guard must not flag; anchoring on the exact log-message text and
 * taking the nearest preceding call is robust to reformatting without
 * over-scoping to calls this fix never touched.
 */
function callerOf(source: string, anchor: string): string {
  const anchorIndex = source.indexOf(anchor);
  if (anchorIndex === -1) {
    throw new Error(`Anchor not found in source — did the log message change? "${anchor}"`);
  }
  let lastMatch: RegExpExecArray | null = null;
  LOGGING_CALLS.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LOGGING_CALLS.exec(source))) {
    if (match.index > anchorIndex) break;
    lastMatch = match;
  }
  if (!lastMatch) {
    throw new Error(`No logging call found before anchor: "${anchor}"`);
  }
  return lastMatch[1];
}

const authSource = readFileSync(path.resolve(__dirname, "auth.ts"), "utf8");
const teardownSource = readFileSync(path.resolve(__dirname, "global-teardown.ts"), "utf8");

describe("deleteTestUsers (tests/support/auth.ts)", () => {
  it("logs which account it's deleting via process.stdout.write, not console", () => {
    expect(callerOf(authSource, "deleting user=${id} at=${deletedAt}")).toBe("process.stdout.write");
  });

  it("logs a release/delete failure via process.stdout.write, not console", () => {
    expect(callerOf(authSource, "test accounts could not be released/deleted")).toBe("process.stdout.write");
  });
});

describe("sweepStaleAccounts (tests/support/global-teardown.ts)", () => {
  it("logs which account it's deleting via process.stdout.write, not console", () => {
    expect(callerOf(teardownSource, "global-sweep deleting user=${a.id}")).toBe("process.stdout.write");
  });

  it("logs its sweep summary (including failures) via process.stdout.write, not console", () => {
    expect(
      callerOf(teardownSource, "swept ${stale.length - failures.length}/${stale.length} stale "),
    ).toBe("process.stdout.write");
  });
});
