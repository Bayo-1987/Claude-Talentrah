/**
 * Chip layout, option E (owner, 7 Oct 2026; proposal reports/S1/2026-10-07-1640-chip-density-proposal.md): the chips are STARTERS, so
 *  - before a chat starts: at most 3 chips, and a "More questions" row for any beyond that;
 *  - once a chat has started: ONE row ("Ask about this page" on a page's own chips, "Quick questions" otherwise) that opens the chips, so the conversation keeps its room;
 *  - no per-chip cost line: the allowance line above states the price once, and each chip points at it (aria-describedby) so a screen reader still hears it.
 * Static render (the repo has no DOM test environment): the collapsed/capped states are props, the open state is the e2e (e2e/farah-chips-layout.spec.ts).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let path: string | null = null;
vi.mock("next/navigation", () => ({ usePathname: () => path, useSearchParams: () => new URLSearchParams() }));

const { FarahPanel } = await import("@/components/app-shell/farah-panel");
const { FarahAllowanceNote, FarahQuickActions, MAX_CHIPS_BEFORE_MORE } = await import("@/components/app-shell/farah-quick-actions");
const noop = () => {};
const chips = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `chip-${i + 1}`, label: `Question number ${i + 1}?` }));
// `free` is passed explicitly when it matters (a default parameter would turn an explicit `undefined` into 2); omitted means 2 free messages left.
const render = (n: number, props: Record<string, unknown> = {}, ...free: Array<number | null | undefined>) =>
  renderToStaticMarkup(<FarahQuickActions freeRemaining={free.length ? free[0] : 2} actions={chips(n)} pending={false} onSend={noop} onPrefill={noop} {...props} />);
const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());

describe("before a chat starts: at most three chips, then More", () => {
  it("the cap is three", () => expect(MAX_CHIPS_BEFORE_MORE).toBe(3));
  it("three chips show as three chips, with no More row", () => {
    expect(buttons(render(3))).toEqual(["Question number 1?", "Question number 2?", "Question number 3?"]);
  });
  it("two chips show as two", () => expect(buttons(render(2))).toEqual(["Question number 1?", "Question number 2?"]));
  it("five chips show the first three and a 'More questions' row; the other two are not in the page yet", () => {
    const html = render(5);
    expect(buttons(html)).toEqual(["Question number 1?", "Question number 2?", "Question number 3?", "More questions"]);
    expect(html).not.toContain("Question number 4?");
    expect(html).not.toContain("Question number 5?");
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>More questions/);
  });
});

describe("once a chat has started: one row that opens the chips", () => {
  it("shows only the row, closed, and none of the chips", () => {
    const html = render(3, { collapsed: true, collapsedLabel: "Ask about this page" });
    expect(buttons(html)).toEqual(["Ask about this page"]);
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>Ask about this page/);
    for (const i of [1, 2, 3]) expect(html).not.toContain(`Question number ${i}?`);
  });
  it("with more than three chips the collapsed view is still ONE row (no More row beside it)", () => {
    expect(buttons(render(5, { collapsed: true }))).toEqual(["Quick questions"]);
  });
  it("the row's label is the caller's; the default is 'Quick questions'", () => {
    expect(buttons(render(3, { collapsed: true }))).toEqual(["Quick questions"]);
  });
  it("the row is a real 44 px target (checked on the row itself, not on a chip)", () => {
    const row = [...render(3, { collapsed: true }).matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)].find((m) => m[2].replace(/<[^>]+>/g, "").trim() === "Quick questions");
    expect(row, "the row exists").toBeTruthy();
    expect(row![1]).toMatch(/class="[^"]*\bmin-h-11\b/);
  });
});

describe("no per-chip cost line", () => {
  it.each([[2], [0], [null], [undefined]])("freeRemaining %s: no cost text and no cost ids anywhere", (free) => {
    const html = render(3, {}, free as number | null | undefined);
    const text = html.replace(/<[^>]+>/g, " ");
    expect(html).not.toContain("farah-chip-cost-");
    expect(text).not.toMatch(/\bfree\b|credit|Pass\b/i);
  });
});

describe("each chip points at the allowance line, so the price is still announced", () => {
  it("the note carries the id the chips reference", () => {
    expect(renderToStaticMarkup(<FarahAllowanceNote freeRemaining={2} />)).toMatch(/<p id="farah-allowance-note"/);
    expect(renderToStaticMarkup(<FarahAllowanceNote freeRemaining={0} />)).toMatch(/<p id="farah-allowance-note"/);
  });
  it("when the line is shown, every chip button describes itself with it", () => {
    for (const free of [2, 0]) {
      const html = render(3, {}, free);
      expect(html.match(/aria-describedby="farah-allowance-note"/g)?.length, `free ${free}`).toBe(3);
    }
  });
  it("when the line is not shown (a Pass, or the count not known yet) the chips point at nothing", () => {
    for (const free of [null, undefined]) {
      expect(render(3, {}, free)).not.toContain("aria-describedby");
      expect(renderToStaticMarkup(<FarahAllowanceNote freeRemaining={free} />)).toBe("");
    }
  });
});

describe("what a chip is, unchanged", () => {
  it("a chip with a link stays a link, and the buttons are disabled while the count loads or a reply is pending", () => {
    const withLink = renderToStaticMarkup(<FarahQuickActions freeRemaining={2} actions={[{ key: "a", label: "Open a page", href: "/billing" }, ...chips(1)]} pending={false} onSend={noop} onPrefill={noop} />);
    expect(withLink).toMatch(/<a [^>]*href="\/billing"[^>]*>Open a page<\/a>/);
    expect(render(2, { allowanceLoading: true }).match(/<button[^>]*disabled=""/g)?.length).toBe(2);
    expect(render(2, { pending: true }).match(/<button[^>]*disabled=""/g)?.length).toBe(2);
  });
  it("every chip button and every link chip keeps a 44 px target", () => {
    expect([...render(3).matchAll(/<button[^>]*class="([^"]*)"/g)].every((m) => /\bmin-h-11\b/.test(m[1]))).toBe(true);
    const link = renderToStaticMarkup(<FarahQuickActions freeRemaining={2} actions={[{ key: "a", label: "Open a page", href: "/billing" }]} pending={false} onSend={noop} onPrefill={noop} />);
    expect(link).toMatch(/<a [^>]*class="[^"]*\bmin-h-11\b[^"]*"[^>]*>Open a page<\/a>/);
  });
  it("a click sends while the message is free and prefills once it would cost credits (the decision is quickActionMode's; the click only routes it)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/app-shell/farah-quick-actions.tsx", "utf8").replace(/\s+/g, " ");
    expect(src).toMatch(/if \(mode === "send"\) onSend\(key\); else onPrefill\(key\);/);
  });
});

describe("the panel passes the chat state down (the arrival view versus a conversation)", () => {
  const OLD_TURN = { id: "m1", role: "user" as const, content: "Hello Farah", created_at: "2026-10-07T10:00:00.000Z" };
  it("no messages yet: the page's own chips are listed", () => {
    path = "/billing";
    const html = renderToStaticMarkup(<FarahPanel firstName="Ada" initialMessages={[]} />);
    expect(html).toContain("What can I do with my credits?");
    expect(html).not.toContain("Ask about this page");
  });
  it("a conversation exists: the chips collapse to 'Ask about this page' on a page's own chips", () => {
    path = "/billing";
    const html = renderToStaticMarkup(<FarahPanel firstName="Ada" initialMessages={[OLD_TURN]} />);
    expect(html).toContain("Ask about this page");
    expect(html).not.toContain("What can I do with my credits?");
  });
  it("a conversation on an unlisted route collapses to 'Quick questions'", () => {
    path = "/settings";
    const html = renderToStaticMarkup(<FarahPanel firstName="Ada" initialMessages={[OLD_TURN]} />);
    expect(html).toContain("Quick questions");
    expect(html).not.toContain("Job Interview Prep");
  });
});
