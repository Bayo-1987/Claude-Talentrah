/**
 * Farah's per-job menu — the parts that must stay honest.
 *
 * The menu replaced a single "Ask Farah" link that went to /tailor. Three
 * claims are worth pinning, because all three could regress invisibly:
 *
 *   1. Vet costs nothing. Both items read match_scores.explanation, which is
 *      computed algorithmically for the score already on the card. If someone
 *      later routes them through a model call, Vet silently starts costing
 *      credits on a free surface.
 *   2. The score bands agree with the tier system. CLAUDE.md fixes three tiers
 *      and forbids a fourth; prose that drifts from 80/70/60 would be a fourth
 *      tier in words.
 *   3. Land's two items go to DIFFERENT places. Without `coverLetter=1` they
 *      resolve to an identical page in an identical state, which is the
 *      dead-duplicate problem that got Gap analysis rewritten instead of
 *      linked.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { fitSummary, gapSkills, scoreBand } from "@/lib/matching/vet-summary";
import { FarahJobMenu } from "@/components/jobs/farah-job-menu";
import { TailorForm } from "@/components/tailoring/tailor-form";
import type { MatchExplanation } from "@/lib/matching/score";

const explanation = (over: Partial<MatchExplanation> = {}): MatchExplanation => ({
  matchedSkills: [],
  missingSkills: [],
  seniorityAlignment: "unknown",
  ...over,
});

describe("the score bands agree with the three-tier system", () => {
  it("changes wording exactly at 80, 70 and 60", () => {
    expect(scoreBand(80)).toBe("a strong match");
    expect(scoreBand(79)).toBe("a good match");
    expect(scoreBand(70)).toBe("a good match");
    expect(scoreBand(69)).toBe("a fair match");
    expect(scoreBand(60)).toBe("a fair match");
    expect(scoreBand(59)).toBe("a weak match");
  });

  it("never repeats a tier LABEL — the card already shows one two inches away", () => {
    for (const s of [95, 75, 65, 30]) {
      const text = fitSummary(s, explanation());
      for (const label of ["Excellent", "Good", "Fair"]) {
        expect(text, `"${label}" restated in prose next to the badge`).not.toContain(label);
      }
    }
  });
});

describe("the fit sentence describes the stored data and nothing else", () => {
  it("reports how many named skills already match", () => {
    expect(fitSummary(90, explanation({ matchedSkills: ["sql", "dbt"] }))).toContain(
      "You already match 2 of the skills it names",
    );
  });

  it("says so plainly when none match, rather than staying silent", () => {
    expect(fitSummary(65, explanation())).toContain(
      "None of the skills it names are on your resume yet",
    );
  });

  it("covers every seniority value, including unknown", () => {
    const reads = (["match", "above", "below", "unknown"] as const).map((a) =>
      fitSummary(80, explanation({ seniorityAlignment: a })),
    );
    // Four distinct readings — an unhandled value silently collapsing into
    // another one's wording would misdescribe the job to the user.
    expect(new Set(reads).size).toBe(4);
    expect(reads[3]).toContain("isn't clear from the posting");
  });
});

describe("gap analysis", () => {
  it("returns the missing skills when there are any", () => {
    expect(gapSkills(explanation({ missingSkills: ["compliance", "logistics"] }))).toEqual([
      "compliance",
      "logistics",
    ]);
  });

  it("returns null rather than an empty list", () => {
    // An empty "Gap analysis" reads as broken rather than as good news, so the
    // component says something different instead of rendering nothing.
    expect(gapSkills(explanation())).toBeNull();
  });
});

describe("what the card renders before the menu is opened", () => {
  const markup = renderToStaticMarkup(
    <FarahJobMenu
      jobId="job-1"
      jobTitle="Senior Product Manager"
      score={92}
      explanation={explanation({ missingSkills: ["compliance"] })}
    />,
  );

  it("shows the disclosure trigger, closed", () => {
    expect(markup).toContain("Ask Farah");
    expect(markup).toContain('aria-expanded="false"');
  });

  it("does not leak the menu's contents into the closed markup", () => {
    // Rendered-but-hidden would ship the Vet answers to every card on every
    // feed load, which is a payload cost on a connection the audience pays for
    // by the megabyte.
    expect(markup).not.toContain("Gap analysis");
    expect(markup).not.toContain("Tailor my resume");
  });
});

describe("Land's two items do not resolve to the same page state", () => {
  /*
   * "Tailor my resume" and "Draft intro message" both go to /tailor. The only
   * thing making them different actions is `coverLetter=1` pre-ticking the
   * cover-letter box — without it the second item is decoration, which is
   * exactly why Gap analysis was rewritten to read stored data instead of
   * becoming a third link to the same place.
   */
  it("the cover-letter box is OFF by default", () => {
    const markup = renderToStaticMarkup(<TailorForm initialJdText="" />);
    const box = /<input[^>]*type="checkbox"[^>]*>/.exec(markup)?.[0] ?? "";
    expect(box, "no checkbox rendered — the assertion below would be vacuous").not.toBe("");
    expect(box).not.toContain("checked");
  });

  it("and ON when the link carries coverLetter=1", () => {
    const markup = renderToStaticMarkup(<TailorForm initialJdText="" defaultCoverLetter />);
    const box = /<input[^>]*type="checkbox"[^>]*>/.exec(markup)?.[0] ?? "";
    expect(box, "coverLetter=1 did not reach the checkbox").toContain("checked");
  });
});
