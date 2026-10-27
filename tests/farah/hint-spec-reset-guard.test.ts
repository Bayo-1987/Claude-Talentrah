import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * FIX-FARAH-HINT-FLAKE-1. e2e/farah-job-context-visible.spec.ts shares the demo account with every other spec in its shard (one worker), and the Farah first-visit hint is rendered by the SERVER only while
 * profiles.farah_hint_dismissed_at is null (src/components/app-shell/app-shell.tsx). Its two install-strip tests click "Got it", and the dismissal is an optimistic, fire-and-forget Server Action: ending the test
 * right after the click let the write land during the NEXT test's page load, which then found no hint (main run 40227282842, 390x667, line 341).
 *
 * This is a STATIC check of the spec's source (a browser guard would need the whole stack to test one ordering rule), so it runs in plain vitest. It fails if the spec
 *   - dismisses the hint (clicks "Got it" or "Show me") and then ends its test without polling the stored flag,
 *   - waits for that write with a fixed sleep instead of the stored flag,
 *   - stops resetting the flag before each test, or stops leaving it null at the end of the file,
 *   - or carries a temporary mutant marker (the CI-teardown stand-in used to prove the fix must never be committed).
 */
const SPEC = readFileSync(join(__dirname, "../../e2e/farah-job-context-visible.spec.ts"), "utf8");
const FIXTURE = readFileSync(join(__dirname, "../../e2e/fixtures/farah-thread.ts"), "utf8");

const DISMISS_CLICK = /getByRole\("button", \{ name: "(?:Got it|Show me)" \}\)\.click\(\)/g;

/** The text from a dismissal click to the end of the test it sits in (the next test( or loop, or the end of the file). */
function afterEachDismissal(): string[] {
  const out: string[] = [];
  for (const m of SPEC.matchAll(DISMISS_CLICK)) {
    const rest = SPEC.slice(m.index! + m[0].length);
    const next = rest.search(/\n\s*(?:test\(|test\.describe\(|for \(const)/);
    out.push(next === -1 ? rest : rest.slice(0, next));
  }
  return out;
}

describe("the Farah job-context spec leaves the shared demo account's hint flag alone", () => {
  it("has at least one test that dismisses the hint, so the checks below are not vacuous", () => {
    expect(afterEachDismissal().length).toBeGreaterThan(0);
  });

  it("every dismissal is followed, inside the same test, by a poll of the STORED flag (toPass on demoFarahHintDismissedAt), not by a fixed sleep", () => {
    for (const tail of afterEachDismissal()) {
      expect(tail, "a dismissal ends its test without waiting for the write to land").toMatch(/toPass\(/);
      expect(tail).toMatch(/demoFarahHintDismissedAt\(\)/);
      expect(tail, "waiting for the dismissal with a fixed sleep is the flake").not.toMatch(/waitForTimeout\(/);
    }
  });

  it("puts the flag back to null before EVERY test (the describe's beforeEach)", () => {
    const m = SPEC.match(/test\.beforeEach\(async \(\) => \{([\s\S]*?)\n {2}\}\);/);
    expect(m, "no describe-level beforeEach found").not.toBeNull();
    expect(m![1]).toMatch(/clearDemoFarahThread\(\)/);
    expect(m![1]).toMatch(/resetDemoFarahHint\(\)/);
  });

  it("leaves the flag null at the end of the file and reads it back (afterAll)", () => {
    const m = SPEC.match(/test\.afterAll\(async \(\) => \{([\s\S]*?)\n {2}\}\);/);
    expect(m, "no afterAll found: the end state of the file is not restored").not.toBeNull();
    expect(m![1]).toMatch(/setDemoFarahHintDismissedAt\(null\)/);
    expect(m![1]).toMatch(/demoFarahHintDismissedAt\(\)/);
    expect(m![1]).toMatch(/toBeNull\(\)/);
  });

  it("carries no temporary mutant marker and no fixed tail after a dismissal", () => {
    expect(SPEC).not.toMatch(/R0b|TEMPORARY MUTANT/);
  });

  it("the flag helper checks the Supabase error and that exactly one row was touched (a refused or empty update must not pass silently)", () => {
    expect(FIXTURE).toMatch(/if \(error\) throw new Error\(`could not set the demo user's Farah hint flag/);
    expect(FIXTURE).toMatch(/data\.length !== 1/);
  });
});
