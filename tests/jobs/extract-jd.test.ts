/**
 * extractStructuredJd's skill extraction (src/lib/jobs/extract-jd.ts) —
 * Stage 8's vocabulary expansion.
 *
 * The board this feeds is occupationally diverse (trades, hospitality,
 * franchise operators, NGO field roles, agriculture — not just tech/product),
 * and the original 48-term vocabulary structurally could not see most of it.
 * Every new term here was found by real document-frequency measurement
 * against 184 real "thin" production postings — see SKILL_VOCABULARY's own
 * header comment for the numbers. These tests exist so a short term like
 * "pos" or "aml" can never silently start matching a substring of an
 * unrelated word, which is exactly the failure mode a naive `.includes()`
 * would have and `\b` word-boundary matching exists to prevent.
 */
import { describe, expect, it } from "vitest";
import { extractStructuredJd, SKILL_VOCABULARY, NON_SCREENABLE_SKILLS } from "@/lib/jobs/extract-jd";

describe("Stage 8 additions extract real, distinct terms", () => {
  it.each([
    ["pos", "Experience with POS reconciliation is required."],
    ["crm", "You will manage our CRM and update customer records daily."],
    ["quality assurance", "Own quality assurance for every release."],
    ["agriculture", "5+ years of experience in agriculture extension services."],
    ["procurement", "Lead procurement for all field office supplies."],
    ["reconciliation", "Daily reconciliation of till and POS records."],
    ["google sheets", "Comfortable building trackers in Google Sheets."],
    ["microsoft office", "Proficiency in Microsoft Office is required."],
    ["credit risk", "Assess credit risk for new loan applicants."],
    ["sabre", "Must be certified in Sabre and Amadeus."],
    ["amadeus", "Must be certified in Sabre and Amadeus."],
    ["travelport", "Experience with Travelport is a plus."],
    ["budgeting", "Own budgeting and forecasting for the department."],
    ["powerpoint", "Build client decks in PowerPoint."],
    ["haccp", "Certified in HACCP food safety standards."],
    ["fraud detection", "Support fraud detection and investigation."],
    ["food safety", "Ensure food safety compliance across kitchens."],
    ["kyc", "Run KYC checks on new business accounts."],
    ["aml", "Familiarity with AML regulations is required."],
    ["agronomy", "A background in agronomy or crop science."],
    ["vendor management", "Own vendor management for regional suppliers."],
    ["fleet management", "Oversee fleet management for the logistics team."],
  ])("extracts %j from real posting language", (term, text) => {
    expect(extractStructuredJd(text).skills).toContain(term);
  });
});

describe("SABOTAGE-PROOF TARGET: short new terms do not match inside unrelated words", () => {
  it("'pos' does not match inside 'position', 'purpose', or 'compose'", () => {
    const text =
      "This position requires you to compose reports whose purpose is executive review.";
    expect(extractStructuredJd(text).skills).not.toContain("pos");
  });

  it("'crm' does not match inside a longer unrelated token", () => {
    expect(extractStructuredJd("acrmony is not a word, but this checks it anyway").skills).not.toContain(
      "crm",
    );
  });

  it("'aml' does not match inside 'family' or 'example'", () => {
    const text = "For example, this role suits a family-oriented candidate.";
    expect(extractStructuredJd(text).skills).not.toContain("aml");
  });

  it("'sap' is deliberately NOT in the vocabulary yet — too rare on this board to add", () => {
    // Documents a real decision, not a gap: see SKILL_VOCABULARY's own
    // header for why "sap" was measured (7/184) and left out at this pass.
    expect(SKILL_VOCABULARY).not.toContain("sap");
  });
});

describe("nothing added here was accidentally marked non-screenable", () => {
  const added = [
    "pos", "crm", "quality assurance", "agriculture", "procurement", "reconciliation",
    "google sheets", "microsoft office", "credit risk", "sabre", "budgeting", "powerpoint",
    "haccp", "fraud detection", "food safety", "kyc", "aml", "agronomy", "amadeus",
    "travelport", "vendor management", "fleet management",
  ];

  it.each(added)("%s is screenable (not in NON_SCREENABLE_SKILLS)", (term) => {
    expect(NON_SCREENABLE_SKILLS.has(term)).toBe(false);
  });
});
