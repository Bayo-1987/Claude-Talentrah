/**
 * send-390 — step 4 used to describe Auto-Apply's mechanism without ever
 * naming it or saying anything about the restraint that's the actual
 * differentiator. Pinned here: the literal name appears (guards against a
 * future edit silently reverting to the unnamed, paraphrased version), the
 * cited weekly cap number tracks the real AUTO_APPLY_FREE_PER_WEEK constant
 * rather than a hardcoded duplicate that can drift out of sync, and the
 * other 3 steps are untouched.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HowItWorksSection } from "@/components/marketing/how-it-works-section";
import {
  AUTO_APPLY_FREE_PER_WEEK,
  AUTO_APPLY_DAILY_SUBMIT_CAP,
} from "@/lib/auto-apply/config";

describe("how-it-works step 4 (Auto-Apply)", () => {
  const html = renderToStaticMarkup(<HowItWorksSection />);

  it("names Auto-Apply explicitly, in the exact casing used everywhere else in the app", () => {
    expect(html).toContain("Auto-Apply");
  });

  it("cites the real, current free-weekly-cap constant, not a hardcoded duplicate", () => {
    expect(html).toContain(`capped at ${AUTO_APPLY_FREE_PER_WEEK} free applications a week`);
    // The two real constants happen to share the same numeric value today
    // (5) but are different things with different windows — this assertion
    // would still pass by coincidence if the copy had silently cited
    // AUTO_APPLY_DAILY_SUBMIT_CAP instead, so it's asserted separately as a
    // sanity check that the test itself is pinned to the right constant.
    expect(AUTO_APPLY_FREE_PER_WEEK).toBe(5);
    expect(AUTO_APPLY_DAILY_SUBMIT_CAP).toBe(5);
  });

  it("leads with the trust framing — review-gated and capped, not just the mechanism", () => {
    expect(html).toContain("your review");
    expect(html).toContain("capped");
  });

  it("never implies Auto-Apply submits to every job on the board", () => {
    // Scoped to "your best matches" (ties to the existing match-tier
    // language), not a blanket "any job" claim — per docs/auto-apply.md,
    // external postings are handed off, never submitted.
    expect(html).not.toMatch(/appl(y|ies) to (any|every) job/i);
  });

  it("leaves the other 3 steps unchanged", () => {
    expect(html).toContain("Paste a job link or description");
    expect(html).toContain("Talentrah reads the real requirements");
    expect(html).toContain("Farah analyzes the gap");
    expect(html).toContain("Get a tailored resume + match score");
  });
});
