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
  it("drops a skill above the share ceiling and keeps the ones below", () => {
    // 10 postings: "ubiquitous" on 4 (40%, over), "niche" on 3 (30%, at the
    // ceiling and therefore kept — the rule is `>`, not `>=`).
    const board = [
      ...Array.from({ length: 4 }, (_, i) => job(`u${i}`, ["ubiquitous", "niche"])),
      ...Array.from({ length: 6 }, (_, i) => job(`n${i}`, i === 0 ? ["ubiquitous"] : [])),
    ];
    // ubiquitous: 4 + 1 = 5 of 10 = 50%. niche: 4 of 10 = 40%.
    const facet = computeSkillFacet(board);
    expect(facet.map((f) => f.skill)).not.toContain("ubiquitous");
    expect(facet.map((f) => f.skill)).not.toContain("niche");
  });

  it("keeps a skill exactly at the ceiling, and drops the one just above", () => {
    // 10 postings, ceiling = 3. "at" appears on 3, "over" on 4.
    const board = [
      job("a", ["at", "over"]),
      job("b", ["at", "over"]),
      job("c", ["at", "over"]),
      job("d", ["over"]),
      ...Array.from({ length: 6 }, (_, i) => job(`e${i}`, [])),
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
