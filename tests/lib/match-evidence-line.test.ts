/**
 * The one line under a low applicant score: what the score was built from, as COUNTS the row already carries (the explanation), so an employer reading "5%" is not left to guess.
 * Pure: no database, no query, nothing written. Shown only below the display floor (60), the same floor getDisplayMatchTier uses, so it can never appear next to a tier word; and only for a set of
 * 3 tags or more, because for a THIN set (2 or fewer) the Skill coverage cell already says why in words. Never a percent string (tests/lib/match-confidence-enforcement.test.ts), never a skill name, never
 * anything from the verification marks.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MATCH_EVIDENCE_NOUN, THIN_SCREENABLE_TAG_MAX, evidenceCountText, getDisplayMatchTier, isThinScreenableTagSet, matchEvidenceLine } from "@/lib/match-tier";
import { explanationOf } from "../support/applicant-evidence-rows";

const N = MATCH_EVIDENCE_NOUN;
const noun = (total: number) => `${N}${total === 1 ? "" : "s"}`;
const read = (path: string) => readFileSync(join(__dirname, "../..", path), "utf8");
/** An explanation with `matched` matched out of `total` tags. */
const of = (matched: number, total: number) => explanationOf(matched, total - matched);

describe("matchEvidenceLine: the wording (3 tags or more)", () => {
  it("counts the same noun the page's own Skill coverage cell uses: 'tag' (one term per concept; swap it in the one constant)", () => {
    expect(MATCH_EVIDENCE_NOUN).toBe("tag");
    expect(read("src/components/jobs/match-breakdown.tsx")).toContain('tag${total === 1 ? "" : "s"}');
  });

  it.each([
    [0, 3],
    [2, 5],
    [1, 20],
    [3, 3],
    [0, 7],
  ])("%i matched of %i reads '%i of %i tags matched'", (matched, total) => {
    expect(matchEvidenceLine(5, of(matched, total))).toBe(`${matched} of ${total} ${noun(total)} matched`);
  });

  it("the counts come from matched and missing together: 2 matched + 3 missing is '2 of 5'", () => {
    expect(matchEvidenceLine(40, explanationOf(2, 3))).toBe("2 of 5 tags matched");
  });
});

describe("evidenceCountText: the singular and plural rule, on its own", () => {
  // matchEvidenceLine never reaches a total of 1 (that is a thin set), so the singular is pinned here, on the helper it calls.
  it.each([
    [1, 1, "1 of 1 tag matched"],
    [0, 1, "0 of 1 tag matched"],
    [0, 3, "0 of 3 tags matched"],
    [2, 5, "2 of 5 tags matched"],
    [1, 2, "1 of 2 tags matched"],
  ])("%i of %i reads %j", (matched, total, text) => {
    expect(evidenceCountText(matched, total)).toBe(text);
  });
});

describe("matchEvidenceLine: only below 60, at exactly the display floor", () => {
  it("59 shows the line; 60 and above show nothing", () => {
    expect(matchEvidenceLine(59, of(1, 5))).toBe("1 of 5 tags matched");
    expect(matchEvidenceLine(60, of(1, 5))).toBeNull();
    expect(matchEvidenceLine(61, of(1, 5))).toBeNull();
    expect(matchEvidenceLine(79, of(1, 5))).toBeNull();
    expect(matchEvidenceLine(100, of(1, 5))).toBeNull();
  });
  it("0 and 5 show the line", () => {
    expect(matchEvidenceLine(0, of(0, 3))).toBe("0 of 3 tags matched");
    expect(matchEvidenceLine(5, of(0, 3))).toBe("0 of 3 tags matched");
  });
  it("uses the same floor as the tier word: the line appears exactly when there is no tier", () => {
    for (let score = 0; score <= 100; score += 1) {
      expect(matchEvidenceLine(score, of(1, 3)) !== null, `score ${score}`).toBe(getDisplayMatchTier(score) === null);
    }
  });
});

