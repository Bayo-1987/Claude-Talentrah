/**
 * Farah's REPLIES are regular body text (IBM Plex Sans), with italics only where the reply itself emphasises something (owner, 8 Oct): they used to be set in italic
 * Newsreader like an aside, which is hard to read at length on a phone. The asides keep their italic serif (the greeting, the allowance line, "Farah is thinking…",
 * the cut-off note, "Continue where you left off?"): CLAUDE.md reserves italic Newsreader for quiet, secondary text, and those are exactly that.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => null, useSearchParams: () => null }));
const { FarahPanel } = await import("@/components/app-shell/farah-panel");
const { renderFarahMarkdown } = await import("@/lib/farah/render-markdown");

const reply = (content: string) =>
  renderToStaticMarkup(<FarahPanel firstName="Ada" initialMessages={[{ id: "f1", role: "farah", content, created_at: "2026-01-01T00:00:00.000Z" }]} />);
const replyHtml = (html: string) => /<div data-testid="farah-message">[\s\S]*?<\/div><\/div>|<div data-testid="farah-message">[\s\S]*?<\/div>/.exec(html)![0];
const classesOf = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}[^>]*class="([^"]*)"`, "g"))].map((m) => m[1].split(/\s+/));

describe("a Farah reply is regular body text", () => {
  const html = renderToStaticMarkup(<>{renderFarahMarkdown("Here is a plain paragraph.\n\n- first point\n- second point\n\n> a quoted line")}</>);

  it("paragraphs, list items and quotes are IBM Plex (font-body), not Newsreader, and not italic", () => {
    for (const cls of [...classesOf(html, "p"), ...classesOf(html, "ul")]) {
      expect(cls, cls.join(" ")).toContain("font-body");
      expect(cls, cls.join(" ")).not.toContain("italic");
      expect(cls, cls.join(" ")).not.toContain("font-display");
    }
  });

  it("the reply text is the ink colour used for body text, and wraps a long unbroken word instead of widening the panel (360px)", () => {
    const [first] = classesOf(html, "p");
    expect(first).toContain("text-ink");
    expect(first.join(" ")).toMatch(/break-words|\[overflow-wrap:anywhere\]/);
  });

  it("emphasis inside a reply IS italic (an <em>), and bold is bold", () => {
    const out = renderToStaticMarkup(<>{renderFarahMarkdown("This is *really* important and **very** clear.")}</>);
    expect(out).toMatch(/<em[^>]*>really<\/em>/);
    expect(out).toMatch(/<strong[^>]*>very<\/strong>/);
  });

  it("the same holds in the panel: the reply container holds no italic or Newsreader class", () => {
    const reply1 = replyHtml(reply("Plain *emphasis* here."));
    expect(reply1).not.toMatch(/class="[^"]*\bitalic\b/);
    expect(reply1).not.toMatch(/class="[^"]*font-display/);
  });
});

describe("the asides keep their italic serif", () => {
  it("the greeting / allowance lines are still font-display italic", () => {
    const html = renderToStaticMarkup(<FarahPanel firstName="Ada" />);
    expect(html).toMatch(/font-display[^"]*italic/);
  });
});
