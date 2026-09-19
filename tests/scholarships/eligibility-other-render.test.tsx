/**
 * send-377 — the public scholarship page's own eligibility_other render
 * site ("src/app/(app)/scholarships/[id]/page.tsx") swapped
 * `{scholarship.eligibility_other}` for
 * `renderMarkdownParagraphs(scholarship.eligibility_other, "text-ink-soft")`.
 * This exercises that exact call shape against BOTH of this column's real
 * authors — an admin-formatted value (MinimalRichEditor, bold/italic +
 * paragraph breaks) and a plain scraped value (ingest.ts, sources.config.ts
 * — hand-typed plain English, no markdown syntax at all) — proving neither
 * path breaks the other, per this ticket's own explicit ask. The generic
 * renderMarkdownParagraphs behavior (autolink, empty input, etc.) is already
 * covered by tests/rich-text/minimal-rich-text.test.tsx; this file is scoped
 * to THIS call site's real content shapes.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdownParagraphs } from "@/lib/farah/render-markdown";

function renderEligibilityOther(value: string) {
  return renderToStaticMarkup(<>{renderMarkdownParagraphs(value, "text-ink-soft")}</>);
}

describe("eligibility_other renders correctly for both of its real authors", () => {
  it("an admin-formatted, multi-paragraph quoted-provider-text value", () => {
    // Real shape per this ticket's own production-data pull: dense,
    // citation-heavy prose, paragraph breaks the meaningful structure (not
    // lists/headings — the editor never offers those for this field).
    const adminValue =
      'Officially confirmed (fetched 2026-09-09 from the ASU-hosted application form): "This scholarship opportunity is for a fully funded, two-year, in-person **masters degree**."\n\nApplicants must demonstrate *financial need* and submit two letters of recommendation.';

    const html = renderEligibilityOther(adminValue);

    expect(html).toContain("<strong>masters degree</strong>");
    expect(html).toContain("<em>financial need</em>");
    // Two blank-line-separated paragraphs -> two <p> elements.
    expect(html.match(/<p class="text-ink-soft">/g)?.length).toBe(2);
    expect(html).not.toContain("**");
  });

  it("a plain scraped value with zero markdown syntax renders unchanged, as one paragraph", () => {
    // A real sources.config.ts value, verbatim.
    const scrapedValue = "Open to Nigerian citizens; oil-and-gas-relevant disciplines prioritised.";

    const html = renderEligibilityOther(scrapedValue);

    expect(html).toBe(
      `<p class="text-ink-soft">Open to Nigerian citizens; oil-and-gas-relevant disciplines prioritised.</p>`,
    );
    expect(html).not.toContain("<strong>");
    expect(html).not.toContain("<em>");
  });

  it("a scraped value that happens to contain a lone, unpaired asterisk is not misrendered as emphasis", () => {
    // The class of input PR #507's own investigation worried about for a
    // different field — worth checking here too, since eligibility_other's
    // scraped path has never gone through any editor that would have
    // produced a PAIRED marker.
    const scrapedValue = "GPA of 3.5* required (see official page for the exact scale used).";

    const html = renderEligibilityOther(scrapedValue);

    expect(html).toContain("GPA of 3.5* required");
    expect(html).not.toContain("<em>");
  });
});
