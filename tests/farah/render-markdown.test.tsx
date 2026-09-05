/**
 * renderFarahMarkdown — the small, explicitly-limited subset the Farah panel
 * renders replies through: bold, italic, unordered/ordered lists, paragraph
 * breaks, and nothing else.
 *
 * This is UNTRUSTED MODEL OUTPUT rendered into a signed-in user's session, so
 * the tests are split into two kinds: the supported subset renders as real
 * elements, and everything outside it renders as inert text rather than
 * markup — checked here by asserting the DANGEROUS element (`<a>`) never
 * appears, not just that the happy path looks right.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderFarahMarkdown } from "@/lib/farah/render-markdown";

function render(content: string): string {
  return renderToStaticMarkup(<>{renderFarahMarkdown(content)}</>);
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

  it("a heading marker renders as literal text, not a heading element", () => {
    const html = render("# Not actually a heading");
    expect(html).not.toMatch(/<h[1-6]/);
    expect(html).toContain("# Not actually a heading");
  });

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

  it("a blockquote marker renders as literal text", () => {
    const html = render("> not a blockquote");
    expect(html).not.toContain("<blockquote");
    expect(html).toContain("&gt; not a blockquote");
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
