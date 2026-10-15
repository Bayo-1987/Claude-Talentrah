/**
 * The written answer is PLAIN TEXT: escaped, never HTML, never markdown; long text wraps. Rendered directly (no database).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AssessmentResponseView, clickableResponseLink } from "@/components/employer/assessment-response-view";

const sub = (over: Partial<Parameters<typeof AssessmentResponseView>[0]["submission"]> = {}) => ({ responseText: "plain", responseLink: null, submittedAt: "2026-10-13T09:00:00Z", responseFiles: [], ...over });
const render = (over: Parameters<typeof sub>[0] = {}) => renderToStaticMarkup(<AssessmentResponseView applicantName="Joy Akindele" jobTitle="Growth Marketer" submission={sub(over)} />);
const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");

describe("the answer is escaped text, not HTML", () => {
  const hostile = `<script>alert(1)</script> <b>bold</b> & <img src=x onerror=alert(1)> **not markdown** [a](http://x.test)`;
  const html = render({ responseText: hostile });
  it("script, b and img print as characters, and & is escaped", () => {
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>bold");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(html).toContain("&amp;");
  });
  it("is not rendered as markdown: the asterisks and the link syntax stay as typed, and no anchor is made from them", () => {
    expect(html).toContain("**not markdown**");
    expect(html).toContain("[a](http://x.test)");
    expect(html).not.toContain('href="http://x.test"');
  });
  it("the component and the page never use dangerouslySetInnerHTML or a markdown renderer", () => {
    for (const file of ["src/components/employer/assessment-response-view.tsx", "src/app/employer/jobs/[id]/applicants/[applicationId]/assessment/page.tsx", "src/lib/employer/assessment-response.ts"]) {
      // Code only: the doc comments mention the rule by name.
      const source = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(source, file).not.toContain("dangerouslySetInnerHTML");
      expect(source, file).not.toMatch(/renderInlineMarkdown|marked|markdown-it|remark/i);
    }
  });
});

describe("long text wraps instead of scrolling sideways", () => {
  const long = "A".repeat(5000);
  const html = render({ responseText: long });
  it("a 5,000-character unbroken string is in the page in full, in an element that preserves line breaks and breaks long words", () => {
    expect(html).toContain(long);
    const answer = /<p data-testid="assessment-answer" class="([^"]*)"/.exec(html);
    expect(answer).not.toBeNull();
    expect(answer![1]).toContain("break-words");
    expect(answer![1]).toContain("whitespace-pre-wrap");
    expect(answer![1]).toContain("min-w-0");
  });
  it("its containers can shrink (min-w-0), so the text cannot push the page wider than a 320 px screen", () => {
    expect((html.match(/min-w-0/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(html).not.toMatch(/overflow-x-(scroll|auto)|whitespace-nowrap/);
  });
  it("keeps the candidate's line breaks as text (no <br> is made)", () => {
    const multi = render({ responseText: "line one\nline two" });
    expect(multi).toContain("line one\nline two");
    expect(multi).not.toContain("<br");
  });
});

describe("the response link: clickable only if it is a web address", () => {
  it("an http or https link becomes 'Open response link', in a new tab with rel noopener noreferrer", () => {
    for (const ok of ["https://example.test/work", "http://example.test/work", "HTTPS://EXAMPLE.TEST/work"]) {
      const html = render({ responseLink: ok });
      expect(html, ok).toContain(`href="${ok}"`);
      expect(html, ok).toContain("Open response link");
      expect(html, ok).toContain('rel="noopener noreferrer"');
      expect(html, ok).toContain('target="_blank"');
    }
  });
  it("javascript:, data:, ftp:, a bare word and a malformed address are shown as PLAIN TEXT: never an <a>, never an href", () => {
    for (const bad of ["javascript:alert(1)", "  javascript:alert(1)", "data:text/html,<b>x</b>", "ftp://x.test/file", "not a link at all", "https:evil.test", "https://"]) {
      const html = render({ responseText: "x", responseLink: bad });
      expect(html, bad).not.toContain("Open response link");
      expect(html, bad).not.toMatch(/<a [^>]*href="(javascript|data|ftp):/i);
      expect(html, bad).not.toMatch(new RegExp(`<a [^>]*href="${bad.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
      const plain = /<p data-testid="assessment-plain-link"[^>]*>([^<]*)<\/p>/.exec(html);
      expect(plain, `${bad}: shown as text`).not.toBeNull();
      expect(plain![1].replace(/&#x27;|&amp;|&lt;|&gt;/g, "?")).toContain(bad.trim().slice(0, 8).replace(/[&<>']/g, "?"));
    }
  });
  it("an empty or missing link shows nothing at all (no anchor, no text)", () => {
    for (const none of ["", "   ", null]) {
      const html = render({ responseText: "x", responseLink: none });
      expect(html, JSON.stringify(none)).not.toContain("<a ");
      expect(html, JSON.stringify(none)).not.toContain("assessment-plain-link");
      expect(html, JSON.stringify(none)).not.toContain("Open response link");
    }
  });
  it("clickableResponseLink: the same rule on its own", () => {
    expect(clickableResponseLink("https://example.test/x")).toBe("https://example.test/x");
    expect(clickableResponseLink("  http://example.test/x  ")).toBe("http://example.test/x");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "", "   ", null, undefined, "https:evil", "https://", "ftp://x.test", "//x.test", "x.test"]) expect(clickableResponseLink(bad as string), String(bad)).toBeNull();
  });
});

describe("the files", () => {
  it("a signed link is 'View response file: name', in a new tab with rel noopener noreferrer; a file whose link could not be made says so, with no link", () => {
    const html = render({ responseText: null, responseFiles: [{ url: "https://files.test/a?token=1", originalFilename: "answer.pdf" }, { url: null, originalFilename: "other.docx" }] });
    expect(html).toContain("View response file: answer.pdf");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("other.docx — couldn&#x27;t generate a link, try refreshing.");
    expect((html.match(/<a /g) ?? []).length).toBe(1);
  });
  it("every link on the page that leaves it carries rel noopener noreferrer (none without)", () => {
    const html = render({ responseLink: "https://example.test/work", responseFiles: [{ url: "https://files.test/a?token=1", originalFilename: "a.pdf" }, { url: "https://files.test/b?token=2", originalFilename: "b.pdf" }] });
    const anchors = html.match(/<a [^>]*>/g) ?? [];
    expect(anchors.length).toBe(3);
    for (const a of anchors) expect(a).toContain('rel="noopener noreferrer"');
  });
  it("an empty response says so; it is never a blank box", () => {
    expect(render({ responseText: null })).toContain("Empty response.");
  });
});

describe("what is shown about the person", () => {
  it("their name, the job and the submission time: no email, no phone", () => {
    const html = render();
    expect(html).toContain("Joy Akindele");
    expect(html).toContain("Growth Marketer");
    expect(html).toContain("Submitted ");
    expect(html).not.toMatch(/@|phone|mailto:|tel:/i);
  });
});
