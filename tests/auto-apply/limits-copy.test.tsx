/**
 * Every description of an Auto-Apply limit is rendered from src/lib/auto-apply/config.ts, never typed (S1-26 item 2, P11).
 *
 * The constants are the enforced limits: the threshold (AUTO_APPLY_MIN_SCORE), the rolling-24h submission cap
 * (AUTO_APPLY_DAILY_SUBMIT_CAP), the free allowance per rolling 7 days (AUTO_APPLY_FREE_PER_WEEK) and the pending-queue cap
 * (AUTO_APPLY_MAX_PENDING). Four surfaces describe them in words: /how-auto-apply-works, the /auto-apply quota line, the job-feed
 * toggle, and the billing page's Pass copy. Each is rendered below with the constants REPLACED by values nothing else uses, and must
 * show those values (and none of today's); then rendered with the real constants. A hand-typed number anywhere fails the first half.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";

const OTHER = { AUTO_APPLY_MIN_SCORE: 91, AUTO_APPLY_DAILY_SUBMIT_CAP: 7, AUTO_APPLY_FREE_PER_WEEK: 3, AUTO_APPLY_MAX_PENDING: 13 };

vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

const text = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node).replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;|&amp;/g, (m) => (m === "&amp;" ? "&" : "'"));

async function withConstants<T>(values: Partial<typeof OTHER> | null, run: () => Promise<T>): Promise<T> {
  vi.resetModules();
  if (values) {
    const real = await vi.importActual<typeof import("@/lib/auto-apply/config")>("@/lib/auto-apply/config");
    vi.doMock("@/lib/auto-apply/config", () => ({ ...real, ...values }));
  } else {
    vi.doUnmock("@/lib/auto-apply/config");
  }
  return run();
}
afterEach(() => {
  vi.doUnmock("@/lib/auto-apply/config");
  vi.resetModules();
});

describe("/how-auto-apply-works", () => {
  const render = () => import("@/app/how-auto-apply-works/questions").then(({ buildQuestions }) => buildQuestions().map((q) => `${q.q}\n${text(createElement("div", null, q.a as never))}`).join("\n\n"));

  it("states the threshold, the daily cap, the queue cap and the free allowance, from the constants", async () => {
    const t = await withConstants(OTHER, render);
    expect(t).toContain("91%");
    expect(t).toContain("at most 7 applications in any rolling 24 hours");
    expect(t).toContain("at most 13 matches");
    expect(t).toContain("free weekly allowance of 3 confirmed applications");
    expect(t).toContain("each one costs credits");
  });

  it("shows none of today's numbers when the constants have changed", async () => {
    const t = await withConstants(OTHER, render);
    for (const stale of ["80%", " 5 ", "at most 5", "20 matches"]) expect(t, stale).not.toContain(stale);
  });

  it("with the real constants, says what they are today", async () => {
    const t = await withConstants(null, render);
    expect(t).toContain("80%");
    expect(t).toContain("at most 5 applications in any rolling 24 hours");
    expect(t).toContain("at most 20 matches");
    expect(t).toContain("free weekly allowance of 5 confirmed applications");
  });

  it("opening an external posting is still always free and uncapped", async () => {
    const t = await withConstants(OTHER, render);
    expect(t).toContain("always free and never counted against any cap");
  });
});

describe("the /auto-apply quota line", () => {
  const quota = { dailyRemaining: 2, freeRemaining: 1, nextSubmissionCostsCredits: false, nextSubmissionCovered: false };
  const render = () => import("@/components/jobs/auto-apply-quota-line").then(({ AutoApplyQuotaLine }) => text(createElement(AutoApplyQuotaLine, { quota })));

  it("reads 'N of CAP submissions left today · N of FREE free this week' from the constants", async () => {
    expect(await withConstants(OTHER, render)).toBe("2 of 7 submissions left today · 1 of 3 free this week");
    expect(await withConstants(null, render)).toBe("2 of 5 submissions left today · 1 of 5 free this week");
  });

  it("says what the next one costs only when it will cost something", async () => {
    const costly = { ...quota, nextSubmissionCostsCredits: true };
    const t = await withConstants(OTHER, () => import("@/components/jobs/auto-apply-quota-line").then(({ AutoApplyQuotaLine }) => text(createElement(AutoApplyQuotaLine, { quota: costly }))));
    expect(t).toMatch(/next one costs \d+ credits$/);
  });
});

describe("the job-feed toggle", () => {
  it("names the threshold and the daily cap from the constants", async () => {
    const t = await withConstants(OTHER, () => import("@/components/jobs/auto-apply-toggle").then(({ AutoApplyToggle }) => text(createElement(AutoApplyToggle, { enabled: true } as never))));
    expect(t).toContain("(91%+)");
    expect(t).toContain("never more than 7 a day");
  });
});

describe("the billing page's Pass copy", () => {
  it("names the free weekly runs by their number, from the constant, in both places it says so", async () => {
    const phrase = await withConstants(OTHER, () => import("@/lib/auto-apply/limits-copy").then((m) => m.autoApplyFreeRunsPhrase()));
    expect(phrase).toBe("your 3 free weekly applications");
    const real = await withConstants(null, () => import("@/lib/auto-apply/limits-copy").then((m) => m.autoApplyFreeRunsPhrase()));
    expect(real).toBe("your 5 free weekly applications");
    const billing = readFileSync(path.join(__dirname, "../../src/app/(app)/billing/page.tsx"), "utf8");
    expect(billing).not.toMatch(/free weekly runs/);
    expect(billing.match(/autoApplyFreeRunsPhrase\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
