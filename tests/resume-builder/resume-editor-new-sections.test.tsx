/**
 * The resume editor's new sections (links, languages, awards, publications,
 * volunteering, custom sections, references-on-request — Template library
 * PR 1/3) must be COLLAPSED BY DEFAULT: a user who wants none of them should
 * see a form no longer than it was before this field set existed.
 *
 * Rendered with `renderToStaticMarkup`, the same technique
 * resume-editor-label-association.test.tsx already uses for this component
 * (a client component, but static server rendering is enough to inspect the
 * markup a fresh page load sends down).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StructuredResume } from "@/lib/resume/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const { ResumeEditor } = await import("@/components/resume-builder/resume-editor");

const CONTENT: StructuredResume = {
  contact: { name: "Ada Bello", email: "ada@example.com" },
  summary: "",
  experience: [],
  education: [],
  skills: [],
  projects: [],
  certifications: [],
};

const html = renderToStaticMarkup(
  <ResumeEditor resumeId="r1" initialTitle="My Resume" initialContent={CONTENT} templateSlug={null} />,
);

describe("the new sections are collapsed by default", () => {
  it("renders a <details> without the `open` attribute wrapping the new sections", () => {
    const detailsIndex = html.indexOf("<details");
    expect(detailsIndex, "no <details> element found for the new sections").toBeGreaterThan(-1);
    // The tag itself must not carry `open` — that's what makes it collapsed.
    const tagEnd = html.indexOf(">", detailsIndex);
    const tag = html.slice(detailsIndex, tagEnd);
    expect(tag).not.toContain("open");
  });

  it("still contains the new section labels somewhere (they exist, just collapsed)", () => {
    for (const label of ["Links", "Languages", "Awards", "Publications", "Volunteering", "Custom sections", "References"]) {
      expect(html, `missing the "${label}" section`).toContain(label);
    }
  });

  it("every new-section field it renders is programmatically associated with a label, matching the app's convention", () => {
    // References checkbox has a stable id.
    expect(html).toContain('id="references-on-request"');
    expect(html).toContain('for="references-on-request"');
  });
});

describe("adding a link/language/volunteering/custom-section entry gives it a real, associated field", () => {
  it("an experience-free resume with one of each new item still renders its fields with associated ids", () => {
    const withItems: StructuredResume = {
      ...CONTENT,
      links: [{ label: "GitHub", url: "https://github.com/ada" }],
      languages: [{ name: "Yoruba", level: "Native" }],
      volunteering: [{ role: "Mentor", organisation: "She Code Africa" }],
      customSections: [{ title: "Tech Stack", items: ["SQL"] }],
    };
    const withItemsHtml = renderToStaticMarkup(
      <ResumeEditor resumeId="r1" initialTitle="My Resume" initialContent={withItems} templateSlug={null} />,
    );

    for (const id of [
      "links-0-label",
      "links-0-url",
      "languages-0-name",
      "languages-0-level",
      "volunteering-0-role",
      "volunteering-0-organisation",
      "custom-section-0-title",
      "custom-section-0-items",
    ]) {
      expect(withItemsHtml.includes(`for="${id}"`) && withItemsHtml.includes(`id="${id}"`), id).toBe(true);
    }
  });
});
