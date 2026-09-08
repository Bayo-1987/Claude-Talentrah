/**
 * The export/Auto-Apply guard against unedited "Start from an example"
 * content (src/lib/resume-builder/example-guard.ts) — a resume still
 * carrying one of `EXAMPLE_PERSONAS`'s placeholder values must be caught
 * before it reaches a recruiter, and a genuinely blank or freshly-imported
 * resume must never be flagged.
 *
 * REWORKED FOR THE MULTI-PERSONA REGISTRY. This guard used to compare
 * against a single constant (`PREVIEW_SAMPLE_RESUME`); it now compares
 * against ANY persona in `EXAMPLE_PERSONAS` (preview-sample.ts) —
 * `example-guard.ts`'s own header explains why. Every test below that used
 * to assert "matches THE example" now either (a) runs once per persona via
 * `it.each(EXAMPLE_PERSONAS)`, so a regression that only breaks matching for
 * the non-PM personas is caught the same way a PM-only regression would be,
 * or (b) explicitly cross-checks that a persona OTHER than the one used to
 * build a fixture doesn't accidentally also flag it (proving ".some(...)"
 * isn't overly broad).
 *
 * SABOTAGE-PROOF: "findUneditedExampleFields returns nothing for an
 * unedited example resume" is the target test for this guard. It was run
 * once with the guard's exact-match checks deliberately disabled (each
 * comparison short-circuited to `false`) to confirm it actually fails when
 * the guard is broken, then restored — see the PR description for the
 * before/after run. Left here as the standing regression check.
 *
 * BATCH 1 UPDATE: `EXAMPLE_PERSONAS` grew from 3 to 12 personas (9 new ones
 * covering the Engineering/Construction/Oil & Gas grouping individually —
 * see preview-sample.ts). Every `it.each(EXAMPLE_PERSONAS...)` block below
 * picked up the 9 new personas automatically with no changes needed; the
 * "registry-wide .some(...) match" describe block below also got one new
 * explicit case naming a NEW persona (not just the original EPC/NGO ones)
 * to prove the `.some()` genuinely covers the larger registry, not just the
 * personas that existed when that block was first written.
 *
 * CONVENTION FOR ANYONE HAND-AUTHORING A RESUME FIXTURE IN THIS FILE: this
 * file's own fixtures (e.g. the "freshly-imported resume" below) once
 * collided on `education` — same `school`+`degree` — with a persona added
 * to `EXAMPLE_PERSONAS` in a later batch, and nothing caught it: this file's
 * fixtures aren't part of that registry, so `example-personas-collision.test.ts`
 * (which only compares registry entries against each other) structurally
 * cannot see them. There is no automated cross-file check for this — before
 * picking a name, email, phone, or school+degree pair for a fixture here,
 * grep `EXAMPLE_PERSONAS` in `src/lib/resume-builder/preview-sample.ts` and
 * pick something that doesn't match.
 *
 * BATCH 2: `EXAMPLE_PERSONAS` grew again, 12 to 22 personas. Followed the
 * convention above before writing this batch's content: manually grepped
 * this file's own `school:` fixtures ("Ahmadu Bello University" / "B.Eng." /
 * Electrical Engineering, "University of Lagos" / "BSc" / Computer Science)
 * against every new persona's education entries — no collision (the new
 * Ahmadu Bello University persona uses a different degree, "B.Agric.").
 * Every `it.each(EXAMPLE_PERSONAS...)` block below again picked up the 10
 * new personas automatically with no changes needed.
 *
 * BATCH 3A: `EXAMPLE_PERSONAS` grew again, 22 to 36 personas. Same
 * convention followed before writing this batch's 14 new personas: neither
 * of this file's own fixture pairs ("Ahmadu Bello University" / "B.Eng." /
 * Electrical Engineering above, "University of Lagos" / "BSc" / Computer
 * Science below) was reused by any of the 14 — none of them use either
 * university at all. Every `it.each(EXAMPLE_PERSONAS...)` block below again
 * picked up the 14 new personas automatically with no changes needed.
 *
 * BATCH 3B: `EXAMPLE_PERSONAS` grew again, 36 to 51 personas. Same
 * convention followed before writing this batch's 15 new personas: neither
 * of this file's own fixture pairs was reused by any of the 15. Every
 * `it.each(EXAMPLE_PERSONAS...)` block below again picked up the 15 new
 * personas automatically with no changes needed.
 *
 * BATCH 3C (THIRD AND FINAL): `EXAMPLE_PERSONAS` grew again, 51 to 66
 * personas — the last 15, closing out every remaining fallback slug in the
 * catalog (see preview-sample.ts's own header). Same convention followed
 * before writing this batch's content: this file's own fixture pairs
 * ("Ahmadu Bello University" / "B.Eng." / Electrical Engineering above,
 * "University of Lagos" / "BSc" / Computer Science below) were checked
 * against all 15 new personas' education entries — neither is reused (one
 * new persona also uses "University of Lagos", but with a different degree,
 * "B.A."). Every `it.each(EXAMPLE_PERSONAS...)` block below again picked up
 * the 15 new personas automatically with no changes needed.
 */
