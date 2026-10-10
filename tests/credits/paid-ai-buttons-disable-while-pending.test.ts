/**
 * PAID-AI-BUTTON-DISABLE-1. A double click on a paid action must be ONE call and ONE charge: the control that starts it is disabled while the call is in flight, so the second click does nothing.
 *
 * This is the audit, kept as a test. Every client component that starts a paid action (a credits spend, a wallet debit, or an LLM call that ends in one) is listed with the guard its control must
 * carry. A component that starts a paid action and is NOT listed fails the completeness check, so a new paid button cannot ship without deciding its guard. (No DOM library in this repo: it reads
 * the source, like the other wiring tests; the single-tab click behaviour in a browser belongs to QA's journeys.)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "../..");
const flat = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\s+/g, " ");

/** What starts a paid action from the browser. */
const PAID_TRIGGERS = [
  "draftSopAction",
  "runEligibilityCheckAction",
  "rewriteBulletAction",
  "unlockTemplateAction",
  "requestTalentVerificationAction",
  "requestHumanReviewVerificationAction",
  "requestTalentDirectoryBoostAction",
  "confirmAutoApplyAction",
  "draftJobWithFarahAction",
  'fetch("/api/tailoring"',
  'fetch("/api/farah/chat"',
];

/** component -> the guards it must contain (each is a regex over the whitespace-flattened source). */
const GUARDS: Record<string, RegExp[]> = {
  "src/components/scholarships/farah-actions.tsx": [/disabled=\{pending\} onClick=\{runEligibility\}/, /<Button type="button" size="sm" disabled=\{pending\} onClick=\{runSop\}/],
  "src/components/resume-builder/template-card.tsx": [/onClick=\{handleUnlock\} disabled=\{pending\}/],
  "src/components/resume-builder/resume-editor.tsx": [/disabled=\{rewritingKey !== null \|\| pendingRewrite !== null\}/],
  "src/app/(app)/talent-directory/verify/verification-panel.tsx": [/disabled=\{pending\} onClick=\{\(\) => startTransition\(async \(\) => \{ const result = await requestTalentVerificationAction/],
  "src/app/(app)/talent-directory/verify/human-review-form.tsx": [/<Button type="submit" variant="secondary" disabled=\{pending\}>/],
  "src/app/(app)/talent-directory/verify/boost-panel.tsx": [/disabled=\{pending\} onClick=\{\(\) => startTransition\(async \(\) => \{ const result = await requestTalentDirectoryBoostAction/],
  "src/components/jobs/auto-apply-queue-item.tsx": [/disabled=\{isPending\} onClick=\{runConfirm\}/],
  "src/components/employer/job-posting-form.tsx": [/disabled=\{!title\.trim\(\) \|\| drafting\}/],
  "src/components/tailoring/tailor-form.tsx": [/<Button type="submit" disabled=\{status === "loading" \|\| cannotAfford\}/],
  // The Farah panel has no button to disable: a send is refused while one is in flight (set before any await), and the input is disabled while a reply streams.
  "src/components/app-shell/farah-panel.tsx": [/if \(!trimmed \|\| pending\) return; setError\(null\); setPending\(true\);/],
};

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith(".tsx") ? [path.relative(ROOT, full)] : [];
  });
}

describe("every control that starts a paid AI action is disabled while the call is in flight", () => {
  for (const [file, guards] of Object.entries(GUARDS)) {
    it(`${file}`, () => {
      const src = flat(file);
      for (const g of guards) expect(src, String(g)).toMatch(g);
    });
  }

  it("completeness: every client component that starts a paid action is in the table above", () => {
    const starters = tsxFiles(path.join(ROOT, "src"))
      .filter((f) => {
        const src = flat(f);
        // A CALL ("name(") or the fetch, not a mention in a comment.
        return PAID_TRIGGERS.some((t) => (t.startsWith("fetch") ? src.includes(t) : src.includes(`${t}(`))) && src.startsWith('"use client"');
      })
      // The anonymous landing-page demo is free and rate-limited per IP, not a spend.
      .filter((f) => !f.endsWith("jd-demo-input.tsx"))
      // farah-panel only reads the stream route; its send guard is in the table.
      .sort();
    const listed = Object.keys(GUARDS).sort();
    for (const f of starters) expect(listed, `${f} starts a paid action but has no listed guard`).toContain(f);
  });
});
