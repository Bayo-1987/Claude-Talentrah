/**
 * The grader's feedback (and a human reviewer's note, which is stored in the same column) is shown to the person in their verification history.
 * That text is model output, and a person can influence it through their own resume, so it must render as TEXT: no clickable link, no HTML.
 *
 * The page renders it with renderInlineMarkdown(h.feedback), the same small helper the rest of the app uses for text it does not control. That helper has bold and italic marks only:
 * a markdown link is left as the literal characters, a bare URL is not turned into a link unless the caller opts in (autoLinkUrls), and an HTML tag becomes a text node, which React escapes.
 * So the honest description is "plain text, with bold and italic marks", not "no formatting at all". These tests pin the parts that matter for safety, and that the page uses the helper
 * with no opt-in and has no other way in (no dangerouslySetInnerHTML, no anchor) in the feedback block.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderInlineMarkdown } from "@/lib/farah/render-markdown";

const html = (text: string) => renderToStaticMarkup(<p>{renderInlineMarkdown(text)}</p>);

describe("feedback is rendered as text: no link, no HTML", () => {
  it("a markdown link stays the literal characters: no anchor, no href", () => {
    const out = html("See [your report](https://evil.example/phish) for details.");
    expect(out).not.toMatch(/<a[\s>]/i);
    expect(out).not.toMatch(/href/i);
    expect(out).toContain("[your report](https://evil.example/phish)");
  });

  it("a bare URL is text, not a link (no autolink is switched on for this page)", () => {
    const out = html("Visit https://evil.example/phish now.");
    expect(out).not.toMatch(/<a[\s>]/i);
    expect(out).not.toMatch(/href/i);
    expect(out).toContain("https://evil.example/phish");
  });

  it("an HTML tag is escaped: no element is created, the characters show", () => {
    const out = html('Click <a href="https://evil.example">here</a> <img src=x onerror=alert(1)> <script>alert(1)</script>');
    expect(out).not.toMatch(/<a[\s>]/i);
    expect(out).not.toMatch(/<img/i);
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain("&lt;a href=");
    expect(out).toContain("&lt;script&gt;");
  });

  it("a javascript: link and an image in markdown syntax are text too", () => {
    const out = html("[x](javascript:alert(1)) ![pic](https://evil.example/p.png)");
    expect(out).not.toMatch(/<a[\s>]|<img|href|src=/i);
  });

  it("all of those in one piece of feedback produce only text, bold and italic marks, and nothing clickable", () => {
    const out = html("**Note:** [link](https://a.example) https://b.example <b onclick=x>tag</b> *and* more");
    const tags = [...out.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase());
    expect(tags.every((t) => ["p", "strong", "em"].includes(t))).toBe(true); // an escaped "<b onclick=x>" is text, so it makes no element
    expect(out).not.toMatch(/href|<a[\s>]/i);
    expect(out).toContain("&lt;b onclick=x&gt;");
  });
});

describe("the page uses that helper with no opt-in, and nothing else, for the feedback", () => {
  const page = readFileSync(join(__dirname, "../../src/app/(app)/talent-directory/verify/page.tsx"), "utf8");
  const block = page.slice(page.indexOf("{h.feedback &&"), page.indexOf("</BorderedCard>", page.indexOf("{h.feedback &&")));

  it("renders h.feedback through renderInlineMarkdown(h.feedback) and nothing else", () => {
    expect(block).toContain("renderInlineMarkdown(h.feedback)");
    expect(block).not.toMatch(/autoLinkUrls/);
  });

  it("the feedback block has no anchor, no Link and no dangerouslySetInnerHTML", () => {
    expect(block.length).toBeGreaterThan(20);
    expect(block).not.toMatch(/<a[\s>]|<Link|dangerouslySetInnerHTML/);
  });

  it("no part of the verify page sets inner HTML", () => {
    expect(page).not.toMatch(/dangerouslySetInnerHTML/);
  });
});