import { describe, expect, it } from "vitest";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import {
  PREVIEW_SAMPLE_RESUME,
  EPC_SITE_ENGINEER_RESUME,
  DEVELOPMENT_PROGRAMME_OFFICER_RESUME,
  WELLHEAD_COMPLETIONS_ENGINEER_RESUME,
  EXAMPLE_PERSONAS,
} from "@/lib/resume-builder/preview-sample";
import {
  findUneditedExampleFields,
  hasUneditedExampleContent,
  describeExampleGuardError,
  exampleFieldElementId,
  clearFlaggedExampleFields,
} from "@/lib/resume-builder/example-guard";

describe("findUneditedExampleFields", () => {
  it.each(EXAMPLE_PERSONAS.map((p) => [p.contact.name, p] as const))(
    "flags every field on a completely untouched example resume (%s)",
    (_name, persona) => {
      const flags = findUneditedExampleFields(persona);
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
      expect(paths.filter((p) => p.startsWith("experience."))).toHaveLength(persona.experience.length);
      expect(paths.filter((p) => p.startsWith("education."))).toHaveLength(persona.education.length);
      expect(hasUneditedExampleContent(persona)).toBe(true);
    },
  );

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
      // Everything here is real and distinct from every persona except
      // contact.location, which is exactly PREVIEW_SAMPLE_RESUME's value —
      // the same fixture shape e2e/auto-apply.spec.ts's seedBaseResume uses,
      // and the actual live failure this test was added to pin down.
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

  describe("the registry-wide '.some(...)' match — a NON-PM persona is caught too", () => {
    /*
     * This is the actual behavior change from the single-persona guard: a
     * resume seeded from the Engineering persona (say) must be flagged even
     * though it shares NOTHING with PREVIEW_SAMPLE_RESUME. Proves the guard
     * isn't secretly still only checking the PM persona under the hood.
     */
    it("flags a resume matching the EPC engineer persona, which shares nothing with the PM persona", () => {
      expect(hasUneditedExampleContent(EPC_SITE_ENGINEER_RESUME)).toBe(true);
      // Sanity: genuinely disjoint from the PM persona on every distinctive
      // field, so this can only be passing because of the engineer entry.
      expect(EPC_SITE_ENGINEER_RESUME.contact.name).not.toBe(PREVIEW_SAMPLE_RESUME.contact.name);
      expect(EPC_SITE_ENGINEER_RESUME.contact.email).not.toBe(PREVIEW_SAMPLE_RESUME.contact.email);
    });

    it("flags a resume matching the development programme officer persona", () => {
      expect(hasUneditedExampleContent(DEVELOPMENT_PROGRAMME_OFFICER_RESUME)).toBe(true);
    });

    it("flags a resume matching one of the NEW batch-1 personas (wellhead's completions engineer), proving .some() covers the larger registry, not just the original 3", () => {
      expect(hasUneditedExampleContent(WELLHEAD_COMPLETIONS_ENGINEER_RESUME)).toBe(true);
      expect(WELLHEAD_COMPLETIONS_ENGINEER_RESUME.contact.name).not.toBe(PREVIEW_SAMPLE_RESUME.contact.name);
      expect(WELLHEAD_COMPLETIONS_ENGINEER_RESUME.contact.email).not.toBe(PREVIEW_SAMPLE_RESUME.contact.email);
      expect(WELLHEAD_COMPLETIONS_ENGINEER_RESUME.contact.name).not.toBe(EPC_SITE_ENGINEER_RESUME.contact.name);
      expect(WELLHEAD_COMPLETIONS_ENGINEER_RESUME.contact.email).not.toBe(EPC_SITE_ENGINEER_RESUME.contact.email);
    });

    it("editing a field on ONE persona's content away from ITS OWN value clears that flag, even though other personas' values differ too", () => {
      const edited: StructuredResume = {
        ...EPC_SITE_ENGINEER_RESUME,
        contact: { ...EPC_SITE_ENGINEER_RESUME.contact, email: "real.engineer@gmail.com" },
      };
      const flags = findUneditedExampleFields(edited).map((f) => f.path);
      expect(flags).not.toContain("contact.email");
      // The rest of that persona's untouched fields still flag.
      expect(flags).toContain("contact.name");
    });

    it("a real resume that happens to share the EPC engineer's location is not flagged on that alone", () => {
      const realPortHarcourtUser: StructuredResume = {
        ...EMPTY_RESUME,
        contact: { name: "A Real User", email: "real.user@talentrah.test", location: EPC_SITE_ENGINEER_RESUME.contact.location },
      };
      expect(findUneditedExampleFields(realPortHarcourtUser)).toEqual([]);
    });
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

describe("exampleFieldElementId", () => {
  it("maps contact paths to their pre-existing DOM ids, not a path-derived guess", () => {
    // resume-editor-label-association.test.tsx asserts these exact ids —
    // "contact.name" is NOT "contact-name" in the DOM.
    expect(exampleFieldElementId("contact.name")).toBe("contact-full-name");
    expect(exampleFieldElementId("contact.email")).toBe("contact-email");
    expect(exampleFieldElementId("contact.phone")).toBe("contact-phone");
    expect(exampleFieldElementId("contact.location")).toBe("contact-location");
  });

  it("maps the field/section-level paths to their field ids", () => {
    expect(exampleFieldElementId("summary")).toBe("summary-field");
    expect(exampleFieldElementId("skills")).toBe("skills-field");
    expect(exampleFieldElementId("projects")).toBe("projects-field");
    expect(exampleFieldElementId("certifications")).toBe("certifications-field");
  });

  it("maps experience/education entry paths to their entry-level card id, not a child field", () => {
    // The guard flags these at the entry level (findUneditedExampleFields
    // never emits e.g. "experience.0.title"), so the jump target has to be
    // the card, which is what resume-editor.tsx actually gives an id.
    expect(exampleFieldElementId("experience.0")).toBe("experience-0-card");
    expect(exampleFieldElementId("experience.3")).toBe("experience-3-card");
    expect(exampleFieldElementId("education.1")).toBe("education-1-card");
  });
});

describe("clearFlaggedExampleFields", () => {
  /**
   * The Stage 18 item 4 action: "clear the example content, keep the
   * structure". SABOTAGE-PROOF TARGET — this must actually clear what the
   * guard flags (not a parallel notion of "example"), must leave anything
   * the guard no longer flags completely alone, and must preserve section
   * shape (entry counts) rather than deleting entries outright. Run once per
   * persona so this isn't only proven for the PM one.
   */
  it.each(EXAMPLE_PERSONAS.map((p) => [p.contact.name, p] as const))(
    "a completely untouched example resume becomes flag-free after one pass, and stays flag-free (%s)",
    (_name, persona) => {
      const cleared = clearFlaggedExampleFields(persona);
      expect(findUneditedExampleFields(cleared)).toEqual([]);
      // Idempotent: clearing an already-clear resume is a no-op, not a crash
      // or a further mutation.
      expect(clearFlaggedExampleFields(cleared)).toEqual(cleared);
    },
  );

  it("does NOT touch a field the user already edited away from the example value", () => {
    // Real name typed in, but the user left the example email untouched —
    // only the email (still flagged) may be cleared; the name must survive
    // verbatim.
    const partiallyEdited: StructuredResume = {
      ...PREVIEW_SAMPLE_RESUME,
      contact: { ...PREVIEW_SAMPLE_RESUME.contact, name: "Chidinma Okoro" },
    };
    const cleared = clearFlaggedExampleFields(partiallyEdited);
    expect(cleared.contact.name).toBe("Chidinma Okoro");
    expect(cleared.contact.email).toBe("");
    expect(findUneditedExampleFields(cleared)).toEqual([]);
  });

  it.each(EXAMPLE_PERSONAS.map((p) => [p.contact.name, p] as const))(
    "preserves work-history entry count on clear (%s)",
    (_name, persona) => {
      const cleared = clearFlaggedExampleFields(persona);
      expect(cleared.experience).toHaveLength(persona.experience.length);
      for (const entry of cleared.experience) {
        expect(entry.title).toBe("");
        expect(entry.company).toBe("");
        expect(entry.description).toBe("");
      }
    },
  );

  it("preserves education entry count and blanks every field on the flagged entry", () => {
    expect(PREVIEW_SAMPLE_RESUME.education).toHaveLength(1);
    const cleared = clearFlaggedExampleFields(PREVIEW_SAMPLE_RESUME);
    expect(cleared.education).toHaveLength(1);
    expect(cleared.education[0]).toEqual({
      school: "",
      degree: "",
      field: "",
      startDate: "",
      endDate: "",
    });
  });

  it.each(EXAMPLE_PERSONAS.map((p) => [p.contact.name, p] as const))(
    "preserves skills/projects/certifications list length while emptying every entry (%s)",
    (_name, persona) => {
      const cleared = clearFlaggedExampleFields(persona);
      expect(cleared.skills).toHaveLength(persona.skills.length);
      expect(cleared.skills.every((s) => s === "")).toBe(true);
      expect(cleared.projects).toHaveLength(persona.projects.length);
      expect(cleared.projects.every((p) => p === "")).toBe(true);
      expect(cleared.certifications).toHaveLength(persona.certifications.length);
      expect(cleared.certifications.every((c) => c === "")).toBe(true);
    },
  );

  it("leaves an experience entry the user has genuinely edited completely alone, including its neighbors' shape", () => {
    const edited: StructuredResume = {
      ...PREVIEW_SAMPLE_RESUME,
      experience: [
        {
          title: "Software Engineer",
          company: "Kwik Logistics",
          location: "Abuja, Nigeria",
          startDate: "2022",
          endDate: "Present",
          description: "Built the route-optimization service.",
        },
        ...PREVIEW_SAMPLE_RESUME.experience.slice(1),
      ],
    };
    const cleared = clearFlaggedExampleFields(edited);
    // Untouched real entry survives verbatim.
    expect(cleared.experience[0]).toEqual(edited.experience[0]);
    // Still-example entries (1 and 2) get blanked, shape preserved.
    expect(cleared.experience).toHaveLength(3);
    expect(cleared.experience[1].title).toBe("");
    expect(cleared.experience[2].title).toBe("");
    expect(findUneditedExampleFields(cleared).map((f) => f.path)).not.toContain("experience.0");
  });

  it("is a no-op on a genuinely blank resume — nothing flagged, nothing to clear", () => {
    expect(clearFlaggedExampleFields(EMPTY_RESUME)).toEqual(EMPTY_RESUME);
  });

  it("is a no-op on a freshly-imported resume with real, different content", () => {
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
    expect(clearFlaggedExampleFields(imported)).toEqual(imported);
  });
});
