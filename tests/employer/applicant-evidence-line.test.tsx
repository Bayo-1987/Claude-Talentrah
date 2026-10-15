/**
 * SCORE-EXPLANATION-LINE-1 on the employer applicants list: under a match score below 60, one line says what the score was built from (`0 of 3 ${noun(3)} matched`), from the explanation the row already carries.
 * Everything else renders BYTE-FOR-BYTE as it did before the line existed (tests/fixtures/applicant-list-markup-before-evidence-line.json is that markup, captured from the code before this change).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// If anything on this path reached for the database it would throw here.
const touched = vi.hoisted(() => [] as string[]);
const trap = (name: string) => new Proxy({}, { get: () => () => { touched.push(name); throw new Error(`${name} must not be used by the evidence line`); } });
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => trap("supabase server client") }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => trap("service role client") }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

import { ApplicantList, type ApplicantRow } from "@/components/employer/applicant-list";
import { MATCH_EVIDENCE_NOUN, isThinScreenableTagSet, matchEvidenceLine } from "@/lib/match-tier";
import { MatchBreakdown } from "@/components/jobs/match-breakdown";
import { EVIDENCE_CASES, evidenceRow, explanationOf } from "../support/applicant-evidence-rows";

const noun = (total: number) => `${MATCH_EVIDENCE_NOUN}${total === 1 ? "" : "s"}`;

const render = (score: number | null, explanation: unknown) =>
  renderToStaticMarkup(<ApplicantList jobId="j1" applicants={[evidenceRow(score, explanation) as ApplicantRow]} hasScreeningQuestions={false} hasAssessment={false} />);
const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("the line is shown under a score below 60, for 3 tags or more", () => {
  it("5% with 0 of 3 matched says so, next to the score", () => {
    const html = decode(render(5, explanationOf(0, 3)));
    expect(html).toContain("5%");
    expect(html).toContain(`0 of 3 ${noun(3)} matched`);
    expect(html.indexOf("5%")).toBeLessThan(html.indexOf(`0 of 3 ${noun(3)} matched`));
  });
  it("boundary: 59 shows the line, 60 does not", () => {
    expect(render(59, explanationOf(1, 4))).toContain(`1 of 5 ${noun(5)} matched`);
    expect(render(60, explanationOf(1, 4))).not.toContain("tags matched");
    expect(render(60, explanationOf(1, 4))).not.toContain("tag matched");
  });
  it("3 tags is the first size that shows it; plural counts read right", () => {
    expect(render(30, explanationOf(0, 3))).toContain(`0 of 3 ${noun(3)} matched`);
    expect(render(30, explanationOf(2, 3))).toContain(`2 of 5 ${noun(5)} matched`);
    // The singular ("1 of 1 tag matched") is unreachable here (a single tag is a thin set); the rule is tested on evidenceCountText in tests/lib/match-evidence-line.test.ts.
  });
});

describe("a thin set (1 or 2 tags) at a low score: no line, and the markup is the old one", () => {
  const thinCases = Object.keys(EVIDENCE_CASES).filter((name) => name.includes("thin set"));
  it("the fixture has the thin cases (not a vacuous loop)", () => {
    expect(thinCases.length).toBeGreaterThanOrEqual(4);
  });
  for (const name of thinCases) {
    it(`${name}: no new line, byte-for-byte the old markup`, () => {
      const c = EVIDENCE_CASES[name];
      const html = render(c.score, c.explanation);
      expect(html).not.toContain("tags matched");
      expect(html).not.toContain("tag matched");
      expect(html).toBe(JSON.parse(readFileSync(join(__dirname, "../fixtures/applicant-list-markup-before-evidence-line.json"), "utf8"))[name]);
    });
  }
  it("the new line and the Skill coverage cell's own explanation never both appear: the line is missing exactly where the cell says it in words", () => {
    for (let total = 0; total <= 6; total += 1) {
      const cell = renderToStaticMarkup(<MatchBreakdown explanation={explanationOf(0, total)} perspective="employer" />);
      const cellExplainsInWords = /thin —|no screenable skills listed/.test(cell);
      expect(cellExplainsInWords, `${total} tags: the cell's sub-line`).toBe(isThinScreenableTagSet(total));
      expect(matchEvidenceLine(5, explanationOf(0, total)) === null, `${total} tags: the line`).toBe(cellExplainsInWords);
    }
  });
});

describe("rendered exactly as before when there is nothing to add", () => {
  const before = JSON.parse(readFileSync(join(__dirname, "../fixtures/applicant-list-markup-before-evidence-line.json"), "utf8")) as Record<string, string>;
  it("the fixture has every case (not a vacuous loop)", () => {
    expect(Object.keys(before).sort()).toEqual(Object.keys(EVIDENCE_CASES).sort());
    expect(Object.values(before).every((markup) => markup.length > 1000)).toBe(true);
  });
  for (const [name, c] of Object.entries(EVIDENCE_CASES)) {
    it(`${name}: byte-for-byte the old markup`, () => {
      expect(render(c.score, c.explanation)).toBe(before[name]);
    });
  }
  it("a job with no listed tags at a low score gets no new line (never '0 of 0 tags matched'): the markup is the old one", () => {
    const html = render(5, explanationOf(0, 0));
    expect(html).not.toContain("tags matched");
    expect(html).not.toContain("tag matched");
    expect(html).toBe(before["score 5 on a job with no listed skills"]);
    // Not ours: the existing Skill coverage cell (MatchBreakdown) already prints "0 of 0 tags" with its own "no screenable skills listed" note for such a row; it is unchanged.
    expect(html).toContain("no screenable skills listed");
  });
  it("no explanation (null, or absent) does not crash and adds nothing: the markup is the old one", () => {
    for (const none of [null, undefined]) {
      expect(() => render(5, none)).not.toThrow();
      expect(render(5, none)).toBe(before["score 5 with NO explanation (null)"]);
    }
  });
});

describe("the line is readable and carries nothing else", () => {
  const html = decode(render(5, explanationOf(0, 3)));
  const line = /<(\w+)([^>]*)>0 of 3 tags matched<\/\1>/.exec(html);
  it("is a real text element: not hidden from assistive technology, not screen-reader-only, not a title-only tooltip", () => {
    expect(line, "the line is its own text element").not.toBeNull();
    expect(line![2]).not.toMatch(/aria-hidden|sr-only|hidden|title=/);
  });
  it("has the same text colour as the page's other secondary text (text-ink-soft), with no opacity that would lower the contrast, and is not smaller than 11.5px", () => {
    expect(line![2]).toContain("text-ink-soft");
    expect(line![2]).not.toMatch(/opacity|\/\d\d/);
    const size = /text-\[(\d+(?:\.\d+)?)px\]/.exec(line![2]);
    expect(size, "an explicit text size").not.toBeNull();
    expect(Number(size![1])).toBeGreaterThanOrEqual(11.5);
  });
  it("shows no contact detail, no skills-check percentage and no verification wording", () => {
    const row = { ...evidenceRow(5, { matchedSkills: ["secret-tag"], missingSkills: ["x", "y"], seniorityAlignment: "match" }), resumeReview: "human", resumeReviewedAt: "2026-01-01T00:00:00Z" };
    const out = decode(renderToStaticMarkup(<ApplicantList jobId="j1" applicants={[row as ApplicantRow]} hasScreeningQuestions={false} hasAssessment={false} />));
    const text = /<(\w+)[^>]*>(1 of 3 tags matched)<\/\1>/.exec(out);
    expect(text).not.toBeNull();
    expect(text![2]).not.toMatch(/@|%|score|verified|review/i);
  });
});

describe("no database is touched", () => {
  it("rendering every case reaches no supabase client", () => {
    for (const c of Object.values(EVIDENCE_CASES)) render(c.score, c.explanation);
    expect(touched).toEqual([]);
  });
});
