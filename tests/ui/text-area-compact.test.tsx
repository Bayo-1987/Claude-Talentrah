/**
 * The shared TextArea's compact (composer) mode, added for the Farah panel's message box. Opt-in: a TextArea without `compact` is exactly what S1's tests pin (4+ rows, the shared frame, a resize handle).
 * Compact: starts at one row, grows with its text up to `maxHeight` pixels and then scrolls, has no resize handle and no frame of its own (the caller's own frame carries it), and hands its element out through `textareaRef`.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TextArea } from "@/components/ui/text-area";
import { WRITING_BOX_FRAME } from "@/components/ui/writing-box";

const html = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(TextArea, { label: "Ask me anything…", name: "m", ...props } as never));
const box = (markup: string) => /<textarea\b[^>]*>/.exec(markup)![0];

describe("compact", () => {
  const t = box(html({ compact: true, autoGrow: true, maxHeight: 160 }));
  it("starts at one row, not four", () => expect(t).toMatch(/rows="1"/));
  it("scrolls once it reaches the maximum height, which is a style on the box itself", () => {
    expect(t).toMatch(/max-height:160px/);
    expect(t).toContain("overflow-y-auto");
  });
  it("grows with its text", () => expect(t).toMatch(/data-autogrow="true"/));
  it("has no resize handle and none of the shared frame (the caller's frame carries it)", () => {
    expect(t).toContain("resize-none");
    expect(t).not.toContain("resize-y");
    for (const cls of ["border-[1.5px]", "bg-card", "px-3.5", "py-2.5"]) expect(t, cls).not.toContain(cls);
  });
  it("keeps the label, the limit and the counter", () => {
    const m = html({ compact: true, autoGrow: true, maxHeight: 160, limit: 2000, hideLabel: true });
    expect(m).toMatch(/<label[^>]*sr-only[^>]*>Ask me anything…<\/label>/);
    expect(box(m)).toMatch(/maxLength="2000"/);
    expect(m).toContain("0 / 2000");
  });
  it("a starting multi-line value still starts tall enough to show its lines up to the maximum, not at one row", () => {
    expect(box(html({ compact: true, autoGrow: true, maxHeight: 160, defaultValue: "a\nb\nc" }))).toMatch(/rows="3"/);
  });
});

describe("not compact: unchanged", () => {
  const t = box(html({}));
  it("4 rows, the frame, a resize handle", () => {
    expect(t).toMatch(/rows="4"/);
    for (const cls of WRITING_BOX_FRAME.split(" ")) expect(t, cls).toContain(cls);
    expect(t).toContain("resize-y");
  });
  it("no max-height style, no overflow class", () => {
    expect(t).not.toMatch(/max-height/);
    expect(t).not.toContain("overflow-y-auto");
  });
});
