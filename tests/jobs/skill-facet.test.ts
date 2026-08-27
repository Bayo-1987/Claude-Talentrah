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
} from "@/lib/jobs/skill-facet";
import type { Tables } from "@/lib/supabase/types";

type JobPosting = Tables<"job_postings">;

function job(id: string, skills: unknown): JobPosting {
  return { id, structured_jd: skills === undefined ? {} : { skills } } as unknown as JobPosting;
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
    const facet = computeSkillFacet([job("a", ["sql", "sql", "SQL"]), job("b", ["sql"])]);
    expect(facet).toEqual([{ skill: "sql", count: 2 }]);
  });

  it("orders by count, then alphabetically for a stable render", () => {
    const facet = computeSkillFacet([
      job("a", ["python", "sql", "aws"]),
      job("b", ["python", "sql"]),
      job("c", ["python"]),
      job("d", ["aws"]),
    ]);
    expect(facet.map((f) => f.skill)).toEqual(["python", "aws", "sql"]);
    expect(facet[0]).toEqual({ skill: "python", count: 3 });
  });

  it("caps the list so the row cannot become a wall of links", () => {
    const many = Array.from({ length: 40 }, (_, i) => job(`j${i}`, [`skill-${i}`]));
    expect(computeSkillFacet(many)).toHaveLength(SKILL_FACET_SIZE);
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
    const board = [job("a", ["sql", "python"]), job("b", ["sql"]), job("c", ["figma"])];

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
