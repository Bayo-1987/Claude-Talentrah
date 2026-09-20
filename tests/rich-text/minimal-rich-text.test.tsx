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

  /**
   * send-416 — same defect class as send-413's `stripMarkdownToPlainText`
   * fix in src/lib/jobs/extract-jd.ts, confirmed independently for THIS
   * sibling function: a run of 3+ glued asterisks left literal asterisks
   * visible instead of being stripped. This exact string is the one PR
   * #499's own send-413 commit used to reproduce the sibling bug; run here
   * against stripInlineMarkdown it demonstrated the identical symptom
   * before this fix ("Location: India*Who We Are*", literal asterisks
   * surviving).
   */
  it("send-416: collapses a run of 5+ glued asterisks instead of leaving literal asterisks visible", () => {
    expect(stripInlineMarkdown("**Location:** India******Who We Are**")).toBe("Location: IndiaWho We Are");
  });

  it("send-416: a real LLM-sloppy run of glued bold labels (no gap between two bold segments) strips clean", () => {
    // Realistic for tailor.ts/rewrite-bullet.ts's callers: an LLM emitting
    // two "**Label:**"-style bold segments with NOTHING between the first's
    // close and the second's open (not even a space) — a formatting glitch
    // distinct from the HTML-stripping origin of the sibling function's
    // bug, but producing the identical glued-run shape (5+ consecutive
    // asterisks) since the close of one bold marker and the open of the
    // next collide directly.
    expect(stripInlineMarkdown("**Impact: cut costs 30%*****Scope: led 5 engineers**")).toBe(
      "Impact: cut costs 30%Scope: led 5 engineers",
    );
  });

  /**
   * send-416 — the case send-413's fix could NOT be mechanically copied
   * for: unlike stripMarkdownToPlainText (no italics support at all), this
   * function gives a single "*" real meaning. A run of exactly 3 asterisks
   * is a genuine, producible boundary between an adjacent bold segment and
   * an italic segment with no separating character — confirmed from
   * minimal-document.ts's own inlineToMarkdown serializer, which emits
   * "**text**" for a bold node and "*text*" for an italic node with
   * nothing inserted between two adjacent nodes of different marks. A
   * mentor bio editor produces exactly this by bolding one word/phrase and
   * italicizing the very next one with no space typed in between. This
   * must NOT be broken by the run-collapse fix above (the collapse only
   * targets runs of 5+, deliberately below this run's length of 3).
   */
  it("send-416: a genuine adjacent bold-then-italic boundary (run of 3, real editor output) still strips correctly", () => {
    expect(stripInlineMarkdown("**Ex-Google.***Loves hiking*")).toBe("Ex-Google.Loves hiking");
  });

  it("send-416: a genuine adjacent italic-then-bold boundary (run of 3, the other order) still strips correctly", () => {
    expect(stripInlineMarkdown("*Loves hiking***Ex-Google.**")).toBe("Loves hikingEx-Google.");
  });

  it("send-416: two adjacent bold segments (run of exactly 4) still strip correctly, unaffected by the collapse threshold", () => {
    expect(stripInlineMarkdown("**Ex-Google.****Ex-Paystack.**")).toBe("Ex-Google.Ex-Paystack.");
  });
});

/**
 * send-369 — mentor bio is the ONE minimal-grammar consumer that also wants
 * a bare-https:// autolink (a portfolio/LinkedIn link), added as an opt-in
 * `{ linkable: true }` on top of this same shared plumbing rather than a
 * second component or a resurrection of RichMarkdownEditor's own removed
 * `toolbar="minimal"` mode (see that file's own header on the real bug that
 * mode had). Every test above this block passes no such option and must
 * stay completely unaffected — the first two tests here just re-confirm
 * that explicitly.
 */
describe("minimal grammar, linkable variant (send-369 mentor bio)", () => {
  function roundTripLinkable(markdown: string): string {
    return minimalDocToMarkdown(minimalMarkdownToDoc(markdown, { linkable: true }));
  }

  it("non-linkable callers are unaffected: a bare URL is plain text, never a link mark", () => {
    const md = "Portfolio: https://example.com/jane";
    expect(roundTripLinkable(md)).toBe(md); // sanity: also true for linkable
    expect(minimalDocToMarkdown(minimalMarkdownToDoc(md))).toBe(md); // the real assertion: default (non-linkable) path
    const doc = minimalMarkdownToDoc(md);
    const hasLinkMark = doc.content?.[0]?.content?.some((n) => n.marks?.some((m) => m.type === "link"));
    expect(hasLinkMark).toBeFalsy();
  });

  it("a bare https:// URL becomes a link mark and round-trips byte-for-byte", () => {
    const doc = minimalMarkdownToDoc("Portfolio: https://example.com/jane", { linkable: true });
    const hasLinkMark = doc.content?.[0]?.content?.some((n) => n.marks?.some((m) => m.type === "link"));
    expect(hasLinkMark).toBe(true);
    expect(minimalDocToMarkdown(doc)).toBe("Portfolio: https://example.com/jane");
  });

  it("bold + italic + a bare URL all round-trip together, byte-for-byte", () => {
    const md = "Ex-**Paystack** engineering manager. *Loves* mock interviews — portfolio at https://example.com/jane.";
    expect(roundTripLinkable(md)).toBe(md);
  });

  it("SAFETY: a link mark whose href disagrees with its own text never emits the href — plain text only", () => {
    // Constructs the doc directly rather than through the parser, since the
    // parser itself can never produce a mismatched mark — this proves the
    // SERIALIZER's own guard, matching employer/markdown-editor/document.ts's
    // identical test for the full-grammar editor.
    const maliciousDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Click here", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
          ],
        },
      ],
    };
    expect(minimalDocToMarkdown(maliciousDoc)).toBe("Click here");
    expect(minimalDocToMarkdown(maliciousDoc)).not.toContain("javascript:");
  });

  it("renderMarkdownParagraphs with autoLinkUrls renders a real <a href>, matching the linkClassName", () => {
    const html = renderToStaticMarkup(
      <>
        {renderMarkdownParagraphs("Portfolio: https://example.com/jane", "bio-class", {
          autoLinkUrls: true,
          linkClassName: "link-class",
        })}
      </>,
    );
    expect(html).toContain('<a href="https://example.com/jane"');
    expect(html).toContain('class="link-class"');
  });

  it("renderMarkdownParagraphs without autoLinkUrls never produces an <a>, even for a bare URL", () => {
    const html = renderToStaticMarkup(<>{renderMarkdownParagraphs("Portfolio: https://example.com/jane")}</>);
    expect(html).not.toContain("<a ");
    expect(html).toContain("https://example.com/jane");
  });
});
