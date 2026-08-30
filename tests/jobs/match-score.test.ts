/**
 * The algorithmic match score, and the terms it refuses to score on.
 *
 * ── THE DEFECT THIS EXISTS FOR ────────────────────────────────────────────
 *
 * `communication`, `operations` and `leadership` are in SKILL_VOCABULARY, so
 * ingestion tagged them onto most of the board — 57%, 42% and 36% of the 155
 * open postings on production. Resumes never list them, because a resume's
 * skills array is where tools and disciplines go. Across all 642 rows of
 * match_scores they had matched exactly zero times, while `sql` had matched
 * 119 times and `agile` 25.
 *
 * They were still in the denominator. A posting asking for six things, three
 * of them these, capped a perfectly qualified candidate at 50%. The visible
 * symptom was that NO USER HAD A SINGLE EXCELLENT MATCH, anywhere, ever — and
 * Auto-Apply is Excellent-only, so the whole feature could not fire for
 * anybody.
 *
 * The tests below pin the mechanism rather than any particular score, so they
 * still mean something when the weighting is tuned.
 */
import { describe, expect, it } from "vitest";
import { computeMatchScore } from "@/lib/matching/score";
import { NON_SCREENABLE_SKILLS, SKILL_VOCABULARY } from "@/lib/jobs/extract-jd";
import type { StructuredResume } from "@/lib/resume/types";

function resumeWith(skills: string[], title = "Product Manager"): StructuredResume {
  return { skills, experience: [{ title }] } as unknown as StructuredResume;
}

describe("non-screenable skills", () => {
  /*
   * The guard that keeps the set honest. NON_SCREENABLE_SKILLS is defended in
   * its own comment as "a subset of a list that is already hand-maintained,
   * not a new taxonomy" — which is only true while this passes. A typo here
   * would silently exclude nothing, and the scores would quietly regress to
   * the behaviour above.
   */
  it("only ever contains terms the vocabulary can actually produce", () => {
    for (const skill of NON_SCREENABLE_SKILLS) {
      expect(SKILL_VOCABULARY, `"${skill}" is excluded from scoring but no ingestion path emits it`)
        .toContain(skill);
    }
  });

  it("leaves the denominator to the skills a resume can be screened against", () => {
    const resume = resumeWith(["sql", "figma"]);

    // Three screenable requirements, two met, plus two the candidate cannot
    // put on a resume at all. Coverage is 2/2, not 2/4.
    const scored = computeMatchScore(
      resume,
      ["sql", "figma", "communication", "leadership"],
      undefined,
    );

    expect(scored.score).toBe(100);
    expect(scored.explanation.matchedSkills).toEqual(["sql", "figma"]);
    expect(scored.explanation.missingSkills).toEqual([]);
  });

  it("would score the same posting at 50 if they counted — the regression to catch", () => {
    /*
     * The same inputs under the old arithmetic, written out rather than
     * imported, so this fails loudly if the filter is ever removed: two of
     * four requirements met is 50, and 50 is below every tier the product
     * names. This is the number production was actually returning.
     */
    const scored = computeMatchScore(
      resumeWith(["sql", "figma"]),
      ["sql", "figma", "communication", "leadership"],
      undefined,
    );
    expect(scored.score).not.toBe(50);
  });

  it("never reports one as a gap, because no resume has a field for it", () => {
    // gapSkills() renders missingSkills to the user as advice. "You are
    // missing communication" is advice nobody can act on.
    const scored = computeMatchScore(resumeWith(["sql"]), ["sql", "communication"], undefined);
    expect(scored.explanation.missingSkills).not.toContain("communication");
  });

  it("scores a posting that names nothing else as unknown, not as a mismatch", () => {
    /*
     * 50 is this function's existing "no listed requirements to compare
     * against" value. A posting tagged only with traits tested nothing, so it
     * gets that rather than 0 — scoring it 0 would assert a mismatch that was
     * never measured.
     */
    const scored = computeMatchScore(
      resumeWith(["sql"]),
      ["communication", "leadership", "operations"],
      undefined,
    );
    expect(scored.score).toBe(50);
    expect(scored.explanation.missingSkills).toEqual([]);
  });

  it("still penalises a genuine gap in a screenable skill", () => {
    // The fix must not turn into "everything matches". One of two real
    // requirements met is still half.
    const scored = computeMatchScore(
      resumeWith(["sql"]),
      ["sql", "kubernetes", "communication"],
      undefined,
    );
    expect(scored.score).toBe(50);
    expect(scored.explanation.missingSkills).toEqual(["kubernetes"]);
  });
});

describe("the parts the fix must not have changed", () => {
  it("still has no listed requirements case", () => {
    expect(computeMatchScore(resumeWith(["sql"]), [], undefined).score).toBe(50);
  });

  it("still adjusts for seniority", () => {
    const jobSkills = ["sql"];
    const exact = computeMatchScore(resumeWith(["sql"], "Product Manager"), jobSkills, "mid");
    const distant = computeMatchScore(resumeWith(["sql"], "Product Manager"), jobSkills, "executive");
    expect(exact.score).toBeGreaterThan(distant.score);
    expect(exact.explanation.seniorityAlignment).toBe("match");
  });

  it("still compares case-insensitively", () => {
    const scored = computeMatchScore(resumeWith(["SQL", "Figma"]), ["sql", "figma"], undefined);
    expect(scored.score).toBe(100);
  });
});
