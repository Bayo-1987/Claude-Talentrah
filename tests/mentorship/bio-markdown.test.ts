import { describe, it, expect } from "vitest";
import { markdownToDoc, docToMarkdown } from "@/lib/employer/markdown-editor/document";
import { renderJobDescriptionMarkdown } from "@/lib/farah/render-markdown";
import { stripBioMarkdownToPlainText } from "@/lib/mentorship/bio-preview";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * send-369 — mentor bio reuses send-367's editor/serializer pair verbatim
 * (RichMarkdownEditor with toolbar="minimal"), so this doesn't re-test
 * markdownToDoc/docToMarkdown's own grammar (markdown-editor-roundtrip.test.ts
 * already does that exhaustively) — it proves the one thing specific to this
 * feature: a bio's actual authored register (bold + italic + a bare-URL
 * autolink, no headings/lists/quotes) survives a save/reload round trip
 * byte-for-byte, and the two new render paths (rich profile, stripped card
 * preview) behave as designed.
 */
function roundTrip(markdown: string): string {
  return docToMarkdown(markdownToDoc(markdown));
}

describe("mentor bio: round-trip through the reused rich-editor serializer", () => {
  it("survives bold + italic + a bare-URL autolink byte-for-byte", () => {
    const bio =
      "Ex-**Paystack** engineering manager. *Loves* a good system design question — portfolio at https://example.com/jane.";
    expect(roundTrip(bio)).toBe(bio);
  });

  it("normalizes underscore italics to asterisk italics, same as job description (documented, non-semantic)", () => {
    const bio = "Big on _clear writing_ in code reviews.";
    expect(roundTrip(bio)).toBe("Big on *clear writing* in code reviews.");
  });

  it("round-trips a plain bio with no formatting unchanged", () => {
    const bio = "Product manager, ex-fintech, now advising early-stage teams on GTM.";
    expect(roundTrip(bio)).toBe(bio);
  });
});

describe("mentor bio: full-profile rich render (renderJobDescriptionMarkdown reuse)", () => {
  it("renders bold and italic as real elements, not literal ** / * characters", () => {
    const html = renderToStaticMarkup(
      renderJobDescriptionMarkdown("**Ex-Paystack.** *Loves* mock interviews.") as React.ReactElement,
    );
    expect(html).toContain("<strong>Ex-Paystack.</strong>");
    expect(html).toContain("<em>Loves</em>");
    expect(html).not.toContain("**");
  });

  it("autolinks a bare https:// URL the same way a job description does", () => {
    const html = renderToStaticMarkup(
      renderJobDescriptionMarkdown("Portfolio: https://example.com/jane") as React.ReactElement,
    );
    expect(html).toContain('href="https://example.com/jane"');
  });
});

describe("mentor bio: directory card preview strips to plain text", () => {
  it("removes bold and italic markers without leaving the syntax characters behind", () => {
    expect(stripBioMarkdownToPlainText("**Ex-Paystack** engineering manager. *Loves* system design.")).toBe(
      "Ex-Paystack engineering manager. Loves system design.",
    );
  });

  it("strips a bold run without corrupting it when an italic run also exists (order matters: bold before italic)", () => {
    expect(stripBioMarkdownToPlainText("**Bold** and *italic* together.")).toBe("Bold and italic together.");
  });

  it("leaves a bare URL untouched — nothing to strip, no accidental mangling", () => {
    expect(stripBioMarkdownToPlainText("Portfolio: https://example.com/jane")).toBe(
      "Portfolio: https://example.com/jane",
    );
  });

  it("leaves plain text with no markdown syntax unchanged", () => {
    const plain = "Product manager, ex-fintech, now advising early-stage teams on GTM.";
    expect(stripBioMarkdownToPlainText(plain)).toBe(plain);
  });
});
