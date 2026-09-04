/**
 * The feed's skill facet.
 *
 * The facet is derived, not curated: every value comes from
 * `structured_jd.skills`, which the ingest pipeline already parses for match
 * scoring. Measured against the 150 open postings in production before any of
 * this was written — 145 carry a non-empty array, 42 distinct values, all
 * lowercase, spread across every source (greenhouse 124, workable 19,
 * internal 2).
 *
 * Two properties are load-bearing and would break quietly:
 *
 *   1. Counts are taken BEFORE the skill filter is applied. Count after and
 *      the facet empties out the moment anyone uses it, which looks like a
 *      broken filter rather than a design mistake.
 *   2. A posting naming the same skill twice counts once. A sloppy parse would
 *      otherwise inflate the number shown next to the chip, and the number is
 *      the whole reason the chip is honest.
 */
import { describe, expect, it } from "vitest";
import {
  computeSkillFacet,
  filterBySkill,
  skillsOf,
  SKILL_FACET_SIZE,
  SKILL_FACET_MAX_SHARE,
} from "@/lib/jobs/skill-facet";
import type { Tables } from "@/lib/supabase/types";

type JobPosting = Tables<"job_postings">;

function job(id: string, skills: unknown): JobPosting {
  return { id, structured_jd: skills === undefined ? {} : { skills } } as unknown as JobPosting;
}

/**
 * Filler postings carrying no skills.
 *
 * Needed because the facet suppresses anything over SKILL_FACET_MAX_SHARE of
 * the board: on a four-posting fixture every skill is over 30% and the facet is
 * empty, which would make these assertions vacuous rather than wrong. Padding
 * to a realistic board size is what lets each test exercise the property it
 * names. Worth stating, because "the test fixture was too small to be legal"
 * is a failure mode that looks like a broken implementation.
 */
function filler(n: number): JobPosting[] {
  return Array.from({ length: n }, (_, i) => job(`filler-${i}`, []));
}

describe("reading skills off a posting", () => {
  it("lowercases, so a chip matches whatever casing a source used", () => {
    expect(skillsOf(job("a", ["SQL", "Python"]))).toEqual(["sql", "python"]);
  });

  it("tolerates the postings that have no skills array at all", () => {
    // 5 of 150 in production. They must not throw and must not appear.
    expect(skillsOf(job("a", undefined))).toEqual([]);
    expect(skillsOf(job("b", null))).toEqual([]);
    expect(skillsOf(job("c", "sql"))).toEqual([]);
  });

  it("drops non-string entries rather than rendering them", () => {
    expect(skillsOf(job("a", ["sql", 42, null, "python"]))).toEqual(["sql", "python"]);
  });
});

describe("counting", () => {
  it("counts postings, not mentions", () => {
    // The number beside a chip promises "this many jobs", so a posting that
    // names a skill twice must not count twice.
    const facet = computeSkillFacet([
      job("a", ["sql", "sql", "SQL"]),
      job("b", ["sql"]),
      ...filler(8), // 2 of 10 = 20%, under the share ceiling
    ]);
    expect(facet).toEqual([{ skill: "sql", count: 2 }]);
  });

  it("orders by count, then alphabetically for a stable render", () => {
    const facet = computeSkillFacet([
      job("a", ["python", "sql", "aws"]),
      job("b", ["python", "sql"]),
      job("c", ["python"]),
      job("d", ["aws"]),
      ...filler(8), // python is 3 of 12 = 25%, so nothing is suppressed here
    ]);
    expect(facet.map((f) => f.skill)).toEqual(["python", "aws", "sql"]);
    expect(facet[0]).toEqual({ skill: "python", count: 3 });
  });

  it("caps the list so the row cannot become a wall of links", () => {
    const many = Array.from({ length: 40 }, (_, i) => job(`j${i}`, [`skill-${i}`]));
    expect(computeSkillFacet(many)).toHaveLength(SKILL_FACET_SIZE);
  });
});

