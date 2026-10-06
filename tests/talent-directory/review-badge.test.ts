/**
 * VERIFY-1 Phase 0a: what the badge says. Pure: the method from the database's review type, and the exact words. (The words are the owner's, 6 Oct 2026.)
 */
import { describe, expect, it } from "vitest";
import { HOW_WE_REVIEW_PATH, RESUME_REVIEW_MEANING, resumeReviewFor, reviewMethodFromType, reviewedBadgeText } from "@/lib/talent-directory/review-badge";

describe("reviewMethodFromType: the screens read the type the database records (0234), 'human' being a mentor", () => {
  it.each([
    ["ai", "ai"],
    ["human", "mentor"],
    [null, "unknown"],
    [undefined, "unknown"],
    ["", "unknown"],
    ["mentor", "unknown"], // the database's word is 'human'; anything else is not guessed at
    ["AI", "unknown"],
  ])("%j -> %s", (type, method) => {
    expect(reviewMethodFromType(type as string | null | undefined)).toBe(method);
  });
});

describe("resumeReviewFor: the applicant list shows a review only for a profile whose review passed", () => {
  it.each([
    ["verified", "ai", "ai"],
    ["verified", "human", "mentor"],
    ["verified", null, "unknown"], // reviewed, but no passed review row to read the reviewer from: says so, names no one
    ["unverified", null, null],
    ["unverified", "ai", null],
    ["pending", "human", null],
    ["rejected", "ai", null],
    ["rejected", null, null],
    ["claimed", null, null],
    ["", "ai", null],
  ])("status %j, type %j -> %s", (status, type, expected) => {
    expect(resumeReviewFor(status, type as string | null)).toBe(expected);
  });
});

describe("reviewedBadgeText", () => {
  it("names Farah (AI) or a Talentrah mentor, then the date", () => {
    expect(reviewedBadgeText("ai", "2026-10-05T09:30:00Z")).toBe("Resume reviewed by Farah (AI) · 5 Oct 2026");
    expect(reviewedBadgeText("mentor", "2026-10-12T22:30:00Z")).toBe("Resume reviewed by a Talentrah mentor · 12 Oct 2026");
  });

  it("without a date it is the same words and nothing after them", () => {
    expect(reviewedBadgeText("ai")).toBe("Resume reviewed by Farah (AI)");
    expect(reviewedBadgeText("mentor", null)).toBe("Resume reviewed by a Talentrah mentor");
  });

  it("when the method is not known it says only that the resume was reviewed, never a method", () => {
    expect(reviewedBadgeText("unknown", "2026-10-05T09:30:00Z")).toBe("Resume reviewed · 5 Oct 2026");
    expect(reviewedBadgeText("unknown")).toBe("Resume reviewed");
  });

  it("an unreadable date is left out rather than shown as a broken one", () => {
    expect(reviewedBadgeText("ai", "not a date")).toBe("Resume reviewed by Farah (AI)");
  });

  it("never carries a score, a slash-100, or the word verified", () => {
    for (const m of ["ai", "mentor", "unknown"] as const) {
      const text = reviewedBadgeText(m, "2026-10-05T09:30:00Z");
      expect(text).not.toMatch(/\d+\s*\/\s*100|verified/i);
    }
  });
});

describe("what it means", () => {
  it("is the owner's sentence, word for word", () => {
    expect(RESUME_REVIEW_MEANING).toBe("We checked that the resume is complete, specific and consistent. We did not check identity, employment history or skills.");
  });

  it("points at the public page that says what is and is not checked", () => {
    expect(HOW_WE_REVIEW_PATH).toBe("/how-we-review-resumes");
  });
});
