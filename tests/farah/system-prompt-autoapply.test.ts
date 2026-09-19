/**
 * Follow-up to send-398, found during that send's own live verification: a
 * real Groq call asking Farah "How does auto-apply work?" answered
 * "Talentrah doesn't have an auto-apply button... We don't do that", flatly
 * denying a real, shipped Phase 2 feature (CLAUDE.md: "Auto-Apply shipped
 * as its first milestone — review-queue gated, Excellent-only, server-
 * capped, credits beyond a free weekly allowance"; full mechanics in
 * docs/auto-apply.md). Root cause was the same shape as send-398's own bug:
 * FARAH_SYSTEM_PROMPT's Scope paragraph never mentioned Auto-Apply exists
 * at all, so the model filled the gap by inventing a plausible-sounding
 * "we don't do spray-and-pray" denial instead of describing the real,
 * conservative feature.
 *
 * Like send-398's own test, this can only assert the STATIC grounding text
 * — it cannot prove the live model obeys it. That needs a real provider
 * call, done once by hand as part of this fix and reported verbatim, not
 * repeated here (see CLAUDE.md's Groq TPD budget section).
 */
import { describe, expect, it } from "vitest";
import { FARAH_SYSTEM_PROMPT } from "@/lib/farah/system-prompt";

describe("FARAH_SYSTEM_PROMPT Auto-Apply framing", () => {
  it("never tells Farah to deny Auto-Apply exists", () => {
    const lower = FARAH_SYSTEM_PROMPT.toLowerCase();
    // The exact denial phrasing the live bug produced, and the general
    // shape of a denial — both must be absent.
    expect(lower).not.toContain("doesn't have an auto-apply");
    expect(lower).not.toContain("we don't do that");
    expect(lower).not.toMatch(/talentrah does not (currently )?(have|offer) auto-?apply/);
  });

  it("tells Farah Auto-Apply is real, Excellent-match-only, and review-before-submit", () => {
    const lower = FARAH_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain("auto-apply");
    expect(lower).toMatch(/real,? shipped/);
    expect(lower).toContain("excellent");
    expect(lower).toMatch(/nothing is ever submitted without/);
  });

  it("tells Farah external/aggregated matches are handed off, never marked applied", () => {
    const lower = FARAH_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toMatch(/external\/aggregated posting never submits/);
    expect(lower).toContain("never described as \"applied\"");
  });

  it("does not hardcode the exact free-allowance size or cap numbers", () => {
    // docs/auto-apply.md's own numbers (5 free/rolling 7 days, 2 credits,
    // daily cap 5, queue cap 20) live in src/lib/auto-apply/config.ts and
    // can be retuned independently — the prompt should point to the
    // product's own on-screen numbers rather than quoting a copy that can
    // drift the same way send-398's credits bug happened.
    const prompt = FARAH_SYSTEM_PROMPT;
    const autoApplySection = prompt.slice(prompt.toLowerCase().indexOf("auto-apply:"));
    expect(autoApplySection).not.toMatch(/\b5\b.*free/i);
    expect(autoApplySection).not.toMatch(/\b2\b.*credits/i);
  });
});
