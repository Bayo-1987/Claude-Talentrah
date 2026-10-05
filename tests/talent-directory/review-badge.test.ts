/**
 * VERIFY-1 Phase 0a: what the badge says. Pure: the method from the stored score, and the exact words. (The words are the owner's, 6 Oct 2026.)
 */
import { describe, expect, it } from "vitest";
import { HOW_WE_REVIEW_PATH, RESUME_REVIEW_MEANING, resumeReviewFor, reviewMethodFromScore, reviewMethodFromType, reviewedBadgeText } from "@/lib/talent-directory/review-badge";

describe("reviewMethodFromScore: an AI review always stores a score, a mentor review never does", () => {
  it.each([
    [87, "ai"],
    [70, "ai"],
    [0, "ai"], // a score of 0 is a score
    [100, "ai"],
    [null, "mentor"],
  ])("%s -> %s", (score, method) => {
    expect(reviewMethodFromScore(score as number | null)).toBe(method);
  });

  it.each([undefined, Number.NaN])("%s (a missing or broken value, not a stored null) is 'unknown', never a guess", (score) => {
    expect(reviewMethodFromScore(score as number | undefined)).toBe("unknown");
  });
});

describe("reviewMethodFromType: the screens read the type the database answers with (0234)", () => {
  it.each([
    ["ai", "ai"],
    ["mentor", "mentor"],
    [null, "unknown"],
    [undefined, "unknown"],
    ["", "unknown"],
    ["AI", "unknown"], // the database writes lower case; anything else is not guessed at
    ["human", "unknown"],
  ])("%j -> %s", (type, method) => {
    expect(reviewMethodFromType(type as string | null | undefined)).toBe(method);
  });
});

describe("resumeReviewFor: the applicant list shows a review only when the database says there is one", () => {
  it.each([
    ["ai", "ai"],
    ["mentor", "mentor"],
    [null, null], // pending, rejected or unreviewed: the database answers null
    [undefined, null],
    ["", null],
    ["something-new", "unknown"], // a type this code does not know is still a review; it just names no reviewer
  ])("%j -> %s", (type, expected) => {
    expect(resumeReviewFor(type as string | null | undefined)).toBe(expected);
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
