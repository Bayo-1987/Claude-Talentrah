/**
 * The export/Auto-Apply guard against unedited "Start from an example"
 * content (src/lib/resume-builder/example-guard.ts) — a resume still
 * carrying PREVIEW_SAMPLE_RESUME's placeholder values must be caught before
 * it reaches a recruiter, and a genuinely blank or freshly-imported resume
 * must never be flagged.
 *
 * SABOTAGE-PROOF: "findUneditedExampleFields returns nothing for an
 * unedited example resume" is the target test for this guard. It was run
 * once with the guard's exact-match checks deliberately disabled (each
 * comparison short-circuited to `false`) to confirm it actually fails when
 * the guard is broken, then restored — see the PR description for the
 * before/after run. Left here as the standing regression check.
 */
import { describe, expect, it } from "vitest";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import { PREVIEW_SAMPLE_RESUME } from "@/lib/resume-builder/preview-sample";
import {
  findUneditedExampleFields,
  hasUneditedExampleContent,
  describeExampleGuardError,
} from "@/lib/resume-builder/example-guard";

describe("findUneditedExampleFields", () => {
  it("flags every field on a completely untouched example resume", () => {
    const flags = findUneditedExampleFields(PREVIEW_SAMPLE_RESUME);
    const paths = flags.map((f) => f.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "contact.name",
        "contact.email",
        "contact.phone",
        "contact.location",
        "summary",
        "skills",
        "projects",
        "certifications",
      ]),
    );
    // Every seeded experience/education entry should be flagged too.
    expect(paths.filter((p) => p.startsWith("experience."))).toHaveLength(
      PREVIEW_SAMPLE_RESUME.experience.length,
    );
    expect(paths.filter((p) => p.startsWith("education."))).toHaveLength(
      PREVIEW_SAMPLE_RESUME.education.length,
    );
    expect(hasUneditedExampleContent(PREVIEW_SAMPLE_RESUME)).toBe(true);
  });

  it("clears a field the moment its value changes", () => {
    const edited: StructuredResume = {
      ...PREVIEW_SAMPLE_RESUME,
      contact: { ...PREVIEW_SAMPLE_RESUME.contact, email: "real.person@gmail.com" },
    };
    const flags = findUneditedExampleFields(edited);
    expect(flags.map((f) => f.path)).not.toContain("contact.email");
    // Everything else untouched should still be flagged.
    expect(flags.map((f) => f.path)).toContain("contact.name");
  });

  it("clears the skills/projects/certifications flag if even one item changes", () => {
    const edited: StructuredResume = {
      ...PREVIEW_SAMPLE_RESUME,
      skills: [...PREVIEW_SAMPLE_RESUME.skills, "kubernetes"],
    };
    expect(findUneditedExampleFields(edited).map((f) => f.path)).not.toContain("skills");
  });

  it("never flags a genuinely blank resume — nothing to compare, nothing to flag", () => {
    expect(findUneditedExampleFields(EMPTY_RESUME)).toEqual([]);
    expect(hasUneditedExampleContent(EMPTY_RESUME)).toBe(false);
  });

  it("never flags a freshly-imported resume with real (different) content", () => {
    const imported: StructuredResume = {
      contact: {
        name: "Chidinma Okoro",
        email: "chidinma.okoro@outlook.com",
        phone: "+234 701 555 9012",
        location: "Abuja, Nigeria",
      },
      summary: "Backend engineer with three years in logistics software.",
      experience: [
        {
          title: "Software Engineer",
          company: "Kwik Logistics",
          location: "Abuja, Nigeria",
          startDate: "2022",
          endDate: "Present",
          description: "Built the route-optimization service.",
        },
      ],
      education: [
        { school: "Ahmadu Bello University", degree: "B.Eng.", field: "Electrical Engineering", startDate: "2015", endDate: "2019" },
      ],
      skills: ["golang", "postgres", "docker"],
      projects: ["Route optimization service"],
      certifications: [],
    };
    expect(findUneditedExampleFields(imported)).toEqual([]);
  });

  it(
    "SABOTAGE-PROOF TARGET: never flags a real résumé for sharing ONLY the example's " +
      "location — 'Lagos, Nigeria' is the single most likely real answer for this " +
      "product's own users, not a distinctive value like the example's fictional name",
    () => {
      // Everything here is real and distinct from PREVIEW_SAMPLE_RESUME except
      // contact.location, which is exactly the example's value — the same
      // fixture shape e2e/auto-apply.spec.ts's seedBaseResume uses, and the
      // actual live failure this test was added to pin down.
      const realLagosUser: StructuredResume = {
        contact: {
          name: "E2E Tester",
          email: "e2e@talentrah.test",
          location: PREVIEW_SAMPLE_RESUME.contact.location,
        },
        summary: "Backend engineer with six years building payment systems.",
        experience: [
          {
            title: "Senior Engineer",
            company: "Paystack",
            location: "Lagos",
            startDate: "2021",
            endDate: "2026",
            description: "Built and operated payment APIs at scale.",
          },
        ],
        education: [{ school: "University of Lagos", degree: "BSc", field: "Computer Science" }],
        skills: ["Node.js", "Postgres", "TypeScript"],
        projects: [],
        certifications: [],
      };
      expect(findUneditedExampleFields(realLagosUser)).toEqual([]);
      expect(hasUneditedExampleContent(realLagosUser)).toBe(false);
    },
  );

  it("DOES flag location once something more distinctive already matched too", () => {
    // Location is a confirming signal, not a disqualifying one — a resume
    // that also shares the example's fictional name is genuinely unedited,
    // and location should count as part of that, not be silently ignored.
    const stillTheExample: StructuredResume = {
      ...EMPTY_RESUME,
      contact: {
        name: PREVIEW_SAMPLE_RESUME.contact.name,
        location: PREVIEW_SAMPLE_RESUME.contact.location,
      },
    };
    const paths = findUneditedExampleFields(stillTheExample).map((f) => f.path);
    expect(paths).toContain("contact.name");
    expect(paths).toContain("contact.location");
  });

  it("does not flag an experience entry that merely reuses the example's company name", () => {
    // Guards the entry-match logic against being too loose: it must require
    // title + company + description to all match, not just one field.
    const partial: StructuredResume = {
      ...EMPTY_RESUME,
      experience: [
        {
          title: "A Completely Different Title",
          company: PREVIEW_SAMPLE_RESUME.experience[0].company,
          description: "A completely different description of real work.",
        },
      ],
    };
    expect(findUneditedExampleFields(partial).map((f) => f.path)).not.toContain("experience.0");
  });
});

describe("describeExampleGuardError", () => {
  it("names a single field without a list conjunction", () => {
    const msg = describeExampleGuardError([{ path: "contact.email", label: "email" }]);
    expect(msg).toContain("email");
    expect(msg).not.toContain(" and ");
  });

  it("joins multiple fields with 'and', and pluralizes", () => {
    const msg = describeExampleGuardError([
      { path: "contact.email", label: "email" },
      { path: "contact.name", label: "name" },
      { path: "skills", label: "skills list" },
    ]);
    expect(msg).toContain("email, name and skills list");
    expect(msg).toMatch(/values/);
  });
});
