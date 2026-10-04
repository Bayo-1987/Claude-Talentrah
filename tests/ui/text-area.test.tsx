/**
 * The shared TextArea (S1-56 PR 1): one writing box for every multi-line field.
 *
 * What it promises, each pinned below on the real markup:
 *   - a visible label tied to the box (htmlFor/id), optional help text and an error state wired with aria-describedby / aria-invalid;
 *   - at least 4 visible rows, a visible resize handle (resize-y), optional auto-grow;
 *   - a character counter ("120 / 600") when there is a limit, counting the way the SERVER counts (trimmed), with a HARD limit (the
 *     browser's maxLength, so no more can be typed) or a SOFT one (nothing blocked, a plain note once over);
 *   - the same frame as the bold/italic editor, so every writing surface is one family;
 *   - id, name and every other attribute pass through untouched, so e2e selectors and server-action payloads do not change.
 * Static markup only (no DOM library in this repo): behaviour that needs typing is in e2e/text-area.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TextArea } from "@/components/ui/text-area";
import { WRITING_BOX_FRAME } from "@/components/ui/writing-box";

const html = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(TextArea, { label: "Your message", name: "message", ...props } as never));
const textarea = (markup: string) => /<textarea\b[^>]*>/.exec(markup)![0];

describe("label, help and error", () => {
  it("the label is tied to the box by htmlFor and id (id defaults to name)", () => {
    const m = html({});
    expect(m).toMatch(/<label[^>]*for="message"/);
    expect(textarea(m)).toContain('id="message"');
    expect(m).toContain("Your message");
  });

  it("an explicit id wins over the name, and name is passed through", () => {
    const t = textarea(html({ id: "report-details", name: "details" }));
    expect(t).toContain('id="report-details"');
    expect(t).toContain('name="details"');
  });

  it("help text is connected with aria-describedby", () => {
    const m = html({ help: "Say what happened." });
    expect(m).toContain("Say what happened.");
    const describedBy = /aria-describedby="([^"]+)"/.exec(textarea(m))![1];
    expect(m).toContain(`id="${describedBy.split(" ")[0]}"`);
  });

  it("an error shows, is described and marks the box invalid", () => {
    const m = html({ error: "Add a few words." });
    expect(m).toContain("Add a few words.");
    expect(textarea(m)).toContain('aria-invalid="true"');
    expect(textarea(m)).toMatch(/aria-describedby="[^"]*-error/);
  });

  it("hideLabel keeps the label for assistive technology but not on screen", () => {
    const m = html({ hideLabel: true });
    expect(/<label[^>]*class="[^"]*sr-only/.test(m)).toBe(true);
  });
});

describe("it looks like a writing box, not a one-line input", () => {
  it("shows at least 4 rows by default and never fewer, whatever is asked", () => {
    expect(textarea(html({}))).toContain('rows="4"');
    expect(textarea(html({ minRows: 7 }))).toContain('rows="7"');
    expect(textarea(html({ minRows: 2 }))).toContain('rows="4"');
  });

  it("has a visible resize handle and the shared frame", () => {
    const t = textarea(html({}));
    expect(t).toContain("resize-y");
    for (const cls of WRITING_BOX_FRAME.split(" ")) expect(t, `frame class ${cls}`).toContain(cls);
  });

  it("auto-grow is opt-in and does not remove the handle", () => {
    expect(textarea(html({}))).not.toContain("data-autogrow");
    const t = textarea(html({ autoGrow: true }));
    expect(t).toContain('data-autogrow="true"');
    expect(t).toContain("resize-y");
  });

  it("the monospace variant (markdown source) changes only the font", () => {
    expect(textarea(html({ mono: true }))).toContain("font-mono");
    expect(textarea(html({}))).not.toContain("font-mono");
  });
});

describe("the character counter", () => {
  it("no limit, no counter", () => {
    expect(html({})).not.toMatch(/\d+ \/ \d+/);
  });

  it("shows 'N / LIMIT' from the starting value, counted the way the server counts (trimmed)", () => {
    expect(html({ limit: 600, defaultValue: "hello" })).toContain("5 / 600");
    expect(html({ limit: 600, defaultValue: "  hello  " })).toContain("5 / 600");
    expect(html({ limit: 600, value: "abc", onChange: () => {} })).toContain("3 / 600");
  });

  it("a hard limit is the browser's own maxLength, so nothing more can be typed", () => {
    expect(textarea(html({ limit: 600 }))).toContain('maxLength="600"');
  });

  it("a soft limit blocks nothing and says so once over", () => {
    const over = html({ limit: 10, soft: true, defaultValue: "x".repeat(25), softNote: "Only the first 10 characters are used." });
    expect(textarea(over)).not.toContain("maxLength");
    expect(over).toContain("25 / 10");
    expect(over).toContain("Only the first 10 characters are used.");
    expect(html({ limit: 10, soft: true, defaultValue: "short", softNote: "Only the first 10 characters are used." })).not.toContain("Only the first 10");
  });

  it("a hard limit with a saved value already over it still shows it, and says how far over", () => {
    const over = html({ limit: 5, defaultValue: "abcdefgh" });
    expect(over).toContain("8 / 5");
    expect(over).toMatch(/3 over/);
  });

  it("the counter is described to assistive technology, and is not read out on every keystroke", () => {
    const m = html({ limit: 600, defaultValue: "hello" });
    expect(m).toMatch(/aria-describedby="[^"]*-count/);
    expect(m).not.toMatch(/aria-live="assertive"/);
  });
});

describe("it passes everything else through", () => {
  it("required, placeholder, defaultValue and custom attributes survive", () => {
    const t = textarea(html({ required: true, placeholder: "Write here", "data-testid": "x", defaultValue: "kept" }));
    expect(t).toContain("required");
    expect(t).toContain('placeholder="Write here"');
    expect(t).toContain('data-testid="x"');
    expect(html({ defaultValue: "kept" })).toContain(">kept</textarea>");
  });
});

describe("for a global audience", () => {
  it("lets the browser decide the text direction, so Arabic and Hebrew align correctly", () => {
    expect(textarea(html({}))).toContain('dir="auto"');
  });

  it("is at least 16px on a phone, so iOS does not zoom the page on focus (15px only from the sm breakpoint)", () => {
    const frame = WRITING_BOX_FRAME.split(" ");
    expect(frame).toContain("text-[16px]");
    expect(frame).toContain("sm:text-[15px]");
    expect(frame).not.toContain("text-[15px]");
    expect(textarea(html({ mono: true }))).toMatch(/text-\[16px\]/);
  });

  it("announces the count politely and only at thresholds: a polite status region, never assertive, and the count text itself is not live", () => {
    const m = html({ limit: 100, defaultValue: "x".repeat(85) });
    expect(m).toMatch(/role="status"[^>]*aria-live="polite"|aria-live="polite"[^>]*role="status"/);
    expect(m).not.toContain('aria-live="assertive"');
    expect(/id="message-count"[^>]*aria-live/.test(m)).toBe(false);
  });

  it("has a visible place for the message shown when a paste is refused", () => {
    expect(html({ limit: 100 })).toContain('data-paste-message');
  });

  it("an autosizing box starts as tall as its starting text, so growing does not shift the page", () => {
    const text = Array.from({ length: 9 }, (_, i) => `line ${i}`).join("\n");
    expect(textarea(html({ autoGrow: true, defaultValue: text }))).toContain('rows="9"');
    expect(textarea(html({ autoGrow: true, defaultValue: "one line" }))).toContain('rows="4"');
    expect(textarea(html({ defaultValue: text }))).toContain('rows="4"');
  });
});

it("the refused-paste message and the counter never say characters (an emoji counts as two)", () => {
  const src = readFileSync(path.join(__dirname, "../../src/components/ui/text-area.tsx"), "utf8");
  expect(src).not.toMatch(/too long, so nothing was added/);
  expect(src).toMatch(/over the limit, so nothing was added/);
  expect(/characters/i.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""))).toBe(false);
});

it("a refused paste is wired up: the box handles paste, asks pasteVerdict, cancels the paste and shows the message", () => {
  const src = readFileSync(path.join(__dirname, "../../src/components/ui/text-area.tsx"), "utf8");
  expect(src).toMatch(/onPaste=\{/);
  expect(src).toMatch(/pasteVerdict\(/);
  expect(src).toMatch(/e\.preventDefault\(\)/);
  expect(src).toMatch(/setPasteMessage\(/);
});

it("dropping text is handled like pasting: the box handles drop, asks dropVerdict, cancels it and shows the message", () => {
  const src = readFileSync(path.join(__dirname, "../../src/components/ui/text-area.tsx"), "utf8");
  expect(src).toMatch(/onDrop=\{/);
  expect(src).toMatch(/dropVerdict\(/);
});
