/**
 * The soft-keyboard rule (PR-1): the launcher hides while the on-screen keyboard is open, so it cannot sit on top of what is being typed. Pure and based on the VISUAL viewport, because a phone's
 * browser keeps the layout viewport as it was and only shrinks the visual one. There is no keyboard or visualViewport code in the app today, so the rule is built and pinned here first.
 *
 * Open means all of: the visual viewport has lost at least KEYBOARD_MIN_SHRINK_PX of height, a text-entry field has focus, and the page is not pinch-zoomed (zooming also shrinks the visual
 * viewport, and the launcher should stay then). Anything not a sane number answers "not open", so the launcher stays visible rather than vanishing on bad data.
 */
import { describe, expect, it } from "vitest";
import { KEYBOARD_MIN_SHRINK_PX, isTextEntryElement, keyboardIsOpen } from "@/lib/farah/keyboard-open";

const base = { layoutHeight: 800, visualHeight: 500, textFieldFocused: true };

describe("keyboardIsOpen", () => {
  it("is open when the visual viewport shrank a lot and a text field has focus", () => {
    expect(keyboardIsOpen(base)).toBe(true);
  });
  it("is not open when nothing shrank", () => {
    expect(keyboardIsOpen({ ...base, visualHeight: 800 })).toBe(false);
  });
  it("is not open when no text field has focus (a shrink alone is a toolbar or a split view)", () => {
    expect(keyboardIsOpen({ ...base, textFieldFocused: false })).toBe(false);
  });
  it("the threshold is exact: one pixel under is not a keyboard, the threshold is", () => {
    expect(KEYBOARD_MIN_SHRINK_PX).toBe(150);
    expect(keyboardIsOpen({ ...base, visualHeight: 800 - (KEYBOARD_MIN_SHRINK_PX - 1) })).toBe(false);
    expect(keyboardIsOpen({ ...base, visualHeight: 800 - KEYBOARD_MIN_SHRINK_PX })).toBe(true);
  });
  it("a browser toolbar sliding in or out (about 50 to 100px) is not a keyboard", () => {
    expect(keyboardIsOpen({ ...base, visualHeight: 720 })).toBe(false);
    expect(keyboardIsOpen({ ...base, visualHeight: 700 })).toBe(false);
  });
  it("is not open while pinch-zoomed, whatever the shrink", () => {
    expect(keyboardIsOpen({ ...base, scale: 2 })).toBe(false);
    expect(keyboardIsOpen({ ...base, scale: 1.5 })).toBe(false);
  });
  it("a scale of 1 (or none, or a hair above from rounding) is not zoom", () => {
    expect(keyboardIsOpen({ ...base, scale: 1 })).toBe(true);
    expect(keyboardIsOpen({ ...base, scale: 1.005 })).toBe(true);
    expect(keyboardIsOpen({ ...base, scale: undefined })).toBe(true);
  });
  it("a visual viewport taller than the layout one (it can be, by a pixel) is not open", () => {
    expect(keyboardIsOpen({ ...base, visualHeight: 801 })).toBe(false);
  });
  it.each([
    ["NaN layout", { layoutHeight: Number.NaN }],
    ["NaN visual", { visualHeight: Number.NaN }],
    ["zero layout", { layoutHeight: 0 }],
    ["zero visual", { visualHeight: 0 }],
    ["negative visual", { visualHeight: -300 }],
    ["infinite layout", { layoutHeight: Number.POSITIVE_INFINITY }],
    ["missing layout", { layoutHeight: undefined as unknown as number }],
    ["missing visual (no visualViewport on the browser)", { visualHeight: undefined as unknown as number }],
  ])("bad data (%s) answers not open", (_name, patch) => {
    expect(keyboardIsOpen({ ...base, ...patch })).toBe(false);
  });
});

describe("isTextEntryElement", () => {
  it.each([
    [{ tagName: "TEXTAREA" }],
    [{ tagName: "textarea" }],
    [{ tagName: "INPUT" }],
    [{ tagName: "INPUT", type: "" }],
    [{ tagName: "INPUT", type: "text" }],
    [{ tagName: "INPUT", type: "SEARCH" }],
    [{ tagName: "INPUT", type: "email" }],
    [{ tagName: "INPUT", type: "tel" }],
    [{ tagName: "INPUT", type: "url" }],
    [{ tagName: "INPUT", type: "password" }],
    [{ tagName: "INPUT", type: "number" }],
    [{ tagName: "DIV", isContentEditable: true }],
  ])("%j opens a keyboard", (el) => {
    expect(isTextEntryElement(el)).toBe(true);
  });
  it.each([
    [{ tagName: "INPUT", type: "checkbox" }],
    [{ tagName: "INPUT", type: "radio" }],
    [{ tagName: "INPUT", type: "button" }],
    [{ tagName: "INPUT", type: "submit" }],
    [{ tagName: "INPUT", type: "file" }],
    [{ tagName: "INPUT", type: "range" }],
    [{ tagName: "INPUT", type: "color" }],
    [{ tagName: "INPUT", type: "date" }],
    [{ tagName: "INPUT", type: "text", readOnly: true }],
    [{ tagName: "INPUT", type: "text", disabled: true }],
    [{ tagName: "TEXTAREA", readOnly: true }],
    [{ tagName: "TEXTAREA", disabled: true }],
    [{ tagName: "SELECT" }],
    [{ tagName: "BUTTON" }],
    [{ tagName: "A" }],
    [{ tagName: "DIV" }],
    [{ tagName: "DIV", isContentEditable: false }],
    [{}],
  ])("%j does not", (el) => {
    expect(isTextEntryElement(el)).toBe(false);
  });
  it("null, undefined and odd values do not", () => {
    for (const v of [null, undefined, 5, "input", []] as unknown[]) expect(isTextEntryElement(v as never)).toBe(false);
  });
});
