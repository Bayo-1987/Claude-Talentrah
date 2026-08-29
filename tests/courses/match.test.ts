import { describe, expect, it } from "vitest";
import { rankCourseRecommendations, parseJdMentions, type CourseRow } from "@/lib/courses/match";
import { normalizeSkillKeyword } from "@/lib/courses/normalize";
import { ALTSCHOOL_SEED } from "@/lib/courses/seed-catalog";
import { SKILL_VOCABULARY } from "@/lib/jobs/extract-jd";
import type { GapAnalysisItem } from "@/lib/tailoring/types";

/**
 * The matcher, tested against the shapes the tailoring flow actually produces.
 *
 * `gapAnalysis` is LLM output: `keyword` is freeform, `status` is one of two
 * values, and `note` is OPTIONAL and unconstrained — its schema in tailor.ts
 * only suggests a format by example. So the fixtures here deliberately include
 * notes that state a count, notes that do not, and items with no note at all,
 * because all three arrive in production.
 */

/** Catalog rows with ids, as the table would return them. */
const CATALOG: CourseRow[] = ALTSCHOOL_SEED.map((row, i) => ({ ...row, id: `seed-${i}` }));

function gap(
  keyword: string,
  status: GapAnalysisItem["status"] = "missing",
  note?: string,
): GapAnalysisItem {
  return { keyword, status, ...(note ? { note } : {}) };
}

