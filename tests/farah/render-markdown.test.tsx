/**
 * renderFarahMarkdown — the small, explicitly-limited subset the Farah panel
 * renders replies through: bold, italic, unordered/ordered lists, paragraph
 * breaks, headings, horizontal rules, blockquotes, and nothing else.
 *
 * This is UNTRUSTED MODEL OUTPUT rendered into a signed-in user's session, so
 * the tests are split into two kinds: the supported subset renders as real
 * elements, and everything outside it renders as inert text rather than
 * markup — checked here by asserting the DANGEROUS elements (`<a>`, `<img>`)
 * never appear, not just that the happy path looks right. Headings, rules
 * and blockquotes moved from the second group to the first when a
 * system-prompt-only fix for them was tried and falsified live on
 * production — see render-markdown.tsx's own header for why.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderFarahMarkdown, renderJobDescriptionMarkdown } from "@/lib/farah/render-markdown";
import { stripHtml } from "@/lib/jobs/extract-jd";

function render(content: string): string {
  return renderToStaticMarkup(<>{renderFarahMarkdown(content)}</>);
}

function renderJobDescription(content: string): string {
  return renderToStaticMarkup(<>{renderJobDescriptionMarkdown(content)}</>);
}

describe("the supported subset renders as real elements", () => {
  it("renders bold", () => {
    const html = render("**Making a pivot?**");
    expect(html).toContain("<strong>Making a pivot?</strong>");
    expect(html).not.toContain("**");
  });

  it("renders italic via single asterisks", () => {
    const html = render("This is *quietly* important.");
    expect(html).toContain("<em>quietly</em>");
  });

  it("renders italic via underscores", () => {
    const html = render("This is _quietly_ important.");
    expect(html).toContain("<em>quietly</em>");
  });

  it("renders an unordered list", () => {
    const html = render("Two options:\n* Rewrite the summary\n* Reorder your experience");
    expect(html).toContain("<ul");
    expect(html).toContain("<li>Rewrite the summary</li>");
    expect(html).toContain("<li>Reorder your experience</li>");
  });

  it("renders an unordered list with a hyphen marker", () => {
    const html = render("- First\n- Second");
    expect(html).toContain("<li>First</li>");
    expect(html).toContain("<li>Second</li>");
  });

  it("renders an ordered list", () => {
    const html = render("1. Update your title\n2. Add a metric to the second bullet");
    expect(html).toContain("<ol");
    expect(html).toContain("<li>Update your title</li>");
    expect(html).toContain("<li>Add a metric to the second bullet</li>");
  });

  it("renders a paragraph break as two separate paragraphs", () => {
    const html = render("First paragraph.\n\nSecond paragraph.");
    const paragraphs = html.match(/<p[^>]*>/g) ?? [];
    expect(paragraphs.length).toBe(2);
    expect(html).toContain(">First paragraph.<");
    expect(html).toContain(">Second paragraph.<");
  });

  it("does not confuse a list marker with italic — '* item' is a list, not emphasis", () => {
    // A single `*` followed by a space is the list marker; italic is `*word*`
    // with no space. Getting this backwards would either break every list or
    // stop recognising a leading italic word.
    const html = render("* Try a shorter summary");
    expect(html).toContain("<li>Try a shorter summary</li>");
    expect(html).not.toContain("<em>");
  });

  it("keeps the same visual face lists inherit from the paragraph text — no separate style introduced", () => {
    const html = render("* one\n* two");
    const ulOpenTag = html.match(/<ul[^>]*>/)?.[0] ?? "";
    expect(ulOpenTag).toContain("italic");
    expect(ulOpenTag).toContain("font-display");
  });

  it("renders a heading as bold text, not a heading element", () => {
    const html = render("### 1. Capture the current offer");
    expect(html).not.toMatch(/<h[1-6]/);
    expect(html).toMatch(/<p[^>]*>1\. Capture the current offer<\/p>/);
    expect(html).not.toContain("#");
  });

  it("renders every heading level (1-6 #s) identically, as bold text at one size", () => {
    for (const marker of ["#", "##", "###", "####", "#####", "######"]) {
      const html = render(`${marker} Same treatment`);
      expect(html).toMatch(/<p[^>]*>Same treatment<\/p>/);
      expect(html).not.toContain(marker + " Same");
    }
  });

  it("does not treat a bare '#' with no following space as a heading", () => {
    const html = render("#trending is not a heading marker");
    expect(html).toContain("#trending is not a heading marker");
    expect(html).not.toMatch(/<p[^>]*>trending/);
  });

  it("renders a bare '---' line as a rule, not literal text", () => {
    const html = render("Before.\n---\nAfter.");
    expect(html).toContain("<hr");
    expect(html).not.toContain("---");
  });

  it("does not treat a two-hyphen line as a rule", () => {
    const html = render("--");
    expect(html).not.toContain("<hr");
    expect(html).toContain("--");
  });

  it("renders a blockquote with an indent/border, keeping the panel's italic face", () => {
    const html = render('> "Thank you for the offer. I\'m excited about this role."');
    expect(html).not.toContain("&gt;");
    expect(html).toContain("Thank you for the offer");
    const quoteTag = html.match(/<p[^>]*>[^<]*Thank you for the offer[^]*?<\/p>/)?.[0] ?? "";
    expect(quoteTag).toContain("italic");
    expect(quoteTag).toContain("border-l");
  });

  it("joins consecutive blockquote lines into one quote block", () => {
    const html = render("> First line\n> Second line");
    const paragraphs = html.match(/<p[^>]*>/g) ?? [];
    expect(paragraphs.length).toBe(1);
    expect(html).toContain("First line Second line");
  });
});

describe("anything outside the subset renders as plain text, not markup", () => {
  it(
    "SABOTAGE-PROOF TARGET: a javascript: URL in link syntax never becomes an anchor",
    () => {
      const html = render("[Click here](javascript:alert(document.cookie))");
      expect(html).not.toContain("<a ");
      expect(html).not.toContain("<a>");
      expect(html).not.toMatch(/href\s*=/);
      // The literal characters are still visible as inert text — dropped
      // from being markup, not disappeared from the reply entirely. That
      // includes the javascript: string itself: it is exactly as dangerous
      // as any other plain text on the page, which is to say not at all,
      // because there is no href attribute anywhere for it to occupy.
      expect(html).toContain("Click here");
      expect(html).toContain("javascript:alert");
    },
  );

  it("an inline code span renders as literal text, not a <code> element", () => {
    const html = render("Run `npm install` first.");
    expect(html).not.toContain("<code");
    expect(html).toContain("`npm install`");
  });

  it("raw HTML in the reply is never parsed as an element", () => {
    const html = render("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<img");
    // React's text-node escaping turns the literal angle brackets into
    // entities — the point is that no <img> element exists in the output,
    // checked above; this just confirms the source text still reads through.
    expect(html).toContain("onerror=alert(1)");
  });

  it("a markdown table renders as literal pipe-and-dash text, never a <table>", () => {
    const html = render("| Component | Value |\n|---|---|\n| Base | 100 |");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("<hr");
    expect(html).toContain("| Component | Value |");
  });

  it(
    "SABOTAGE-PROOF TARGET: raw HTML inside a heading is still never parsed as an element",
    () => {
      const html = render("# <img src=x onerror=alert(1)>");
      expect(html).not.toContain("<img");
      expect(html).toContain("onerror=alert(1)");
    },
  );

  it(
    "SABOTAGE-PROOF TARGET: link syntax inside a blockquote never becomes an anchor",
    () => {
      const html = render("> [Click here](javascript:alert(1))");
      expect(html).not.toContain("<a ");
      expect(html).not.toMatch(/href\s*=/);
      expect(html).toContain("Click here");
    },
  );
});

/**
 * renderJobDescriptionMarkdown — the same parse/render engine as
 * renderFarahMarkdown above, a different (non-italic, larger) visual face,
 * now driving the job detail page's "Full description" block
 * (src/app/(app)/jobs/[id]/page.tsx) instead of a raw `whitespace-pre-line`
 * text dump. Exercised here end-to-end through `stripHtml`
 * (src/lib/jobs/extract-jd.ts), the same way the real page does: raw
 * ATS-shaped HTML in, rendered React elements out — because the bug this
 * guards against (a blank line between every bullet) is a property of the
 * two functions working TOGETHER, not of either one read in isolation.
 */
