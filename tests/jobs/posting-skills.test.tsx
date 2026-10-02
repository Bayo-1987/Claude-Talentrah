/**
 * The job detail page's "Skills named in this posting" card against the
 * "N of M tags" cell of the match breakdown right above it.
 *
 * The breakdown counts only SCREENABLE tags (computeMatchScore drops
 * NON_SCREENABLE_SKILLS from the arithmetic AND from matchedSkills /
 * missingSkills), while the card used to print every skill the posting names.
 * A job tagged sql, python, aws, communication, leadership read "0 of 3 tags"
 * above a list of five. Count and list have to be the same set; the skills the
 * match does not use are shown, but labelled as not counted.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PostingSkills } from "@/components/jobs/posting-skills";
import { MatchBreakdown } from "@/components/jobs/match-breakdown";
import { splitSkillsByScreenability } from "@/lib/jobs/skill-facet";
import { NON_SCREENABLE_SKILLS } from "@/lib/jobs/extract-jd";
import { computeMatchScore } from "@/lib/matching/score";
import type { StructuredResume } from "@/lib/resume/types";

const resume = { skills: [], experience: [] } as unknown as StructuredResume;

describe("splitSkillsByScreenability", () => {
  it("separates the three non-screenable skills from the rest, keeping order", () => {
    expect(
      splitSkillsByScreenability(["sql", "communication", "python", "leadership", "aws", "operations"]),
    ).toEqual({
      screenable: ["sql", "python", "aws"],
      notCounted: ["communication", "leadership", "operations"],
    });
  });

  it("is case-insensitive and de-duplicates, as the score's own set does", () => {
    expect(splitSkillsByScreenability(["SQL", "sql", "Communication", "communication"])).toEqual({
      screenable: ["sql"],
      notCounted: ["communication"],
    });
  });

  it("uses the scorer's own set, so a term added there is separated here with no second edit", () => {
    const { screenable, notCounted } = splitSkillsByScreenability([...NON_SCREENABLE_SKILLS, "sql"]);
    expect(screenable).toEqual(["sql"]);
    expect([...notCounted].sort()).toEqual([...NON_SCREENABLE_SKILLS].sort());
  });

  it("COUNT AND LIST AGREE: the screenable list is exactly what the breakdown counts", () => {
    for (const skills of [
      ["sql", "python", "aws", "communication", "leadership"],
      ["communication", "leadership", "operations"],
      ["sql"],
      [],
      ["Python", "python", "Operations"],
    ]) {
      const { explanation } = computeMatchScore(resume, skills, undefined);
      const counted = explanation.matchedSkills.length + explanation.missingSkills.length;
      expect(splitSkillsByScreenability(skills).screenable.length).toBe(counted);
    }
  });
});

describe("PostingSkills", () => {
  const skills = ["sql", "python", "aws", "communication", "leadership"];

  it("the headline list holds only the skills the match counts, and no non-screenable one", () => {
    const html = renderToStaticMarkup(<PostingSkills skills={skills} />);
    const main = html.split('data-testid="posting-skills-not-counted"')[0];
    expect(main).toContain("sql · python · aws");
    expect(main).not.toContain("communication");
    expect(main).not.toContain("leadership");
  });

  it("names the others in a separate, labelled line", () => {
    const html = renderToStaticMarkup(<PostingSkills skills={skills} />);
    expect(html).toContain('data-testid="posting-skills-not-counted"');
    expect(html).toMatch(/Also named, not counted in your match[^<]*<\/[^>]+>[^<]*communication · leadership/);
  });

  it("the card and the breakdown agree for the same posting: '0 of 3 tags' sits over exactly three listed skills", () => {
    const { explanation } = computeMatchScore(resume, skills, undefined);
    const cell = renderToStaticMarkup(<MatchBreakdown explanation={explanation} />);
    expect(cell).toContain("0 of 3 tags");
    const card = renderToStaticMarkup(<PostingSkills skills={skills} />);
    const listed = card.split('data-testid="posting-skills-not-counted"')[0].match(/sql · python · aws/);
    expect(listed).not.toBeNull();
  });

  it("a posting with only non-screenable skills says so instead of printing an empty list", () => {
    const html = renderToStaticMarkup(<PostingSkills skills={["communication", "leadership"]} />);
    expect(html).toContain("No skills a resume can be checked against");
    expect(html).toContain("communication · leadership");
    expect(html).toContain("Also named, not counted in your match");
  });

  it("renders nothing at all for a posting with no skills", () => {
    expect(renderToStaticMarkup(<PostingSkills skills={[]} />)).toBe("");
  });

  it("omits the 'not counted' line when every skill is counted", () => {
    const html = renderToStaticMarkup(<PostingSkills skills={["sql", "python"]} />);
    expect(html).not.toContain("not counted");
  });
});

describe("the job detail page", () => {
  it("renders its skills through PostingSkills, never by joining the raw list", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/(app)/jobs/[id]/page.tsx", "utf8");
    expect(src).toContain("<PostingSkills skills={skills} />");
    expect(src).not.toMatch(/skills\.join\(/);
  });
});
