/**
 * Every template actually renders, and renders DIFFERENTLY.
 *
 * WHY THIS EXISTS SEPARATELY FROM template-registry.test.ts. That file proves
 * the slug→component mapping is wired up and that distinct slugs return
 * distinct component *references*. It does not prove any of those components
 * produce sane output — a template with broken markup, a crash on an empty
 * section, or a copy-paste that quietly renders the same DOM as its neighbour
 * would pass every assertion there.
 *
 * These render to static HTML with react-dom/server, which is the cheapest
 * thing that exercises the real component tree. No DOM, no browser, no
 * snapshots to bless — snapshots would lock in the markup and turn every
 * legitimate design tweak into a diff to approve, which is the opposite of
 * useful for layout work.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StructuredResume } from "@/lib/resume/types";
import { EMPTY_RESUME } from "@/lib/resume/types";
import {
  DEFAULT_TEMPLATE_SLUG,
  getTemplateComponent,
  registeredSlugs,
  TemplateRenderer,
} from "@/components/resume-builder/templates";

const FULL: StructuredResume = {
  contact: {
    name: "Adaeze Okonkwo",
    email: "adaeze@example.com",
    phone: "+234 800 000 0000",
    location: "Lagos, Nigeria",
  },
  summary: "Registered nurse and programme lead with eight years across acute care.",
  experience: [
    {
      title: "Charge Nurse",
      company: "Lagos General",
      location: "Lagos",
      startDate: "2021",
      endDate: "Present",
      description: "Ran a 24-bed ward and cut readmissions by a fifth over two quarters.",
    },
  ],
  education: [{ school: "University of Ibadan", degree: "BNSc", startDate: "2013", endDate: "2017" }],
  skills: ["Triage", "Care planning", "Stakeholder reporting"],
  projects: ["Ward handover redesign"],
  certifications: ["RN — NMCN 123456", "BLS"],
};

function render(slug: string, resume: StructuredResume): string {
  const Component = getTemplateComponent(slug);
  return renderToStaticMarkup(<Component resume={resume} />);
}

describe("every registered template renders", () => {
  for (const slug of registeredSlugs()) {
    it(`${slug}: renders a populated resume without throwing, and shows its content`, () => {
      const html = render(slug, FULL);

      // The content has to actually appear — a template that renders an empty
      // shell would otherwise pass a "did not throw" check.
      for (const needle of [
        "Adaeze Okonkwo",
        "Charge Nurse",
        "Lagos General",
        "University of Ibadan",
        "Triage",
        "Ward handover redesign",
        "RN — NMCN 123456",
      ]) {
        expect(html, `${slug} dropped "${needle}" from its output`).toContain(needle);
      }
    });

    it(`${slug}: renders an EMPTY resume without throwing`, () => {
      /*
       * Every section in every template is conditional on a non-empty array or
       * string. A newly created resume is exactly EMPTY_RESUME, so this is the
       * first thing a real user sees after picking a template — the case most
       * likely to hit an undefined access and the least likely to be tried by
       * hand.
       */
      const html = render(slug, EMPTY_RESUME);
      expect(html.length, `${slug} rendered nothing at all for an empty resume`).toBeGreaterThan(0);
      expect(html, "the name placeholder should still show").toContain("Your name");
    });
  }
});

describe("the templates are visually distinct, not just distinct objects", () => {
  it("no two registered templates produce identical markup", () => {
    /*
     * The assertion that would have caught the pre-milestone state directly:
     * seven templates, one layout, identical output for every one of them.
     */
    const byHtml = new Map<string, string>();
    for (const slug of registeredSlugs()) {
      const html = render(slug, FULL);
      const clash = byHtml.get(html);
      expect(
        clash,
        `"${slug}" renders byte-identical markup to "${clash}" — one of them has no real layout`,
      ).toBeUndefined();
      byHtml.set(html, slug);
    }
    expect(byHtml.size).toBe(registeredSlugs().length);
  });

  it("Clinical puts licensure ABOVE experience; clean-professional does not", () => {
    // A concrete, meaningful difference rather than "the strings differ".
    // Healthcare screening checks licence first, which is the whole reason
    // Clinical exists as a separate layout.
    const clinical = render("clinical", FULL);
    const clean = render(DEFAULT_TEMPLATE_SLUG, FULL);

    expect(clinical.indexOf("NMCN 123456")).toBeLessThan(clinical.indexOf("Charge Nurse"));
    expect(clean.indexOf("NMCN 123456")).toBeGreaterThan(clean.indexOf("Charge Nurse"));
  });

  it("Portfolio Grid leads with the work, not the job history", () => {
    // The premium template that previously rendered as the free default. For a
    // designer the portfolio IS the qualification.
    const html = render("portfolio-grid", FULL);
    expect(html.indexOf("Ward handover redesign")).toBeLessThan(html.indexOf("Charge Nurse"));
  });
});

describe("TemplateRenderer is what the preview page uses", () => {
  it("renders the same markup as calling the component directly", () => {
    const viaRenderer = renderToStaticMarkup(<TemplateRenderer slug="statute" resume={FULL} />);
    expect(viaRenderer).toBe(render("statute", FULL));
  });

  it("falls back rather than crashing on an unknown or null slug", () => {
    for (const slug of [null, undefined, "does-not-exist"]) {
      const html = renderToStaticMarkup(<TemplateRenderer slug={slug} resume={FULL} />);
      expect(html).toBe(render(DEFAULT_TEMPLATE_SLUG, FULL));
    }
  });
});
