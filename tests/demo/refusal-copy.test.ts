/**
 * P1 — a refused visitor always gets a clear reason and a next step, never a dead end.
 * One message per refusal reason, from one place (src/lib/demo/refusal-copy.ts); the route returns it and the
 * client renders it. Rendering is tests/marketing/jd-demo-refusal.test.tsx.
 */
import { describe, expect, it } from "vitest";
import { DEMO_REFUSAL_REASONS, demoRefusalMessage } from "@/lib/demo/refusal-copy";
import { ANON_DEMO_DAILY_CAP } from "@/lib/demo/anonymous-limit";

describe("demoRefusalMessage", () => {
  it("covers every refusal reason the limiter can return", () => {
    expect([...DEMO_REFUSAL_REASONS].sort()).toEqual(["already_used", "daily_cap", "error", "no_identifier"]);
  });

  it("already used: says so plainly and points at a free account", () => {
    expect(demoRefusalMessage("already_used")).toBe(
      "You've used your free preview — create a free account to keep going.",
    );
  });

  it("daily cap: states the reason with the REAL cap, and offers both ways forward", () => {
    const m = demoRefusalMessage("daily_cap");
    expect(m).toContain(`${ANON_DEMO_DAILY_CAP} a day`);
    expect(m).toMatch(/create a free account to keep going/i);
    expect(m).toMatch(/tomorrow/i);
  });

  it.each(["no_identifier", "error"] as const)("%s: is OUR failure, says it is temporary, and still gives a next step", (reason) => {
    const m = demoRefusalMessage(reason);
    expect(m).toMatch(/isn't available right now/i);
    expect(m).toMatch(/try again/i);
    expect(m).toMatch(/create a free account/i);
    // not the visitor's fault, so it must never say they used it up
    expect(m).not.toMatch(/used/i);
  });

  it("every message ends the sentence — no dangling clause, no dead end", () => {
    for (const r of DEMO_REFUSAL_REASONS) expect(demoRefusalMessage(r)).toMatch(/[.!]$/);
  });
});
