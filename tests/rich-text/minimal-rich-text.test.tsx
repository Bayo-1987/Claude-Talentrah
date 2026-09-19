import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  renderInlineMarkdown,
  renderMarkdownParagraphs,
  stripInlineMarkdown,
} from "@/lib/farah/render-markdown";
import {
  minimalMarkdownToDoc,
  minimalDocToMarkdown,
  minimalParagraphsToDoc,
  minimalDocToParagraphs,
} from "@/lib/rich-text/minimal-document";

/**
 * send-370/371/373 — the shared bold/italic-only editor plumbing
 * (MinimalRichEditor, minimal-document.ts, render-markdown.tsx's
 * renderInlineMarkdown/renderMarkdownParagraphs/stripInlineMarkdown) used by
 * the resume summary field (send-370 Part A), DecisionForm's two
 * richNote consumers (send-371), and screening answers (send-373).
 *
 * Mirrors tests/employer/markdown-editor-roundtrip.test.ts's own two
 * standards for the full-grammar editor: (1) round-trip fidelity — a
 * string loaded into the editor and saved with no edits must not silently
 * change — and (2) a real injection test proving this can never produce an
 * `<a>`/`<img>`/`dangerouslySetInnerHTML`, since a literal `#`/`-`/`>`
 * character a user typed must render as exactly that literal character,
 * never be reinterpreted as heading/list/quote structure this grammar has
 * no toolbar for in the first place.
 */

function renderInline(text: string): string {
  return renderToStaticMarkup(<>{renderInlineMarkdown(text)}</>);
}

function renderParagraphs(content: string): string {
  return renderToStaticMarkup(<>{renderMarkdownParagraphs(content, "p-class")}</>);
}

describe("minimal grammar round-trip: markdownToDoc <-> docToMarkdown", () => {
  function roundTrip(markdown: string): string {
    return minimalDocToMarkdown(minimalMarkdownToDoc(markdown));
  }

  it("a single plain-text paragraph round-trips unchanged", () => {
    expect(roundTrip("Backend engineer focused on payments infrastructure.")).toBe(
      "Backend engineer focused on payments infrastructure.",
    );
  });

  it("bold and italic marks round-trip unchanged", () => {
    const md = "Led a **cross-functional** team to ship *three* major releases.";
    expect(roundTrip(md)).toBe(md);
  });

  it("two blank-line-separated paragraphs round-trip as two paragraphs", () => {
    const md = "First paragraph, **bold** word.\n\nSecond paragraph, *italic* word.";
    expect(roundTrip(md)).toBe(md);
  });

  it("a literal heading/list/quote-looking line is preserved as plain text, never reinterpreted", () => {
    // The whole point of NOT reusing parseBlocks: this grammar's editor has
    // no toolbar button that could ever produce a real heading/list/quote,
    // so a user typing these characters means them literally.
    const md = "# not a heading, just my opinion\n\n- not a bullet either\n\n> not a quote";
    expect(roundTrip(md)).toBe(md);
  });

  it("empty content becomes a single empty paragraph and round-trips to empty string", () => {
    expect(minimalDocToMarkdown(minimalMarkdownToDoc(""))).toBe("");
  });

  it("multiple consecutive blank lines collapse to exactly one, same documented normalization class as the full-grammar editor", () => {
    expect(roundTrip("First.\n\n\n\nSecond.")).toBe("First.\n\nSecond.");
  });
});

describe("minimal grammar, array-native path: minimalParagraphsToDoc <-> minimalDocToParagraphs", () => {
  it("one array entry maps to exactly one paragraph and back — send-370 Part B's own mapping", () => {
    const bullets = ["Shipped **three** major releases.", "Mentored *two* junior engineers.", "Plain bullet, no marks."];
    const doc = minimalParagraphsToDoc(bullets);
    expect(doc.content).toHaveLength(3);
    expect(minimalDocToParagraphs(doc)).toEqual(bullets);
  });

  it("an empty array still produces a valid single-paragraph doc", () => {
    const doc = minimalParagraphsToDoc([]);
    expect(doc.content).toHaveLength(1);
  });
});

describe("renderInlineMarkdown / renderMarkdownParagraphs — real round-trip through a rendered example", () => {
  it("renders bold and italic as real <strong>/<em>, plain text untouched", () => {
    const html = renderInline("Led a **cross-functional** team to ship *three* releases.");
    expect(html).toBe("Led a <strong>cross-functional</strong> team to ship <em>three</em> releases.");
  });

  it("renders one <p> per blank-line-separated paragraph with the caller's className", () => {
    const html = renderParagraphs("First paragraph.\n\nSecond paragraph with **bold**.");
    expect(html).toBe(
      '<p class="p-class">First paragraph.</p><p class="p-class">Second paragraph with <strong>bold</strong>.</p>',
    );
  });

  it("returns null for empty/whitespace-only content, matching renderMarkdownBlocks' own never-crash behavior", () => {
    expect(renderMarkdownParagraphs("   \n\n  ")).toBeNull();
  });

  it(
    "SABOTAGE-PROOF TARGET: a literal '#'/'-'/'>'-prefixed line a user typed renders as that literal text, " +
      "never as a heading/list/quote — the exact bug reusing parseBlocks here would reintroduce",
    () => {
      const html = renderParagraphs("# not a heading, just my opinion");
      expect(html).toContain("# not a heading, just my opinion");
      expect(html).not.toContain("<h1");
      expect(html).not.toContain("<h2");
    },
  );

  it(
    "SABOTAGE-PROOF TARGET: nothing this renders can produce an <a>, an <img>, or reach dangerouslySetInnerHTML",
    () => {
      const html = renderInline("[Click here](javascript:alert(document.cookie)) and <script>alert(1)</script>");
      expect(html).not.toContain("<a ");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("<script>alert");
      // The literal text must still be present — rendered as text, not
      // silently dropped.
      expect(html).toContain("javascript:alert");
      expect(html).toContain("&lt;script&gt;");
    },
  );
});

describe("stripInlineMarkdown — LLM-prompt safety (send-370's tailor.ts fix, send-373's farah-review.ts fix)", () => {
  it("strips bold and italic markers, keeping the underlying words", () => {
    expect(stripInlineMarkdown("Led a **cross-functional** team to ship *three* releases.")).toBe(
      "Led a cross-functional team to ship three releases.",
    );
  });

  it("strips bold before italic without corrupting adjacent single-asterisk pairs", () => {
    expect(stripInlineMarkdown("**bold** and *italic* in one sentence")).toBe("bold and italic in one sentence");
  });

  it("plain text with no marks is returned unchanged", () => {
    expect(stripInlineMarkdown("Plain text, no markers at all.")).toBe("Plain text, no markers at all.");
  });
});