describe("matchEvidenceLine: a THIN set (2 tags or fewer) gets no line", () => {
  it("0, 1 and 2 tags show nothing at any low score, whatever matched (the Skill coverage cell already says why)", () => {
    for (const score of [0, 5, 30, 59]) {
      expect(matchEvidenceLine(score, of(0, 0)), `${score}: no tags at all (never '0 of 0')`).toBeNull();
      expect(matchEvidenceLine(score, of(0, 1)), `${score}: 0 of 1`).toBeNull();
      expect(matchEvidenceLine(score, of(1, 1)), `${score}: 1 of 1`).toBeNull();
      expect(matchEvidenceLine(score, of(0, 2)), `${score}: 0 of 2`).toBeNull();
      expect(matchEvidenceLine(score, of(1, 2)), `${score}: 1 of 2`).toBeNull();
      expect(matchEvidenceLine(score, of(2, 2)), `${score}: 2 of 2`).toBeNull();
    }
  });
  it("3 tags is the first size that shows the line", () => {
    expect(matchEvidenceLine(5, of(0, 3))).toBe("0 of 3 tags matched");
    expect(matchEvidenceLine(5, of(3, 3))).toBe("3 of 3 tags matched");
  });
  it("THE THIN RULE IS THE SAME HELPER THE SKILL COVERAGE CELL USES, with no second threshold: for every size, the line is missing exactly when isThinScreenableTagSet says thin", () => {
    expect(THIN_SCREENABLE_TAG_MAX).toBe(2);
    for (let total = 0; total <= 12; total += 1) {
      expect(matchEvidenceLine(5, of(0, total)) === null, `${total} tags`).toBe(isThinScreenableTagSet(total));
    }
    const fn = read("src/lib/match-tier.ts");
    const body = fn.slice(fn.indexOf("export function matchEvidenceLine"));
    expect(body).toContain("isThinScreenableTagSet(total)");
    expect(body, "no numeric threshold of its own inside the function").not.toMatch(/total\s*(<=|<|>=|>|===)\s*\d/);
    expect(read("src/components/jobs/match-breakdown.tsx")).toContain("isThinScreenableTagSet(total)");
  });
});

describe("matchEvidenceLine: nothing honest to say means nothing", () => {
  it("a null, missing or malformed explanation gives null, never a throw", () => {
    for (const bad of [null, undefined, {}, [], "x", 7, { matchedSkills: "a", missingSkills: [] }, { matchedSkills: [], missingSkills: "b" }, { matchedSkills: null, missingSkills: null }, { matchedSkills: ["a"] }, { missingSkills: ["a"] }]) {
      expect(() => matchEvidenceLine(5, bad), JSON.stringify(bad)).not.toThrow();
      expect(matchEvidenceLine(5, bad), JSON.stringify(bad)).toBeNull();
    }
  });
  it("a null or not-a-number score gives null", () => {
    expect(matchEvidenceLine(null, of(1, 3))).toBeNull();
    expect(matchEvidenceLine(Number.NaN, of(1, 3))).toBeNull();
  });
});

describe("matchEvidenceLine: what it may and may not print", () => {
  it("counts only: no percent sign, no skill name, nothing but two numbers and the fixed words", () => {
    const line = matchEvidenceLine(5, { matchedSkills: ["SECRET-SKILL"], missingSkills: ["figma", "sql"], seniorityAlignment: "match" })!;
    expect(line).toBe("1 of 3 tags matched");
    expect(line).not.toContain("%");
    expect(line).not.toMatch(/secret|figma|sql/i);
    expect(line.replace(/\d+/g, "N")).toBe(`N of N ${noun(3)} matched`);
  });
  it("is pure: it does not import or call any database client", () => {
    const source = read("src/lib/match-tier.ts");
    expect(source).not.toMatch(/supabase|createClient|createServiceRoleClient|fetch\(/);
    expect(matchEvidenceLine.length).toBe(2);
  });
});

describe("the doc comment stays on the function it describes", () => {
  it("matchEvidenceLine's doc block sits directly above it (no other declaration in between)", () => {
    const source = read("src/lib/match-tier.ts");
    const at = source.indexOf("export function matchEvidenceLine");
    const before = source.slice(0, at);
    const docStart = before.lastIndexOf("/**");
    expect(before.slice(docStart)).toContain("SCORE-EXPLANATION-LINE-1");
    expect(before.slice(docStart).replace(/\/\*\*[\s\S]*?\*\/\s*$/, "")).toBe("");
  });
});
