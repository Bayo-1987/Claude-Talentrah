/**
 * Founder requirement, 2026-09-02: no two identical jobs on Talentrah even
 * when they arrive from different sources. tests/jobs/dedup-collisions.test.ts
 * already pins that an IDENTICAL location string collapses correctly across
 * sources ("Lagos, Nigeria" from Greenhouse == "lagos, nigeria" from
 * Workable) — this file is about the REAL gap that leaves open: two sources
 * stating the SAME real place with DIFFERENT amounts of detail.
 *
 * src/lib/jobs/sources/greenhouse.ts stores whatever free text an employer
 * typed into their own board ("Lagos" alone is common — see
 * job-posting-jsonld.ts's parseJobLocation for the measured real-data list),
 * while src/lib/jobs/sources/schema-org.ts's formatLocation always produces
 * a structured "Locality, Country" join. Before the fix in dedup.ts, those
 * two strings for the SAME city normalized to DIFFERENT text ("lagos" vs
 * "lagos nigeria") and therefore hashed to different fingerprints — the same
 * real job posted through both a company's own Greenhouse board and a
 * Workable country search would land as TWO rows, which is exactly what the
 * founder's requirement rules out.
 */
import { describe, expect, it } from "vitest";
import { computeDedupFingerprint } from "@/lib/jobs/dedup";

describe("cross-source collapse: the same real job, different location detail", () => {
  it("Greenhouse's bare city and schema-org's 'city, country' now collapse", () => {
    // The exact shape the research for this feature found live: a company
    // could run a Greenhouse board (bare "Lagos") while also being indexed
    // by a Workable country search (structured "Lagos, Nigeria").
    const viaGreenhouse = computeDedupFingerprint("Reliance Health", "Backend Engineer", "Lagos");
    const viaWorkable = computeDedupFingerprint("Reliance Health", "Backend Engineer", "Lagos, Nigeria");
    expect(
      viaWorkable,
      "the same real job must not become two rows because one source stated its location more precisely",
    ).toBe(viaGreenhouse);
  });

  it("collapses regardless of which source has the extra detail", () => {
    // Symmetric: schema-org's location could in principle also be the bare
    // form (a job with no address details beyond a bare TELECOMMUTE) while
    // a Greenhouse employer wrote the fuller form themselves.
    const bare = computeDedupFingerprint("Jumia", "Finance Analyst", "Nairobi");
    const full = computeDedupFingerprint("Jumia", "Finance Analyst", "Nairobi, Kenya");
    expect(bare).toBe(full);
  });

  it("a Greenhouse employer's own 'Remote - City, Country' phrasing still collapses with schema-org's plain form", () => {
    // Real Greenhouse free text leads with "Remote" as a modifier ahead of
    // the place; schema-org's formatLocation never produces that prefix at
    // all (work_type already carries remote-ness separately). Both must
    // still resolve to the same city token.
    const greenhouseStyle = computeDedupFingerprint("Wave", "Growth Lead", "Remote - Accra, Ghana");
    const schemaOrgStyle = computeDedupFingerprint("Wave", "Growth Lead", "Accra, Ghana");
    expect(greenhouseStyle).toBe(schemaOrgStyle);
  });

  it("bare 'Remote' from either source still collapses with the other's bare 'Remote'", () => {
    const a = computeDedupFingerprint("Apollo Agriculture", "Support Engineer", "Remote");
    const b = computeDedupFingerprint("Apollo Agriculture", "Support Engineer", "remote");
    expect(a).toBe(b);
  });

  describe("what this must NOT start over-merging", () => {
    it("genuinely different cities still produce different fingerprints", () => {
      const lagos = computeDedupFingerprint("Moniepoint", "Software Engineer", "Lagos, Nigeria");
      const nairobi = computeDedupFingerprint("Moniepoint", "Software Engineer", "Nairobi, Kenya");
      expect(lagos).not.toBe(nairobi);
    });

    it("a bare city and a DIFFERENT full location still differ", () => {
      const bareLagos = computeDedupFingerprint("Jumia", "Ops Lead", "Lagos");
      const fullAbuja = computeDedupFingerprint("Jumia", "Ops Lead", "Abuja, Nigeria");
      expect(bareLagos).not.toBe(fullAbuja);
    });

    it("different titles at the same company/location still differ, unaffected by the location change", () => {
      const engineer = computeDedupFingerprint("Wave", "Backend Engineer", "Accra, Ghana");
      const manager = computeDedupFingerprint("Wave", "Product Manager", "Accra, Ghana");
      expect(engineer).not.toBe(manager);
    });

    it("different companies with the same title/location still differ", () => {
      const a = computeDedupFingerprint("Wave", "Backend Engineer", "Lagos, Nigeria");
      const b = computeDedupFingerprint("Jumia", "Backend Engineer", "Lagos, Nigeria");
      expect(a).not.toBe(b);
    });
  });

  describe("the known, honestly-named residual gap", () => {
    it("a country-first free-text location does NOT collapse with a city-first one — not claimed as solved", () => {
      /*
       * Named rather than hidden: canonicalLocationToken takes the FIRST
       * segment, so an employer who writes "Nigeria (Remote)" or
       * "Nigeria, Lagos" (country first, unusual but not impossible) will
       * not match schema-org's city-first "Lagos, Nigeria". Real measured
       * production location data (job-posting-jsonld.ts's parseJobLocation
       * comment) skews city-first, so this is the accepted, named residual
       * rather than a silently broken promise.
       */
      const cityFirst = computeDedupFingerprint("Reliance Health", "Ops Manager", "Lagos, Nigeria");
      const countryFirst = computeDedupFingerprint("Reliance Health", "Ops Manager", "Nigeria, Lagos");
      expect(cityFirst).not.toBe(countryFirst);
    });
  });
});
