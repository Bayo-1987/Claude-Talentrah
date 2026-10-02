/**
 * send-511 — the countdown wording lives in ONE function. Five surfaces used to hand-roll "N day(s) left" from `scholarshipDaysLeft`, which is how
 * a no-zone row on its deadline day said "1 day left". A new render site that rebuilds the grammar from the day count fails here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const SITES = [
  "src/app/(app)/scholarships/[id]/page.tsx",
  "src/components/scholarships/scholarship-card.tsx",
  "src/components/scholarships/public-landing.tsx",
  "src/components/scholarships/public-scholarship-row.tsx",
  "src/lib/blog/scholarship-embed.ts",
];

describe("scholarship countdown wording", () => {
  it.each(SITES)("%s takes the countdown from the shared module, not from scholarshipDaysLeft", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src, "uses the shared display builder or countdown").toMatch(/scholarshipDeadlineDisplay|scholarshipCountdown/);
    expect(src, "no longer reads the raw day count").not.toMatch(/scholarshipDaysLeft\s*\(/);
    expect(src, "does not rebuild the days grammar by hand").not.toMatch(/"day"\s*:\s*"days"/);
    expect(src).not.toMatch(/\$\{left\}\s*\$\{left === 1/);
  });

  it("the deadline-alert email reads the ABSOLUTE statement from the same module, never the relative countdown or its own 'today/tomorrow' words", () => {
    const template = readFileSync("src/lib/scholarship-deadline-alerts/template.ts", "utf8");
    expect(template).toContain("scholarshipDeadlineStatement");
    expect(template).not.toMatch(/scholarshipCountdown|scholarshipDaysLeft|daysOutLabel|daysOut/);
    expect(template).not.toMatch(/["'`][^"'`\n]*(today|tomorrow|days left)[^"'`\n]*["'`]/i);
    const send = readFileSync("src/lib/scholarship-deadline-alerts/send.ts", "utf8");
    expect(send, "the sender no longer computes a relative day count for the wording").not.toMatch(/daysOut/);
  });

  it("no other file under src/ builds ' day(s) left' text outside close-instant.ts", () => {
    const hits = execSync(`git grep -n -E "(day|days) left" -- src ':!src/lib/scholarships/close-instant.ts' || true`, { encoding: "utf8" })
      .split("\n")
      .filter((l) => l && !/^\S+:\d+:\s*(\*|\/\/)/.test(l) && !/^\S+:\d+:\s*\/?\*/.test(l));
    expect(hits).toEqual([]);
  });
});
