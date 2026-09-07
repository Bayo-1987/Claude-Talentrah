/**
 * Sabotage-proof coverage for the Template Library PR 1/3 schema widening
 * (see docs referenced from the PR description — this widens
 * `StructuredResume`/`ResumeExperienceEntry` only; no template, registry, or
 * `structure_schema` change).
 *
 * Three properties matter here, and each is a distinct way this kind of
 * change goes wrong silently:
 *
 *  1. A resume using every NEW field renders without crashing on all seven
 *     existing template components — the new fields have to be genuinely
 *     optional at the type level, not just optional in name.
 *
 *  2. A resume using NONE of the new fields renders BYTE-IDENTICAL to how it
 *     rendered before this change — not just "doesn't throw". The pre-change
 *     component source is reconstructed via `git show` of each template file
 *     at the commit before this PR's edits (tests/resume-builder/
 *     __fixtures__/pre-schema-widen/), so this compares against the actual
 *     old behaviour rather than a hand-written guess at it.
 *
 *  3. `getExperienceText` (src/lib/resume/types.ts) — the bullets/description
 *     fallback every template now reads through — behaves correctly at both
 *     ends: description-only (no bullets) renders exactly as before, and
 *     bullets-only (no description) actually shows the bullets rather than
 *     silently showing nothing.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentType } from "react";
import { EMPTY_RESUME, getExperienceText, type StructuredResume } from "@/lib/resume/types";
import {
  getTemplateComponent,
  registeredSlugs,
  type TemplateProps,
} from "@/components/resume-builder/templates";

// Pre-change fixtures — verbatim `git show HEAD:<path>` of each template as
// it existed immediately before this PR, with only the `./shared` relative
// import repointed to the real (unchanged) shared module so they still
// compile from their new location.
import { ResumeDocument as PreResumeDocument } from "./__fixtures__/pre-schema-widen/resume-document";
import { ClinicalTemplate as PreClinical } from "./__fixtures__/pre-schema-widen/clinical";
import { StatuteTemplate as PreStatute } from "./__fixtures__/pre-schema-widen/statute";
import { CriticalPathTemplate as PreCriticalPath } from "./__fixtures__/pre-schema-widen/critical-path";
import { PublicRecordTemplate as PrePublicRecord } from "./__fixtures__/pre-schema-widen/public-record";
import { PortfolioGridTemplate as PrePortfolioGrid } from "./__fixtures__/pre-schema-widen/portfolio-grid";
import { PipelineTemplate as PrePipeline } from "./__fixtures__/pre-schema-widen/pipeline";

type AnyTemplate = ComponentType<TemplateProps>;

const PRE_CHANGE_COMPONENTS: Record<string, AnyTemplate> = {
  "clean-professional": PreResumeDocument,
  clinical: PreClinical as AnyTemplate,
  statute: PreStatute as AnyTemplate,
  "critical-path": PreCriticalPath as AnyTemplate,
  "public-record": PrePublicRecord as AnyTemplate,
  "portfolio-grid": PrePortfolioGrid as AnyTemplate,
  pipeline: PrePipeline as AnyTemplate,
};

function render(Component: ComponentType<TemplateProps>, resume: StructuredResume): string {
  return renderToStaticMarkup(<Component resume={resume} />);
}

/** A resume using ONLY fields that existed before this PR — no new field is set at all. */
const OLD_SHAPE_RESUME: StructuredResume = {
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

/** Every new field this PR added, all populated at once. */
const FULL_WITH_NEW_FIELDS: StructuredResume = {
  ...OLD_SHAPE_RESUME,
  experience: [
    {
      ...OLD_SHAPE_RESUME.experience[0],
      bullets: ["Cut readmissions by a fifth over two quarters.", "Ran a 24-bed ward across three shifts."],
    },
  ],
  links: [{ label: "LinkedIn", url: "https://linkedin.com/in/adaeze" }],
  languages: [{ name: "Igbo", level: "Native" }, { name: "English", level: "Fluent" }],
  awards: ["Nurse of the Year, Lagos General (2024)"],
  publications: ["Reducing readmissions on acute wards, Nigerian Journal of Nursing (2023)"],
  volunteering: [
    {
      role: "Health Camp Coordinator",
      organisation: "Red Cross Nigeria",
      startDate: "2019",
      endDate: "2022",
      description: "Ran free monthly health screenings.",
    },
  ],
  customSections: [{ title: "Tech Stack", items: ["Epic EHR", "Cerner"] }],
  referencesOnRequest: true,
};

describe("every registered template renders a resume using every new field", () => {
  for (const slug of registeredSlugs()) {
    it(`${slug}: does not crash and still shows its ordinary content`, () => {
      const Component = getTemplateComponent(slug);
      const html = render(Component, FULL_WITH_NEW_FIELDS);
      expect(html.length).toBeGreaterThan(0);
      // The pre-existing fields must still show — the new ones aren't
      // supposed to be rendered yet (that's PR 2), but they must not have
      // broken anything that already rendered.
      expect(html).toContain("Adaeze Okonkwo");
      expect(html).toContain("Charge Nurse");
    });
  }
});

describe("a resume with NONE of the new fields renders byte-identical to before this PR", () => {
  for (const slug of registeredSlugs()) {
    it(`${slug}: matches its pre-widen output exactly`, () => {
      const preComponent = PRE_CHANGE_COMPONENTS[slug];
      expect(preComponent, `no pre-change fixture registered for "${slug}"`).toBeDefined();

      const before = render(preComponent, OLD_SHAPE_RESUME);
      const after = render(getTemplateComponent(slug), OLD_SHAPE_RESUME);

      expect(after, `${slug} changed its rendered output for a resume with no new fields`).toBe(before);
    });

    it(`${slug}: matches its pre-widen output for an EMPTY resume too`, () => {
      const preComponent = PRE_CHANGE_COMPONENTS[slug];
      const before = render(preComponent, EMPTY_RESUME);
      const after = render(getTemplateComponent(slug), EMPTY_RESUME);
      expect(after).toBe(before);
    });
  }

  it("every registered slug has a pre-change fixture (the comparison above can't silently skip one)", () => {
    for (const slug of registeredSlugs()) {
      expect(Object.prototype.hasOwnProperty.call(PRE_CHANGE_COMPONENTS, slug), slug).toBe(true);
    }
  });
});

describe("getExperienceText — the bullets/description fallback", () => {
  it("falls back to description when bullets is absent", () => {
    const text = getExperienceText({
      title: "Charge Nurse",
      company: "Lagos General",
      description: "Ran a 24-bed ward.",
    });
    expect(text).toBe("Ran a 24-bed ward.");
  });

  it("falls back to description when bullets is present but empty", () => {
    const text = getExperienceText({
      title: "Charge Nurse",
      company: "Lagos General",
      description: "Ran a 24-bed ward.",
      bullets: [],
    });
    expect(text).toBe("Ran a 24-bed ward.");
  });

  it("prefers bullets over description when bullets has content", () => {
    const text = getExperienceText({
      title: "Charge Nurse",
      company: "Lagos General",
      description: "This should not appear.",
      bullets: ["Cut readmissions by a fifth.", "Trained six junior nurses."],
    });
    expect(text).toContain("Cut readmissions by a fifth.");
    expect(text).toContain("Trained six junior nurses.");
    expect(text).not.toContain("This should not appear.");
  });

  it("uses bullets when description is missing entirely", () => {
    const text = getExperienceText({
      title: "Charge Nurse",
      company: "Lagos General",
      bullets: ["Cut readmissions by a fifth."],
    });
    expect(text).toBe("Cut readmissions by a fifth.");
  });

  it("returns undefined when neither is present, same as a bare description ever did", () => {
    expect(getExperienceText({ title: "Charge Nurse", company: "Lagos General" })).toBeUndefined();
  });

  for (const slug of registeredSlugs()) {
    it(`${slug}: a description-only entry renders the description`, () => {
      const html = render(getTemplateComponent(slug), {
        ...EMPTY_RESUME,
        experience: [{ title: "Charge Nurse", company: "Lagos General", description: "Ran a 24-bed ward." }],
      });
      expect(html).toContain("Ran a 24-bed ward.");
    });

    it(`${slug}: a bullets-only entry (no description) renders the bullets`, () => {
      const html = render(getTemplateComponent(slug), {
        ...EMPTY_RESUME,
        experience: [
          {
            title: "Charge Nurse",
            company: "Lagos General",
            bullets: ["Cut readmissions by a fifth.", "Trained six junior nurses."],
          },
        ],
      });
      expect(html).toContain("Cut readmissions by a fifth.");
      expect(html).toContain("Trained six junior nurses.");
    });
  }
});
