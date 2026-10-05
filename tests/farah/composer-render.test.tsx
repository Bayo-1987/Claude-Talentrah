/**
 * The Farah panel's message box as the page renders it (static markup; real typing is e2e): one labelled textbox with the name it always had, the same placeholder, the length limit and its counter, the disabled
 * state while a reply streams, a send button that stays 44px, and nothing that lets Enter submit the form by itself (Enter is handled by the box, once).
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FarahComposer } from "@/components/app-shell/farah-composer";
import { MAX_MESSAGE_LENGTH } from "@/lib/farah/token-budget";
import { COMPOSER_COUNTER_FROM } from "@/components/app-shell/farah-composer";
import { pasteVerdict } from "@/lib/text-counter";

const noop = () => {};
const html = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(FarahComposer, { value: "", onChange: noop, onSubmit: noop, onEnterSend: noop, pending: false, ...over } as never));
const box = (m: string) => /<textarea\b[^>]*>/.exec(m)![0];
const button = (m: string) => /<button\b[^>]*>/.exec(m)![0];

describe("one labelled textbox", () => {
  const m = html();
  it("exactly one textarea and no single-line text input", () => {
    expect(m.match(/<textarea\b/g)?.length).toBe(1);
    expect(m).not.toMatch(/<input\b/);
  });
  it("it keeps the name it had: 'Ask me anything…', now a real label (screen-reader only), tied to the box", () => {
    const id = /id="([^"]+)"/.exec(box(m))![1];
    expect(m).toMatch(new RegExp(`<label[^>]*for="${id}"[^>]*sr-only[^>]*>Ask me anything…</label>`));
  });
  it("the placeholder is unchanged", () => expect(box(m)).toMatch(/placeholder="Ask me anything…"/));
  it("starts as one row", () => expect(box(m)).toMatch(/rows="1"/));
  it("grows to a maximum height, then scrolls", () => {
    expect(box(m)).toMatch(/max-height:\d+px/);
    expect(box(m)).toContain("overflow-y-auto");
  });
});

describe("the length limit and its counter", () => {
  const m = html({ value: "a".repeat(1798) + "\nb" });
  it("the box carries the server's limit (2000) as its own maxLength", () => expect(box(m)).toContain(`maxLength="${MAX_MESSAGE_LENGTH}"`));
  it("the counter counts a line break as one: 1,798 'a', a break, 'b' is 1,800", () => expect(m).toContain(`1800 / ${MAX_MESSAGE_LENGTH}`));
  it("a limit that matches the server's, not a second number", () => expect(MAX_MESSAGE_LENGTH).toBe(2000));
});

describe("the counter appears only near the limit", () => {
  const withLength = (n: number) => html({ value: "a".repeat(n) });
  it("is not on the page at 0, 1 and 1,799 characters", () => {
    for (const n of [0, 1, 900, 1799]) {
      const m = withLength(n);
      expect(m, `${n}`).not.toContain(`${n} / ${MAX_MESSAGE_LENGTH}`);
      expect(m, `${n}`).not.toMatch(/\d+ \/ \d+/);
      expect(m, `${n}`).not.toContain("data-paste-message");
    }
  });
  it("is on the page at 1,800, 1,999 and 2,000 characters, as 'N / 2000'", () => {
    for (const n of [1800, 1999, 2000]) expect(withLength(n), `${n}`).toContain(`${n} / ${MAX_MESSAGE_LENGTH}`);
  });
  it("the threshold is 1,800 of the server's own 2,000 (90%), one number", () => expect(COMPOSER_COUNTER_FROM).toBe(1800));
  it("a hidden counter is not left as a dangling description: the box points at the counter only when the counter is there", () => {
    expect(box(withLength(1799))).not.toMatch(/aria-describedby/);
    expect(box(withLength(1800))).toMatch(/aria-describedby="[^"]*-count"/);
  });
  it("the 2,000 limit still blocks: the box refuses a 2,001st character, and a paste that would pass 2,000 is refused", () => {
    expect(box(withLength(2000))).toContain(`maxLength="${MAX_MESSAGE_LENGTH}"`);
    expect(pasteVerdict("a".repeat(2000), 2000, 2000, "b", MAX_MESSAGE_LENGTH)).toEqual({ ok: false, over: 1 });
    expect(pasteVerdict("a".repeat(1999), 1999, 1999, "b", MAX_MESSAGE_LENGTH)).toEqual({ ok: true });
  });
});

describe("while a reply streams", () => {
  it("the box is disabled", () => expect(box(html({ pending: true }))).toMatch(/\sdisabled(=""|\s|>)/));
  it("the box is enabled when nothing is streaming", () => expect(box(html())).not.toMatch(/\sdisabled(=""|\s|>)/));
  it("the send button is disabled too", () => expect(button(html({ pending: true, value: "hi" }))).toMatch(/\sdisabled=""/));
});

describe("the send button", () => {
  it("is the form's submit button, named 'Send to Farah', at least 44px square", () => {
    const b = button(html({ value: "hi" }));
    expect(b).toMatch(/type="submit"/);
    expect(b).toMatch(/aria-label="Send to Farah"/);
    expect(b).toContain("h-11");
    expect(b).toContain("w-11");
  });
  it("is disabled for an empty, a whitespace-only and a newline-only box, and enabled for text", () => {
    for (const v of ["", "   ", "\n\n", " \r\n\t"]) expect(button(html({ value: v })), JSON.stringify(v)).toMatch(/\sdisabled=""/);
    expect(button(html({ value: "hi" }))).not.toMatch(/\sdisabled=""/);
    expect(button(html({ value: "hi\nthere" }))).not.toMatch(/\sdisabled=""/);
  });
});

describe("the form", () => {
  it("is the frame: the border and the rust focus colour are on the form, as before", () => {
    const f = /<form\b[^>]*>/.exec(html())![0];
    expect(f).toContain("border-[1.5px]");
    expect(f).toContain("focus-within:border-rust");
  });
  it("the box handles Enter itself (the handler is wired in the component source)", async () => {
    const src = (await import("node:fs")).readFileSync("src/components/app-shell/farah-composer.tsx", "utf8");
    expect(src).toContain("onKeyDown");
    expect(src).toContain("handleComposerKeyDown");
  });
});