describe("renderJobDescriptionMarkdown — the job detail page's own use of this renderer", () => {
  it("SABOTAGE-PROOF TARGET: a <li><p>text</p></li> source produces one bullet line with no blank line before the next bullet", () => {
    const html = "<ul><li><p>First item</p></li><li><p>Second item</p></li></ul>";
    const html2 = renderJobDescription(stripHtml(html));
    expect(html2).toContain("<li>First item</li>");
    expect(html2).toContain("<li>Second item</li>");
    // Both items landed in the SAME <ul> — a blank line between them in the
    // underlying text would have split them into two separate lists, which
    // is exactly the "double-spaced wall of dots" this fixes.
    expect((html2.match(/<ul/g) ?? []).length).toBe(1);
  });

  it("a <strong> sub-header renders visibly bold, not as plain inline text", () => {
    const html = "<p><strong>Program &amp; Curriculum Development</strong></p><p>Body text.</p>";
    const html2 = renderJobDescription(stripHtml(html));
    expect(html2).toContain("<strong>Program &amp; Curriculum Development</strong>");
    expect(html2).not.toContain("**");
  });

  it(
    "SABOTAGE-PROOF TARGET: nothing this renders can produce an <a>, an <img>, or reach dangerouslySetInnerHTML — same guarantee renderFarahMarkdown already enforces for Farah's panel",
    () => {
      const html =
        '<li><p><a href="javascript:alert(1)">Click here</a></p></li>' +
        "<li><p><img src=x onerror=alert(1)></p></li>";
      const html2 = renderJobDescription(stripHtml(html));
      expect(html2).not.toContain("<a ");
      expect(html2).not.toContain("<a>");
      expect(html2).not.toContain("<img");
      expect(html2).not.toMatch(/href\s*=/);
      // The posting's own link text is still visible as inert text, same as
      // renderFarahMarkdown's guarantee above — dropped from being markup,
      // not disappeared from the description entirely.
      expect(html2).toContain("Click here");
    },
  );

  it("uses the detail page's own (non-italic) face, not Farah's", () => {
    const html2 = renderJobDescription("Plain paragraph.");
    expect(html2).not.toContain("italic");
    expect(html2).toContain("text-ink-soft");
  });
});

describe("edge cases", () => {
  it("falls back to the plain string for blank input rather than throwing", () => {
    expect(() => render("")).not.toThrow();
    expect(() => render("   ")).not.toThrow();
  });

  it("handles a message that mixes a paragraph, a list and bold", () => {
    const html = render(
      "**Making a pivot?**\n\nHere's how to reframe your experience:\n1. Lead with transferable skills\n2. Name the target role explicitly",
    );
    expect(html).toContain("<strong>Making a pivot?</strong>");
    expect(html).toContain("<li>Lead with transferable skills</li>");
    expect(html).toContain("<li>Name the target role explicitly</li>");
  });
});
