/**
 * Resumes saved BEFORE the S2-11 tailoring changes must render exactly as they
 * did. A tailored resume saved earlier stores paragraph text: an achievement
 * string that holds several sentences, a `description` with newlines or dashes
 * in it, dates as the model wrote them ("September 2022"), skills in whatever
 * casing it returned. None of that is touched on render. Normalisation (split
 * bullets, "Sep 2022" dates, skill de-duplication and casing) is
 * TAILORING-TIME ONLY — `normaliseTailoredResume`, called once at the end of
 * `tailorResumeToJob` — so it reaches a resume only when the user tailors again.
 *
 * Checked against every registered template and every skeleton demo config.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEMO_CONFIGS, renderTemplateConfig } from "@/components/resume-builder/skeletons";
import { TemplateRenderer, registeredSlugs } from "@/components/resume-builder/templates";
import { EMPTY_RESUME, getExperienceBullets, getExperienceText, type StructuredResume } from "@/lib/resume/types";

const GLUED = "• Led the onboarding redesign. • Cut drop-off by 12%. • Mentored two PMs.";
const TYPED_LIST = "- Led the onboarding redesign.\n- Cut drop-off by 12%.\n- Mentored two PMs.";
const PARAGRAPH = "Led the onboarding redesign. Cut drop-off by 12%. Mentored two PMs.";

function oldResume(role: Partial<StructuredResume["experience"][number]>): StructuredResume {
  return {
    ...EMPTY_RESUME,
    contact: { name: "Ada Obi", email: "ada@example.com" },
    summary: "Operations lead. Ran settlement 09/2022 onwards.",
    experience: [{ title: "PM", company: "Acme", startDate: "September 2022", endDate: "present", ...role }],
    education: [{ school: "UniLag", degree: "B.Sc.", startDate: "2012", endDate: "07/2016" }],
    skills: ["project management", "Project-Management", "sql", "Excel"],
  };
}

const renderers: Array<[string, (r: StructuredResume) => string]> = [
  ...Object.entries(DEMO_CONFIGS).map(
    ([key, config]) => [`demo:${key}`, (r: StructuredResume) => renderToStaticMarkup(renderTemplateConfig(config, r))] as [string, (r: StructuredResume) => string],
  ),
  ...registeredSlugs().map(
    (slug) => [`slug:${slug}`, (r: StructuredResume) => renderToStaticMarkup(createElement(TemplateRenderer, { slug, resume: r }))] as [string, (r: StructuredResume) => string],
  ),
];

describe("reading an old-format entry", () => {
  it("a description is never split into bullets, whatever is typed in it", () => {
    for (const description of [TYPED_LIST, GLUED, "• One\n• Two", "1. One\n2. Two", PARAGRAPH]) {
      const entry = { title: "PM", company: "Acme", description };
      expect(getExperienceBullets(entry), JSON.stringify(description)).toBeUndefined();
      expect(getExperienceText(entry)).toBe(description);
    }
  });

  it("stored bullets are returned exactly as stored, glued or not", () => {
    const entry = { title: "PM", company: "Acme", bullets: [GLUED] };
    expect(getExperienceBullets(entry)).toEqual([GLUED]);
    expect(getExperienceText(entry)).toBe(GLUED);
  });
});

describe("rendering an old-format resume", () => {
  it("there are templates to check", () => {
    expect(renderers.length).toBeGreaterThanOrEqual(8);
  });

  for (const [name, render] of renderers) {
    it(`${name}: a description with typed dashes stays one paragraph, newlines and dashes included`, () => {
      const html = render(oldResume({ description: TYPED_LIST }));
      expect(html).toContain(TYPED_LIST);
      expect(html).not.toMatch(/<li[^>]*>Led the onboarding/);
    });

    it(`${name}: one achievement string holding several sentences stays ONE list item`, () => {
      const html = render(oldResume({ bullets: [GLUED] }));
      expect(html).toContain(`<li>${GLUED}</li>`);
      expect(html).not.toMatch(/<li[^>]*>Cut drop-off/);
    });

    it(`${name}: dates, skills and casing are shown exactly as stored`, () => {
      const html = render(oldResume({ description: PARAGRAPH }));
      // Text only: templates differ in markup (a joined line vs one <li> per skill).
      const text = html.replace(/<[^>]+>/g, "\n");
      expect(text).toContain("September 2022");
      expect(text).toContain("present");
      expect(text).not.toContain("Sep 2022");
      // Skills are neither de-duplicated nor re-cased on render.
      for (const skill of ["project management", "Project-Management", "sql", "Excel"]) {
        expect(text, `skill "${skill}" was changed or dropped`).toContain(skill);
      }
      expect(text).not.toContain("Project Management");
      expect(text).not.toContain("SQL");
    });
  }
});
