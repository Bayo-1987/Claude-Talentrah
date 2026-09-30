/**
 * Pins the wording of the ATS claim on the template gallery card.
 *
 * WHY THIS TEST EXISTS. The card told users an `ats_safe` template "reads correctly to applicant tracking
 * systems". That is a guarantee the product cannot make: text extraction differs from one applicant tracking
 * system to the next, and the `ats_safe` flag was only ever proven with one extractor (pdf.js, in
 * `e2e/ats-safety.spec.ts`). The wording must not promise correct reading, and must say that systems differ.
 * It pins only what we can support: a single-column layout kept in reading order.
 *
 * WHAT IS DELIBERATELY NOT PINNED. Exact wording. The banned patterns below are the over-claims that were
 * actually on the card or are its obvious rephrasings; the required patterns are the two facts the copy must
 * still carry. "always" is not banned — an unrelated, honest sentence may contain it.
 *
 * OUT OF SCOPE (separate surfaces, own decisions): the "ATS-safe only" filter chip on `/resume-builder`, the
 * blog link label, and `/ats-resume-checker`'s "would pass an ATS" wording.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/lib/resume-builder/actions", () => ({ unlockTemplateAction: async () => ({ ok: true }) }));
vi.mock("@/components/resume-builder/template-thumbnail", () => ({ TemplateThumbnail: () => null }));

import { TemplateCard } from "@/components/resume-builder/template-card";

function cardText(atsSafe: boolean): string {
  const template = {
    id: "t1",
    slug: "x",
    name: "Sample",
    industry_category: "General",
    ats_safe: atsSafe,
    is_premium: false,
    unlock_cost_credits: 0,
  } as never;
  return renderToStaticMarkup(<TemplateCard template={template} isUnlocked />)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ");
}

describe("template card ATS wording", () => {
  it("does not promise that applicant tracking systems read the template correctly", () => {
    expect(cardText(true), "the flagged-template copy still guarantees correct reading").not.toMatch(
      /reads? correctly|guarantee|will pass|every (applicant|system)|all (applicant|systems)/i,
    );
  });

  it("says outright that systems differ", () => {
    expect(cardText(true), "the flagged-template copy has no qualifier about systems differing").toMatch(
      /\b(differ|vary|varies)\b/i,
    );
  });

  it("still describes what the layout actually is", () => {
    expect(cardText(true)).toMatch(/single-column/i);
  });

  it("leaves the unflagged copy exactly as it was (already a caution, not a claim)", () => {
    expect(cardText(false)).toContain(
      "Not ATS-safe — this layout's columns can scramble in some applicant tracking systems.",
    );
  });
});
