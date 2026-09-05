/**
 * skillsOf — reading `structured_jd.skills` off a posting.
 *
 * The feed's own skill FACET (computeSkillFacet/filterBySkill, and the
 * twelve-chip browse row they powered) was removed — search now covers
 * `structured_jd.skills` directly (src/lib/jobs/search.test.ts), which was
 * the facet's reason to exist. `skillsOf` itself stays: search and the job
 * detail page's "Skills named in this posting" card both still call it.
 */
import { describe, expect, it } from "vitest";
import { skillsOf } from "@/lib/jobs/skill-facet";
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
