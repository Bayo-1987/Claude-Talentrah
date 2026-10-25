/**
 * FARAH-JOB-CTX-1 round 2, question 2. The first-visit hint ("Farah is here to help") is a fixed card above the phone's bottom bar. After a job is handed to Farah it sat over the lower part of the panel: measured on
 * both origin/main and the fix, it overlapped the options on a 667px-high phone (and, in a pristine panel on 844px, covered the first two options). A reader who has just used Farah has found her, which is all the hint is
 * for, so the hint now hides when a job arrives. It is hidden for this page view only: it is NOT dismissed for good (no write to the profile), so its show condition is the only thing that changed.
 * A source check, like the other wiring tests (the browser proof is in e2e/farah-job-context-visible.spec.ts).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const hint = readFileSync("src/components/app-shell/farah-first-visit-hint.tsx", "utf8");
const code = hint.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("the first-visit hint and a job arriving", () => {
  it("hides itself when a job is handed to Farah, by the same event the panel listens to", () => {
    expect(code).toContain('import { onFarahJobSeed } from "@/lib/farah/job-seed";');
    expect(code).toMatch(/useEffect\(\(\) => onFarahJobSeed\(\(\) => setAside\(true\)\), \[\]\);/);
  });
  it("steps aside by hiding the card with the hidden attribute and KEEPS it in the page, because the install strip's rule is 'the hint is in the page' (src/lib/pwa/install-state.ts): removing it would release the strip over the job options on a short phone", () => {
    expect(code).toMatch(/hidden=\{aside\}/);
    expect(code).toMatch(/if \(gone\) return null;/);
    expect(code).not.toMatch(/if \(aside\) return null;/);
  });
  it("only hides: it does not dismiss for good (no server action in that path), and the hint's own buttons still do", () => {
    const at = code.indexOf("onFarahJobSeed(() =>");
    expect(at, "the hint no longer subscribes to the job event").toBeGreaterThan(-1);
    const handler = code.slice(at, code.indexOf(");", at) + 2);
    expect(handler).not.toMatch(/dismissFarahHintAction|startTransition|dismiss\(/);
    expect(code.match(/dismissFarahHintAction\(/g)).toHaveLength(1);
    expect(code).toContain("Show me");
    expect(code).toContain("Got it");
  });
});
