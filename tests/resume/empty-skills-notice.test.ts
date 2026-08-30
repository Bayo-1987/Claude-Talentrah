/**
 * Whether the "your resume has no skills" notice shows (#145).
 *
 * ── WHAT THIS IS PROTECTING ───────────────────────────────────────────────
 *
 * A resume stored with an empty skills array cannot be scored: matching
 * divides against the job's screenable skills and matches none of them, so
 * every posting lands near zero, Excellent is unreachable, and Auto-Apply can
 * never fire. One production account has been in that state for days, having
 * been told once — transiently, on the onboarding success card — and never
 * again.
 *
 * ── THE TWO WAYS THIS GOES WRONG, AND BOTH ARE HERE ───────────────────────
 *
 * FALSE NEGATIVE: it fails to fire for the account it was built for. The
 * shapes below (missing key, null, non-array) are real row states, because
 * `structured_content` is jsonb with no schema enforcement.
 *
 * FALSE POSITIVE: it nags a user whose resume is fine. That is how a notice
 * becomes wallpaper, and this one needs to be believed the single time it
 * matters — so "a populated resume never triggers it" is asserted as hard as
 * the positive case.
 */
import { describe, expect, it } from "vitest";
import {
  shouldShowEmptySkillsNotice,
  type BaseResumeForNotice,
} from "@/lib/resume/empty-skills-notice";

const resume = (structured_content: unknown): BaseResumeForNotice => ({
  id: "11111111-1111-1111-1111-111111111111",
  structured_content,
});

describe("it fires for a resume that cannot be scored", () => {
  it("shows when skills is an empty array", () => {
    // The exact production shape: experience parsed, skills did not.
    expect(
      shouldShowEmptySkillsNotice(resume({ skills: [], experience: [{ title: "PM" }] }), null),
    ).toBe(true);
  });

  it.each([
    ["the key is absent entirely", { experience: [] }],
    ["skills is null", { skills: null }],
    ["skills is not an array", { skills: "SQL, Python" }],
    ["structured_content is null", null],
  ])("shows when %s", (_label, content) => {
    // All of these mean the same thing to computeMatchScore — nothing to score
    // against — so they mean the same thing here. jsonb enforces no shape.
    expect(shouldShowEmptySkillsNotice(resume(content), null)).toBe(true);
  });

  it("shows regardless of parse_confidence, including for rows that predate 0070", () => {
    /*
     * The whole reason this gates on the array. The affected account's row was
     * written before 0070, so its `parse_confidence` is null — "never
     * recorded", not "fine". Nothing here consults it.
     */
    expect(shouldShowEmptySkillsNotice(resume({ skills: [] }), null)).toBe(true);
  });
});

describe("it stays quiet when it would be wrong", () => {
  it("never fires for a resume that has skills", () => {
    // The false-positive guard. A notice that nags people whose resume is fine
    // is one nobody reads the day it is right.
    expect(shouldShowEmptySkillsNotice(resume({ skills: ["sql"] }), null)).toBe(false);
    expect(
      shouldShowEmptySkillsNotice(resume({ skills: ["sql", "figma", "agile"] }), null),
    ).toBe(false);
  });

  it("does not fire for a user with no base resume at all", () => {
    // A different problem with a different fix, already owned by onboarding.
    // Saying "your resume has no skills" to someone with no resume is false.
    expect(shouldShowEmptySkillsNotice(null, null)).toBe(false);
    expect(shouldShowEmptySkillsNotice(undefined, null)).toBe(false);
  });

  it("stays hidden once dismissed, even though the resume is still empty", () => {
    // Dismissal hides the notice and changes nothing else — the resume is
    // still unscoreable, which is why the copy leads with the fix.
    expect(
      shouldShowEmptySkillsNotice(resume({ skills: [] }), "2026-08-30T12:00:00.000Z"),
    ).toBe(false);
  });

  it("treats a dismissal that was never recorded as not dismissed", () => {
    expect(shouldShowEmptySkillsNotice(resume({ skills: [] }), null)).toBe(true);
    expect(shouldShowEmptySkillsNotice(resume({ skills: [] }), undefined)).toBe(true);
  });
});