describe("a skill matching most of the board is suppressed", () => {
  /*
   * By SHARE, not by anyone deciding which words are "real" skills. A filter
   * that matches most of the board does not filter — true of `communication`
   * at 55% of production today, and equally true of `react` on a board that
   * happened to be all frontend roles. The rule survives the corpus changing;
   * an allowlist of technology names does not.
   */
  it("drops a skill clearly above the share ceiling and keeps one clearly below", () => {
    // A 100-posting board so the ceiling (SKILL_FACET_MAX_SHARE * 100) is a
    // whole number regardless of the constant's exact value — computed from
    // the constant, not a ratio hardcoded against today's 0.25. That
    // hardcoding is exactly the bug class Stage 12's referral-reward fix
    // exists to rule out elsewhere; this test now survives the threshold
    // moving again the same way that fix does.
    const ceiling = Math.floor(100 * SKILL_FACET_MAX_SHARE);
    const over = ceiling + 10;
    const under = Math.max(1, ceiling - 10);
    const board = [
      ...Array.from({ length: over }, (_, i) => job(`o${i}`, ["ubiquitous"])),
      ...Array.from({ length: under }, (_, i) => job(`u${i}`, ["niche"])),
      ...filler(100 - over - under),
    ];
    const facet = computeSkillFacet(board);
    expect(facet.map((f) => f.skill), "clearly over the ceiling must be dropped").not.toContain(
      "ubiquitous",
    );
    expect(facet.map((f) => f.skill), "clearly under the ceiling must survive").toContain("niche");
  });

  it("keeps a skill exactly at the ceiling, and drops the one just above", () => {
    // Ceiling derived from the real constant, not a number that only worked
    // for one specific threshold value.
    const ceiling = Math.floor(100 * SKILL_FACET_MAX_SHARE);
    const board = [
      ...Array.from({ length: ceiling }, (_, i) => job(`at${i}`, ["at", "over"])),
      job("extra-over", ["over"]),
      ...filler(100 - ceiling - 1),
    ];
    const skills = computeSkillFacet(board).map((f) => f.skill);
    expect(skills, "a skill exactly at the threshold was dropped").toContain("at");
    expect(skills, "a skill above the threshold survived").not.toContain("over");
  });

  it("counts skill-less postings in the denominator", () => {
    // They are still jobs the filter would hide, so they belong in the share.
    // 2 of 10 = 20%, kept. Were the 8 empty postings excluded, it would read
    // as 2 of 2 = 100% and be dropped.
    const board = [
      job("a", ["sql"]),
      job("b", ["sql"]),
      ...Array.from({ length: 8 }, (_, i) => job(`e${i}`, [])),
    ];
    expect(computeSkillFacet(board).map((f) => f.skill)).toContain("sql");
  });

  it("the ceiling is a share, so it moves with the board", () => {
    expect(SKILL_FACET_MAX_SHARE).toBeGreaterThan(0);
    expect(SKILL_FACET_MAX_SHARE).toBeLessThan(1);
  });

  it(
    "SABOTAGE-PROOF TARGET: Stage 8a's measured threshold (0.25) actually excludes " +
      "'compliance' (28.8% of the board it was checked against) and keeps sql/python/accounting",
    () => {
      // Pins the actual business decision, not just the general shape of the
      // rule above — the dynamic tests elsewhere in this file deliberately
      // derive their own expectations FROM this constant so they survive it
      // changing again; this one exists specifically to prove today's value
      // still does what it was chosen to do. 1000 postings so 28.8% (288) and
      // every other percentage below is an exact integer count.
      const board = [
        ...Array.from({ length: 288 }, (_, i) => job(`c${i}`, ["compliance"])),
        ...Array.from({ length: 136 }, (_, i) => job(`sql${i}`, ["sql"])), // 13.6%
        ...Array.from({ length: 131 }, (_, i) => job(`py${i}`, ["python"])), // 13.1%
        ...Array.from({ length: 91 }, (_, i) => job(`ac${i}`, ["accounting"])), // 9.1%
        ...filler(1000 - 288 - 136 - 131 - 91),
      ];
      const skills = computeSkillFacet(board, 20).map((f) => f.skill);
      expect(skills, "compliance at 28.8% must be excluded under the 0.25 threshold").not.toContain(
        "compliance",
      );
      expect(skills).toEqual(expect.arrayContaining(["sql", "python", "accounting"]));
    },
  );

  it(
    "SABOTAGE-PROOF TARGET: a skill the share ceiling excludes from the facet still filters " +
      "correctly by hand-crafted URL — invisible in the list is not the same as unreachable",
    () => {
      // "ubiquitous" is well over the ceiling (dropped from the facet, same
      // as `compliance` on the real board), "rare" is well under it.
      const ceiling = Math.floor(100 * SKILL_FACET_MAX_SHARE);
      const over = ceiling + 10;
      const board = [
        ...Array.from({ length: over }, (_, i) => job(`u${i}`, ["ubiquitous"])),
        job("rare-holder", ["rare"]),
        ...filler(100 - over - 1),
      ];

      const facet = computeSkillFacet(board);
      expect(facet.map((f) => f.skill), "test setup: ubiquitous must actually be excluded").not.toContain(
        "ubiquitous",
      );

      // What jobs/page.tsx does when `?skill=ubiquitous` arrives on the URL
      // regardless of whether the facet ever offered it as a chip: filter the
      // real board by the literal value. Must return every real match, not
      // an empty list (misleading — reads as "no jobs need this skill", which
      // is false) and not the full unfiltered board (also misleading — reads
      // as "everyone has this skill" without saying so).
      const filtered = filterBySkill(board, "ubiquitous");
      expect(filtered, "a hand-crafted URL for an excluded skill must not return nothing").toHaveLength(
        over,
      );
      expect(filtered.map((j) => j.id).every((id) => id.startsWith("u"))).toBe(true);
    },
  );
});

describe("filtering", () => {
  const board = [
    job("a", ["sql", "python"]),
    job("b", ["SQL"]),
    job("c", ["figma"]),
    job("d", undefined),
  ];

  it("matches case-insensitively", () => {
    expect(filterBySkill(board, "sql").map((j) => j.id)).toEqual(["a", "b"]);
  });

  it("returns everything when nothing is selected", () => {
    expect(filterBySkill(board, undefined)).toHaveLength(4);
  });

  it("returns nothing for a skill no posting names, rather than everything", () => {
    // The URL param is not validated against a list, because there is no list.
    // An unknown value must narrow to zero, not fall open.
    expect(filterBySkill(board, "cobol")).toEqual([]);
  });
});

describe("the facet does not collapse when it is used", () => {
  it("counts the board BEFORE the skill filter, so other skills survive", () => {
    const board = [
      job("a", ["sql", "python"]),
      job("b", ["sql"]),
      job("c", ["figma"]),
      ...filler(7), // sql is 2 of 10 = 20%
    ];

    // What the page does: facet from the unfiltered board, filter after.
    const facet = computeSkillFacet(board);
    const shown = filterBySkill(board, "sql");

    expect(shown.map((j) => j.id)).toEqual(["a", "b"]);
    expect(
      facet.map((f) => f.skill).sort(),
      "selecting SQL hid the other skills, so the filter cannot be changed without clearing it",
    ).toEqual(["figma", "python", "sql"]);

    // The wrong order, for contrast: counting the filtered set loses figma
    // entirely and the user is stranded.
    const wrong = computeSkillFacet(shown).map((f) => f.skill);
    expect(wrong).not.toContain("figma");
  });
});
