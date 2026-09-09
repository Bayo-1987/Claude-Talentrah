/**
 * Farah's per-job button — the parts that must stay honest.
 *
 * send-100 collapsed the old Vet/Land disclosure menu into a single "Ask
 * Farah" button that seeds the docked panel (see farah-job-menu.tsx's own
 * header for the full history). Two claims survive that change and are
 * still worth pinning here, because both could regress invisibly:
 *
 *   1. The free Vet reads (`fitSummary`/`gapSkills`) are still pure,
 *      still cost nothing, and still never restate the match-tier system —
 *      they didn't move when the menu did; send-100's job-seeded chat
 *      grounding (buildJobContext, src/lib/farah/token-budget.ts) calls
 *      them directly rather than re-deriving the same read, so a regression
 *      here would now also corrupt what Farah is told about the job.
 *   2. The seeded panel's two generation links (`tailorHref`/
 *      `coverLetterHref`, src/lib/farah/job-seed.ts — the direct successors
 *      of this menu's old Land group) still go to DIFFERENT places.
 *      Without `coverLetter=1` they resolve to an identical page in an
 *      identical state, the same dead-duplicate problem that got "Gap
 *      analysis" rewritten instead of linked, originally.
 *
 * What's NEW here: the button itself. It used to say "Check this job" and
 * open a dropdown specifically because it had no chat to open — that
 * constraint is gone, so `expect(markup).not.toContain("Ask Farah")` (this
 * file's own prior assertion) is deliberately INVERTED below, not silently
 * dropped: the whole point of send-100 is that this button now says "Ask
 * Farah" and means it.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { fitSummary, gapSkills } from "@/lib/matching/vet-summary";
import { FarahJobMenu } from "@/components/jobs/farah-job-menu";
import { TailorForm } from "@/components/tailoring/tailor-form";
import { coverLetterHref, tailorHref } from "@/lib/farah/job-seed";
import type { MatchExplanation } from "@/lib/matching/score";

const explanation = (over: Partial<MatchExplanation> = {}): MatchExplanation => ({
  matchedSkills: [],
  missingSkills: [],
  seniorityAlignment: "unknown",
  ...over,
});

describe("the fit sentence never restates match quality", () => {
  /*
   * CLAUDE.md: "Match-tier wording must agree across every screen
   * (Excellent/Good/Fair — no 'a good match' prose bypassing the system)."
   *
   * The first version of this asserted only that the LABELS were absent, and
   * passed while the code returned the literal phrase the rule names. The rule
   * is about the PHRASE — a paraphrased tier is the fourth tier arriving by the
   * back door — so both are checked now.
   */
  const FORBIDDEN = [
    "Excellent",
    "Good",
    "Fair",
    "a good match",
    "a strong match",
    "a fair match",
    "a weak match",
    "match quality",
  ];

  it("carries neither a tier label nor a tier paraphrase, for any input", () => {
    const cases: MatchExplanation[] = [
      explanation(),
      explanation({ seniorityAlignment: "match", matchedSkills: ["sql"] }),
      explanation({ seniorityAlignment: "above", missingSkills: ["dbt"] }),
      explanation({ seniorityAlignment: "below", matchedSkills: ["a", "b"] }),
    ];
    for (const e of cases) {
      const text = fitSummary(e);
      for (const phrase of FORBIDDEN) {
        expect(text, `"${phrase}" restated next to the badge that already says it`).not.toContain(
          phrase,
        );
      }
    }
  });

  it("takes no score at all, so match quality cannot leak back in", () => {
    // Structural, not cosmetic: with no score in scope the band cannot be
    // reintroduced without changing the signature, which is a visible edit.
    expect(fitSummary.length).toBe(1);
  });
});

describe("the fit sentence describes the stored data and nothing else", () => {
  it("reports how many named skills already match", () => {
    expect(fitSummary(explanation({ matchedSkills: ["sql", "dbt"] }))).toContain(
      "You already match 2 of the skills it names",
    );
  });

  it("says so plainly when none match, rather than staying silent", () => {
    expect(fitSummary(explanation())).toContain(
      "None of the skills it names are on your resume yet",
    );
  });

  it("covers every seniority value, including unknown", () => {
    const reads = (["match", "above", "below", "unknown"] as const).map((a) =>
      fitSummary(explanation({ seniorityAlignment: a })),
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
    // An empty "Gap analysis" reads as broken rather than as good news, so
    // buildJobContext (which reads this the same way) says something
    // different instead of telling Farah there is nothing missing.
    expect(gapSkills(explanation())).toBeNull();
  });
});

describe("the per-job button, post send-100", () => {
  const markup = renderToStaticMarkup(
    <FarahJobMenu jobId="job-1" jobTitle="Backend Engineer" companyName="Flutterwave" />,
  );

  it("is a single button that says what it now actually does", () => {
    // Inverted deliberately — see this file's own header. "Check this job"
    // and the dropdown it opened are gone with the menu.
    expect(markup).toContain("Ask Farah");
    expect(markup).not.toContain("Check this job");
  });

  it("renders no dropdown, no caret, no Vet/Land grouping", () => {
    expect(markup).not.toContain("aria-expanded");
    expect(markup).not.toContain("aria-haspopup");
    expect(markup).not.toContain("Gap analysis");
    expect(markup).not.toContain("Tailor my resume");
    expect(markup).not.toContain("▾");
  });

  it("is a single <button>, not an anchor or a menu wrapper", () => {
    expect(markup.match(/<button/g)?.length).toBe(1);
    expect(markup).not.toContain("<a ");
  });
});

describe("the seeded panel's two generation links do not resolve to the same page state", () => {
  /*
   * "Tailor my resume for this job" and "Draft an intro message for this
   * job" (the seeded panel's direct successors of the old menu's Land
   * group) both go to /tailor. The only thing making them different actions
   * is `coverLetter=1` pre-ticking the cover-letter box — without it the
   * second item is decoration, exactly why "Gap analysis" was rewritten to
   * read stored data instead of becoming a third link to the same place,
   * back when this lived in the menu.
   */
  it("tailorHref and coverLetterHref carry the same jobId but differ only by the cover-letter flag", () => {
    expect(tailorHref("job-1")).toBe("/tailor?jobId=job-1");
    expect(coverLetterHref("job-1")).toBe("/tailor?jobId=job-1&coverLetter=1");
  });

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
