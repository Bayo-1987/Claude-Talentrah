/**
 * send-390 — step 4 used to describe Auto-Apply's mechanism without ever
 * naming it or saying anything about the restraint that's the actual
 * differentiator. Pinned here: the literal name appears (guards against a
 * future edit silently reverting to the unnamed, paraphrased version), the
 * cited weekly cap number tracks the real AUTO_APPLY_FREE_PER_WEEK constant
 * rather than a hardcoded duplicate that can drift out of sync, and the
 * other 3 steps are untouched. S1-43 (item 9): the free allowance is an allowance, not a cap, and step 1 no longer offers a job link.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { HowItWorksSection } from "@/components/marketing/how-it-works-section";
import {
  AUTO_APPLY_FREE_PER_WEEK,
  AUTO_APPLY_DAILY_SUBMIT_CAP,
} from "@/lib/auto-apply/config";

describe("how-it-works step 4 (Auto-Apply)", () => {
  const html = renderToStaticMarkup(<HowItWorksSection />);
  const text = html.replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'");

  it("names Auto-Apply explicitly, in the exact casing used everywhere else in the app", () => {
    expect(html).toContain("Auto-Apply");
  });

  it("states the free allowance and what comes after it, built from AUTO_APPLY_FREE_PER_WEEK", () => {
    expect(text).toContain(
      `Auto-Apply queues only your best matches and submits nothing until you confirm. Your first ${AUTO_APPLY_FREE_PER_WEEK} confirmed applications each week are free; after that, each one uses credits.`,
    );
    // The two real constants share a value today but are different things (a rolling 7 days vs a rolling 24 hours, a free line vs a
    // burst-prevention cap), so the copy is pinned to the right one by the changing-constant tests below.
    expect(AUTO_APPLY_FREE_PER_WEEK).toBe(5);
    expect(AUTO_APPLY_DAILY_SUBMIT_CAP).toBe(5);
  });

  it("never describes the free allowance as a cap: it is an allowance, after which confirming uses credits", () => {
    expect(text).not.toMatch(/capped at/i);
    expect(text).not.toMatch(/free applications a week/i);
    expect(text).toContain("uses credits");
  });

  it("leads with the trust framing: only the best matches, and nothing submitted until you confirm", () => {
    expect(text).toContain("only your best matches");
    expect(text).toContain("submits nothing until you confirm");
  });

  it("never implies Auto-Apply submits to every job on the board", () => {
    // Scoped to "your best matches" (ties to the existing match-tier
    // language), not a blanket "any job" claim — per docs/auto-apply.md,
    // external postings are handed off, never submitted.
    expect(html).not.toMatch(/appl(y|ies) to (any|every) job/i);
  });

  it("step 1 offers a pasted job description only, because nothing in the codebase fetches a job link", () => {
    expect(text).toContain("Paste a job description");
    expect(text).not.toMatch(/job link|job url|link or description/i);
  });

  it("leaves the other steps unchanged", () => {
    expect(html).toContain("Talentrah reads the real requirements");
    expect(html).toContain("Farah analyzes the gap");
    expect(html).toContain("Get a tailored resume + match score");
  });
});

describe("step 4 follows the constants when they change", () => {
  const render = async (perWeek: number) => {
    vi.resetModules();
    vi.doMock("@/lib/auto-apply/config", () => ({ AUTO_APPLY_FREE_PER_WEEK: perWeek, AUTO_APPLY_DAILY_SUBMIT_CAP: 99 }));
    const { HowItWorksSection: Section } = await import("@/components/marketing/how-it-works-section");
    return renderToStaticMarkup(<Section />).replace(/<[^>]+>/g, "");
  };
  afterEach(() => {
    vi.doUnmock("@/lib/auto-apply/config");
    vi.resetModules();
  });

  it.each([3, 5, 12])("a free allowance of %i appears as that number, and never the daily cap's", async (n) => {
    const t = await render(n);
    expect(t).toContain(`Your first ${n} confirmed applications each week are free`);
    expect(t).not.toContain("99");
  });

  it("an allowance of one reads as a sentence, not '1 confirmed applications'", async () => {
    const t = await render(1);
    expect(t).toContain("Your first confirmed application each week is free; after that, each one uses credits.");
    expect(t).not.toMatch(/1 confirmed applications/);
  });
});

describe("step 4 agrees with /how-auto-apply-works", () => {
  // every source file of the explainer route (its questions may live beside the page), so moving the copy does not blind this check
  const dir = path.join(__dirname, "../../src/app/how-auto-apply-works");
  const explainer = readdirSync(dir).filter((f) => /\.tsx?$/.test(f)).map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n");
  it("both say the same thing: a free weekly allowance, then credits, and neither calls the free allowance a cap", () => {
    expect(explainer).toContain("free weekly allowance");
    expect(explainer).toMatch(/each one costs credits/);
    expect(explainer.length).toBeGreaterThan(2000); // the whole route was read, not an empty match
    const stepText = renderToStaticMarkup(<HowItWorksSection />);
    expect(stepText).toContain("are free");
    expect(stepText).toContain("credits");
    // the explainer's "caps" are the daily submission cap and the queue cap, never the free allowance
    expect(explainer).not.toMatch(/free[^.]{0,40}capped|capped[^.]{0,40}free/i);
  });
});
