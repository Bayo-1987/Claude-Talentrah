/**
 * Cross-persona collision check for `EXAMPLE_PERSONAS`
 * (src/lib/resume-builder/preview-sample.ts).
 *
 * WHY THIS TEST DIDN'T NEED TO EXIST BEFORE. With exactly one persona
 * (`PREVIEW_SAMPLE_RESUME`), there was nothing to collide with — every
 * value only had to be distinctive from a real user's real data (see that
 * file's own header). Now that `example-guard.ts` treats a match against
 * ANY persona as "still the example" (a `.some(...)` across the registry),
 * two personas that happened to share a name/email/phone, or an identical
 * skills/projects/certifications list, would be a real bug even though
 * neither persona's OWN content changed: it would mean a resume genuinely
 * built from one persona's contact details could get misattributed, and —
 * more importantly for what this guard actually protects — it would mean
 * the registry is carrying redundant, non-distinguishing content instead of
 * genuinely different personas, defeating the entire point of building
 * category-specific examples.
 *
 * SABOTAGE-PROOF: run once with `EPC_SITE_ENGINEER_RESUME.contact.email`
 * temporarily overwritten to equal `PREVIEW_SAMPLE_RESUME.contact.email`,
 * confirmed it failed with a message naming both personas' emails, then
 * reverted — see the PR description for the before/after transcript. Left
 * here as the standing regression check.
 */
import { describe, expect, it } from "vitest";
import {
  EXAMPLE_PERSONAS,
  PREVIEW_SAMPLE_RESUME,
  EPC_SITE_ENGINEER_RESUME,
  DEVELOPMENT_PROGRAMME_OFFICER_RESUME,
} from "@/lib/resume-builder/preview-sample";

function pairs<T>(items: readonly T[]): Array<[T, T]> {
  const result: Array<[T, T]> = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      result.push([items[i], items[j]]);
    }
  }
  return result;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length > 0 && a.length === b.length && a.every((item, i) => item === b[i]);
}

describe("EXAMPLE_PERSONAS registry has at least the 3 personas this pass built", () => {
  it("contains the kept PM persona plus the 2 new ones, and nothing is accidentally duplicated by reference", () => {
    expect(EXAMPLE_PERSONAS).toHaveLength(3);
    expect(EXAMPLE_PERSONAS).toContain(PREVIEW_SAMPLE_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(EPC_SITE_ENGINEER_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(DEVELOPMENT_PROGRAMME_OFFICER_RESUME);
  });
});

describe("SABOTAGE-PROOF TARGET: no two personas collide on identity or list content", () => {
  it("no two personas share a contact name", () => {
    const offenders = pairs(EXAMPLE_PERSONAS)
      .filter(([a, b]) => a.contact.name && a.contact.name === b.contact.name)
      .map(([a]) => `"${a.contact.name}" shared between two personas`);
    expect(offenders).toEqual([]);
  });

  it("no two personas share a contact email", () => {
    const offenders = pairs(EXAMPLE_PERSONAS)
      .filter(([a, b]) => a.contact.email && a.contact.email === b.contact.email)
      .map(([a, b]) => `"${a.contact.email}" (${a.contact.name} / ${b.contact.name})`);
    expect(offenders).toEqual([]);
  });

  it("no two personas share a contact phone number", () => {
    const offenders = pairs(EXAMPLE_PERSONAS)
      .filter(([a, b]) => a.contact.phone && a.contact.phone === b.contact.phone)
      .map(([a, b]) => `"${a.contact.phone}" (${a.contact.name} / ${b.contact.name})`);
    expect(offenders).toEqual([]);
  });

  it("no two personas share a verbatim skills list", () => {
    const offenders = pairs(EXAMPLE_PERSONAS)
      .filter(([a, b]) => sameList(a.skills, b.skills))
      .map(([a, b]) => `${a.contact.name} / ${b.contact.name}`);
    expect(offenders).toEqual([]);
  });

  it("no two personas share a verbatim projects list", () => {
    const offenders = pairs(EXAMPLE_PERSONAS)
      .filter(([a, b]) => sameList(a.projects, b.projects))
      .map(([a, b]) => `${a.contact.name} / ${b.contact.name}`);
    expect(offenders).toEqual([]);
  });

  it("no two personas share a verbatim certifications list", () => {
    const offenders = pairs(EXAMPLE_PERSONAS)
      .filter(([a, b]) => sameList(a.certifications, b.certifications))
      .map(([a, b]) => `${a.contact.name} / ${b.contact.name}`);
    expect(offenders).toEqual([]);
  });
});

describe("every persona still meets the content bar (quantified, populated, non-empty)", () => {
  it.each(EXAMPLE_PERSONAS.map((p) => [p.contact.name, p] as const))(
    "%s has a full contact block, 2-3 roles, education, 8+ skills, 2+ projects and 2+ certifications",
    (_name, persona) => {
      expect(persona.contact.name).toBeTruthy();
      expect(persona.contact.email).toBeTruthy();
      expect(persona.contact.phone).toBeTruthy();
      expect(persona.contact.location).toBeTruthy();
      expect(persona.summary).toBeTruthy();
      expect(persona.experience.length).toBeGreaterThanOrEqual(2);
      expect(persona.experience.length).toBeLessThanOrEqual(3);
      expect(persona.education.length).toBeGreaterThanOrEqual(1);
      expect(persona.skills.length).toBeGreaterThanOrEqual(8);
      expect(persona.projects.length).toBeGreaterThanOrEqual(2);
      expect(persona.certifications.length).toBeGreaterThanOrEqual(2);
      // Every experience entry has a real, non-trivial (quantified-style)
      // description, not a placeholder — the same bar preview-sample.ts's
      // own header sets for PREVIEW_SAMPLE_RESUME.
      for (const entry of persona.experience) {
        expect(entry.description && entry.description.length).toBeGreaterThan(40);
      }
    },
  );
});
