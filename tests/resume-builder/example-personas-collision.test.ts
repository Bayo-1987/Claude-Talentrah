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
 *
 * UPDATED for batch 1 of the per-slug persona rollout: the registry grew
 * from 3 personas to 12 (the original 3 plus 9 new ones covering the
 * Engineering/Construction/Oil & Gas grouping individually — see
 * preview-sample.ts). Re-ran the same sabotage — this time making two of
 * the NEW personas' certifications lists identical — and confirmed the
 * "no two personas share a verbatim certifications list" check still fails
 * and still names both personas at n=12, then reverted; see the PR
 * description for that transcript too.
 *
 * EDUCATION CHECK ADDED after batch 1 shipped: batch 1's manual review (not
 * any test — there was no check on `education` at all) caught two real
 * `school`+`degree` collisions late. One was between two personas that are
 * BOTH in this registry, which the check added below would have caught
 * automatically. The other was between a new persona here and a
 * hand-written fixture living in `example-guard.test.ts` — a resume literal
 * that was never added to `EXAMPLE_PERSONAS` at all.
 *
 * COVERAGE GAP THIS DOES NOT CLOSE: this check, like every other check in
 * this file, only ever compares entries *within* `EXAMPLE_PERSONAS`. It is
 * structurally incapable of catching a collision against a fixture that
 * lives outside the registry — e.g. a resume object hand-authored inline in
 * some other test file's own test data. That is exactly the second
 * collision batch 1 hit, and no automated check in this file can see it,
 * because those fixtures are never imported here and the registry has no
 * way to know they exist. Guarding against that class of collision is a
 * cross-file problem this test does not attempt to solve — see the
 * `example-guard.test.ts` header for the convention adopted instead
 * (a pointer for fixture authors to check names/schools against this
 * registry by hand before picking their own).
 *
 * UPDATED for batch 2: the registry grew from 12 to 22 personas (5 finishing
 * the NGO & Development / Agriculture & Agribusiness split, 5 more on
 * standalone-category slugs — see preview-sample.ts's own header). This
 * batch was the first real exercise of the education check added right
 * above: it was run for real against the full 22-persona registry (not just
 * sabotaged and reverted) before this batch's content was finalized, and
 * separately sabotage-proofed again at n=22 by colliding two of the NEW
 * personas' education entries — see the PR description for that transcript.
 */
import { describe, expect, it } from "vitest";
import {
  EXAMPLE_PERSONAS,
  PREVIEW_SAMPLE_RESUME,
  EPC_SITE_ENGINEER_RESUME,
  DEVELOPMENT_PROGRAMME_OFFICER_RESUME,
  CONSTRUCTION_FOREMAN_RESUME,
  STRUCTURAL_DESIGN_ENGINEER_RESUME,
  ELECTRICAL_DESIGN_ENGINEER_RESUME,
  LAND_SURVEYOR_RESUME,
  GEOTECHNICAL_ENGINEER_RESUME,
  REAL_ESTATE_DEVELOPMENT_MANAGER_RESUME,
  DRILLING_RIG_SUPERVISOR_RESUME,
  OFFSHORE_PROCESS_ENGINEER_RESUME,
  WELLHEAD_COMPLETIONS_ENGINEER_RESUME,
  IMPACT_REPORTING_OFFICER_RESUME,
  GRANTS_PROPOSAL_OFFICER_RESUME,
  COMMERCIAL_AGRONOMIST_RESUME,
  FIELD_PRODUCTION_SUPERVISOR_RESUME,
  VALUE_CHAIN_ANALYST_RESUME,
  SOFTWARE_ENGINEER_RESUME,
  CREDIT_RISK_ANALYST_RESUME,
  REGISTERED_NURSE_RESUME,
  CORPORATE_LEGAL_ASSOCIATE_RESUME,
  BUSINESS_OPERATIONS_MANAGER_RESUME,
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

describe("EXAMPLE_PERSONAS registry has exactly the 22 personas across batch 1 and batch 2", () => {
  it("contains the 12 batch-1 personas plus the 10 new batch-2 ones, and nothing is accidentally duplicated by reference", () => {
    expect(EXAMPLE_PERSONAS).toHaveLength(22);
    expect(EXAMPLE_PERSONAS).toContain(PREVIEW_SAMPLE_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(EPC_SITE_ENGINEER_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(DEVELOPMENT_PROGRAMME_OFFICER_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(CONSTRUCTION_FOREMAN_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(STRUCTURAL_DESIGN_ENGINEER_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(ELECTRICAL_DESIGN_ENGINEER_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(LAND_SURVEYOR_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(GEOTECHNICAL_ENGINEER_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(REAL_ESTATE_DEVELOPMENT_MANAGER_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(DRILLING_RIG_SUPERVISOR_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(OFFSHORE_PROCESS_ENGINEER_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(WELLHEAD_COMPLETIONS_ENGINEER_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(IMPACT_REPORTING_OFFICER_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(GRANTS_PROPOSAL_OFFICER_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(COMMERCIAL_AGRONOMIST_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(FIELD_PRODUCTION_SUPERVISOR_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(VALUE_CHAIN_ANALYST_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(SOFTWARE_ENGINEER_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(CREDIT_RISK_ANALYST_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(REGISTERED_NURSE_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(CORPORATE_LEGAL_ASSOCIATE_RESUME);
    expect(EXAMPLE_PERSONAS).toContain(BUSINESS_OPERATIONS_MANAGER_RESUME);
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

  // Registry-vs-registry only — see the file header's "COVERAGE GAP" note
  // for the class of collision this cannot catch (a persona colliding with
  // a hand-written fixture in some other test file).
  it("no two personas share an identical school+degree education entry", () => {
    const offenders: string[] = [];
    for (const [a, b] of pairs(EXAMPLE_PERSONAS)) {
      for (const eduA of a.education) {
        for (const eduB of b.education) {
          if (eduA.school && eduA.school === eduB.school && eduA.degree === eduB.degree) {
            offenders.push(
              `${a.contact.name} / ${b.contact.name} both have "${eduA.school}" — "${eduA.degree ?? "(no degree)"}"`,
            );
          }
        }
      }
    }
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
