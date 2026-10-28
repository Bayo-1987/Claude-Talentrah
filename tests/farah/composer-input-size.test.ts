/**
 * The Farah composer is 16px on phones and keeps its 12.5px from the shell breakpoint (760px) up. Safari on iPhone zooms the page when a text field under 16px takes focus and stays zoomed, which put the
 * sheet's Send button off the right edge; the repo already uses the same pattern for its writing boxes (src/components/ui/writing-box.ts: 16px, smaller from the breakpoint up). A source pin; the computed
 * sizes in a browser are e2e/farah-sheet-input-zoom.spec.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const composer = readFileSync(path.resolve(__dirname, "../../src/components/app-shell/farah-composer.tsx"), "utf8");
const textareaClass = /<TextArea[\s\S]*?className="([^"]*)"/.exec(composer)?.[1] ?? "";

describe("the composer's text size", () => {
  it("finds the textarea's class list (not vacuous)", () => {
    expect(textareaClass).toContain("font-display");
  });
  it("is 16px by default (phones)", () => {
    expect(textareaClass.split(/\s+/)).toContain("text-[16px]");
  });
  it("goes back to 12.5px from the shell breakpoint (760px), so the docked desktop panel is unchanged", () => {
    expect(textareaClass.split(/\s+/)).toContain("min-[760px]:text-[12.5px]");
  });
  it("has no other base text size that could win over the 16px", () => {
    const sizes = textareaClass.split(/\s+/).filter((c) => /^text-\[\d+(\.\d+)?px\]$/.test(c));
    expect(sizes).toEqual(["text-[16px]"]);
  });
});