describe("the seed catalog can actually be reached", () => {
  it("every seeded skill_tag is a term the normaliser can produce", () => {
    /*
     * The rule the seed file states, enforced rather than trusted. A row tagged
     * with something outside SKILL_VOCABULARY is unreachable: no keyword can
     * ever normalise to it, so it reads as coverage in the table and is dead
     * weight in practice. Two rows were written that way on the first pass —
     * "software engineering" and "cloud engineering" — and this is what would
     * have caught them.
     */
    const unreachable = CATALOG.map((c) => c.skill_tag).filter(
      (tag) => !(SKILL_VOCABULARY as readonly string[]).includes(tag),
    );
    expect(
      unreachable,
      `these skill_tags are not in SKILL_VOCABULARY, so nothing can match them: ${unreachable.join(", ")}`,
    ).toEqual([]);
  });

  it("every affiliate url is flagged as a placeholder", () => {
    // §10 item 1: real links are a founder action. If one of these stops
    // saying "placeholder", it should be because a real link replaced it —
    // deliberately, in a diff someone read.
    for (const course of CATALOG) {
      expect(course.affiliate_url).toMatch(/^https:\/\//);
      expect(course.affiliate_url, `${course.title} claims to be a real link`).toContain(
        "ref=talentrah-placeholder",
      );
    }
  });
});

describe("normalising a freeform keyword", () => {
  it("maps the variants an LLM actually emits", () => {
    expect(normalizeSkillKeyword("React.js")).toBe("react");
    expect(normalizeSkillKeyword("ReactJS")).toBe("react");
    expect(normalizeSkillKeyword("  SQL  ")).toBe("sql");
    expect(normalizeSkillKeyword("Node")).toBe("node.js");
    expect(normalizeSkillKeyword("JS")).toBe("javascript");
    expect(normalizeSkillKeyword("UX")).toBe("ui/ux");
    expect(normalizeSkillKeyword("Product Manager")).toBe("product management");
    expect(normalizeSkillKeyword("Advanced SQL queries")).toBe("sql");
    expect(normalizeSkillKeyword("senior nodejs engineer")).toBe("node.js");
  });

  it("prefers the most specific vocabulary term, not the first one that fits", () => {
    // "product management" and "management"-shaped terms both appear in a
    // phrase like this; longest-first is what makes the answer the specific one.
    expect(normalizeSkillKeyword("product management experience")).toBe("product management");
    expect(normalizeSkillKeyword("stakeholder management")).toBe("stakeholder management");
  });

  it("returns null rather than guessing", () => {
    for (const nothing of [
      "blockchain",
      "welding",
      "GDPR",
      "",
      "   ",
      null,
      undefined,
      "a strong work ethic",
    ]) {
      expect(normalizeSkillKeyword(nothing), `${nothing} should not match`).toBeNull();
    }
  });

  it("does not widen a match to an adjacent skill", () => {
    // Postgres is not SQL-the-course. Quietly widening is how a
    // recommendation stops being about what the JD asked for.
    // toBeNull, not `.not.toBe("sql")` — the weaker form would also pass if
    // this started returning some other wrong term.
    expect(normalizeSkillKeyword("PostgreSQL")).toBeNull();
  });
});

describe("parsing the JD mention count out of a freeform note", () => {
  it("reads the shapes the prompt's example produces", () => {
    expect(parseJdMentions("appears 3x in this JD, 0x in your resume")).toBe(3);
    expect(parseJdMentions("Appears 5 times in the JD")).toBe(5);
    expect(parseJdMentions("mentioned 2 times")).toBe(2);
    expect(parseJdMentions("7x in this JD")).toBe(7);
  });

  it("returns null when the note does not state a count", () => {
    // The common case, and the reason ranking needs a defined fallback: the
    // field is optional and its wording is not enforced anywhere.
    expect(parseJdMentions(undefined)).toBeNull();
    expect(parseJdMentions("")).toBeNull();
    expect(parseJdMentions("Not covered anywhere in your resume")).toBeNull();
    expect(parseJdMentions("The JD emphasises this heavily")).toBeNull();
  });
});

describe("ranking", () => {
  it("returns nothing when no keyword normalises to a seeded tag", () => {
    const result = rankCourseRecommendations(
      [gap("Blockchain"), gap("Welding"), gap("GDPR compliance frameworks")],
      CATALOG,
    );
    expect(result).toEqual([]);
  });

  it("ignores keywords the resume already covers", () => {
    const result = rankCourseRecommendations(
      [gap("SQL", "matched", "appears 9x in this JD"), gap("React", "matched")],
      CATALOG,
    );
    expect(result).toEqual([]);
  });

  it("ranks by how much the JD emphasised the gap", () => {
    const result = rankCourseRecommendations(
      [
        gap("Product Management", "missing", "appears 1x in this JD, 0x in your resume"),
        gap("SQL", "missing", "appears 6x in this JD, 0x in your resume"),
        gap("Figma", "missing", "appears 3x in this JD, 0x in your resume"),
      ],
      CATALOG,
      { limit: 3 },
    );
    expect(result.map((r) => r.skillTag)).toEqual(["sql", "product management"]);
    expect(result[0].jdMentions).toBe(6);
    // figma normalises fine but the catalog has no figma course — matching a
    // keyword is not the same as having something to recommend.
    expect(result.map((r) => r.skillTag)).not.toContain("figma");
  });

  it("caps at two by default, and honours a lower limit", () => {
    const many = [
      gap("SQL", "missing", "appears 9x in this JD"),
      gap("React", "missing", "appears 8x in this JD"),
      gap("Python", "missing", "appears 7x in this JD"),
      gap("UX", "missing", "appears 6x in this JD"),
    ];
    expect(rankCourseRecommendations(many, CATALOG)).toHaveLength(2);
    expect(rankCourseRecommendations(many, CATALOG, { limit: 1 })).toHaveLength(1);
    expect(rankCourseRecommendations(many, CATALOG, { limit: 0 })).toEqual([]);
  });

  it("a note with no count ranks BELOW one that states a low count", () => {
    /*
     * Unknown must not sort as zero and must not sort as infinity. A stated
     * "1x" is a measurement; a missing note is an absence of one, and the
     * measured gap is the better recommendation.
     */
    const result = rankCourseRecommendations(
      [gap("Python"), gap("SQL", "missing", "appears 1x in this JD")],
      CATALOG,
      { limit: 1 },
    );
    expect(result[0].skillTag).toBe("sql");
  });

  it("breaks ties by the gap analysis's own order, not the catalog's", () => {
    /*
     * THE TIE CASE, which is the common one rather than the rare one: `note`
     * is optional, so several missing keywords routinely carry no count at all.
     *
     * With everything tied, the answer must follow the order the model emitted
     * the keywords in — the JD's own sequence — and must NOT be "whichever row
     * the catalog happens to list first". Asserted by running the same tie
     * twice with the gap order reversed: if the catalog were deciding, both
     * runs would return the same course.
     *
     * What this does NOT prove, checked by sabotage rather than assumed:
     * deleting the explicit `index` tie-break leaves all 19 tests passing,
     * because sort is stable and input order survives anyway. Replacing the
     * comparator with one that orders by skill tag DOES fail here — which is
     * the failure mode that matters, an ordering that ignores the JD.
     */
    const forwards = rankCourseRecommendations([gap("Python"), gap("SQL")], CATALOG, { limit: 1 });
    const backwards = rankCourseRecommendations([gap("SQL"), gap("Python")], CATALOG, { limit: 1 });

    expect(forwards[0].skillTag).toBe("python");
    expect(backwards[0].skillTag).toBe("sql");
    expect(forwards[0].skillTag).not.toBe(backwards[0].skillTag);
  });

  it("offers the cheaper course when two teach the same skill", () => {
    /*
     * §6.9 tiers by affordability, so the tie-break within a skill is price
     * and not insertion order. Without this the answer would be whichever row
     * was seeded first, which is exactly the arbitrary behaviour the ordering
     * rules exist to remove.
     */
    const twoForSql: CourseRow[] = [
      {
        id: "expensive",
        skill_tag: "sql",
        provider: "altschool",
        title: "AltSchool SQL Intensive",
        affiliate_url: "https://example.org/a?ref=talentrah-placeholder",
        price_tier: "high",
      },
      {
        id: "cheap",
        skill_tag: "sql",
        provider: "altschool",
        title: "AltSchool SQL Foundations",
        affiliate_url: "https://example.org/b?ref=talentrah-placeholder",
        price_tier: "free",
      },
    ];
    // Seeded expensive-first on purpose: first-row-wins would pick the wrong one.
    const result = rankCourseRecommendations([gap("SQL")], twoForSql, { limit: 1 });
    expect(result[0].course.id).toBe("cheap");
  });

  it("never returns the same skill twice, even from several keywords", () => {
    const result = rankCourseRecommendations(
      [
        gap("React.js", "missing", "appears 4x in this JD"),
        gap("ReactJS", "missing", "appears 4x in this JD"),
        gap("react", "missing", "appears 4x in this JD"),
      ],
      CATALOG,
      { limit: 2 },
    );
    expect(result).toHaveLength(1);
    expect(result[0].skillTag).toBe("react");
  });

  it("skips inactive rows", () => {
    const retired = CATALOG.map((c) =>
      c.skill_tag === "sql" ? { ...c, active: false } : c,
    );
    const result = rankCourseRecommendations([gap("SQL")], retired, { limit: 2 });
    expect(result).toEqual([]);
  });

  it("echoes the keyword verbatim so the UI can name what it matched", () => {
    const result = rankCourseRecommendations(
      [gap("React.js", "missing", "appears 4x in this JD")],
      CATALOG,
      { limit: 1 },
    );
    expect(result[0].matchedKeyword).toBe("React.js");
    expect(result[0].skillTag).toBe("react");
    expect(result[0].course.provider).toBe("altschool");
  });

  it("handles an empty gap analysis and an empty catalog", () => {
    expect(rankCourseRecommendations([], CATALOG)).toEqual([]);
    expect(rankCourseRecommendations([gap("SQL")], [])).toEqual([]);
  });
});
