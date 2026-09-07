import { describe, expect, it } from "vitest";
import { CATALOG_TEMPLATE_CONFIGS } from "@/components/resume-builder/skeletons/catalog-configs";

/**
 * The real bug this guards against: `blueprint`'s `sectionLabels` once read
 * "Professional Certifications (COREN)" — COREN is the real Nigerian
 * engineering licensing body — while the certifications underneath it,
 * inherited from the one shared `PREVIEW_SAMPLE_RESUME` every template
 * previews against, were "Certified Scrum Product Owner (CSPO)" and a
 * Product School certificate. Naming a specific real licensing/regulatory
 * body in a label makes a factual claim the shared demo content cannot
 * back up for any category but the one it was written for — that reads as
 * wrong, not generic, to anyone who recognizes the body.
 *
 * NOT a ban on every real-world term in a label — `"Certifications (PMP,
 * Agile)"`, `"Safety & HSE Certifications"`, `"Logistics Certifications"`
 * and `"Regulatory Certifications"` are all fine and stay untouched: a
 * voluntary professional certification or a generic category name doesn't
 * assert the same kind of licensure claim a chartered/registered body's own
 * name does. This checks specifically for the small set of real Nigerian
 * (and closely-adjacent international) licensing/chartering bodies whose
 * name alone implies a credential the shared demo resume cannot show —
 * add to this list if a future slug reintroduces the same failure mode with
 * a body not listed here, rather than loosening the check.
 */
const LICENSING_BODY_NAMES = [
  "COREN", // Council for the Regulation of Engineering in Nigeria
  "MDCN", // Medical and Dental Council of Nigeria
  "NBA", // Nigerian Bar Association
  "ICAN", // Institute of Chartered Accountants of Nigeria
  "ANAN", // Association of National Accountants of Nigeria
  "CIPM", // Chartered Institute of Personnel Management (Nigeria)
  "ARCON", // Architects Registration Council of Nigeria
  "NIQS", // Nigerian Institute of Quantity Surveyors
  "PCN", // Pharmacists Council of Nigeria
  "NMDPRA", // Nigerian Midstream and Downstream Petroleum Regulatory Authority
];

describe("catalog-configs.ts section labels never invoke a real licensing body the shared demo content can't back up", () => {
  it("SABOTAGE-PROOF TARGET: no sectionLabels value names a specific licensing/regulatory body", () => {
    const offenders: string[] = [];

    for (const [slug, config] of Object.entries(CATALOG_TEMPLATE_CONFIGS)) {
      for (const [section, label] of Object.entries(config.content.sectionLabels)) {
        for (const body of LICENSING_BODY_NAMES) {
          if (label.toUpperCase().includes(body)) {
            offenders.push(`${slug}.${section} = "${label}" (names ${body})`);
          }
        }
      }
    }

    expect(
      offenders,
      "a sectionLabels value names a real licensing body the shared PREVIEW_SAMPLE_RESUME " +
        "cannot back up — see this test's own header for why that reads as wrong, not generic",
    ).toEqual([]);
  });

  it("blueprint specifically no longer claims COREN", () => {
    const blueprint = CATALOG_TEMPLATE_CONFIGS["blueprint"];
    expect(blueprint, "blueprint should still exist in the catalog").toBeDefined();
    expect(blueprint.content.sectionLabels.certifications).toBe("Professional Certifications");
  });
});
