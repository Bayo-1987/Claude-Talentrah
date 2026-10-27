/**
 * The bottom sheet's open/close state helpers (PR-1). The sheet is the already-mounted Farah panel shown as a dialog on phones; these pure helpers decide WHAT happens, the component will do it:
 *  - which element gets focus back when the sheet closes (the element that opened it: the launcher, or a job's "Ask Farah" link), falling back to the launcher when that element is gone;
 *  - which keys close it (Escape, unless an input method or an inner widget is using the key), and which taps (only a tap on the scrim itself, not one that started inside the sheet);
 *  - that crossing the 760px shell breakpoint with the sheet open closes it (the docked panel takes over).
 * Elements are stand-ins with focus() and isConnected, since the test environment has no DOM.
 */
import { describe, expect, it, vi } from "vitest";
import { closedSheet, closeSheet, isScrimTap, openSheet, sheetForWidth, sheetKeyAction } from "@/lib/farah/launcher-sheet";

function fakeEl(name: string, isConnected = true) {
  return { name, isConnected, focus: vi.fn() };
}

describe("opening", () => {
  it("opens and remembers the element that opened it", () => {
    const launcher = fakeEl("launcher");
    const s = openSheet(closedSheet(), launcher);
    expect(s.open).toBe(true);
    expect(s.returnTo).toBe(launcher);
  });
  it("opens with no opener (opened by code) and remembers nothing", () => {
    expect(openSheet(closedSheet(), null)).toEqual({ open: true, returnTo: null });
  });
  it("opening an open sheet keeps the FIRST opener", () => {
    const first = fakeEl("first");
    const second = fakeEl("second");
    const s = openSheet(openSheet(closedSheet(), first), second);
    expect(s.returnTo).toBe(first);
  });
  it("opening an open sheet that had no opener adopts the new one", () => {
    const second = fakeEl("second");
    expect(openSheet(openSheet(closedSheet(), null), second).returnTo).toBe(second);
  });
  it("does not mutate the state it is given", () => {
    const before = Object.freeze(closedSheet());
    expect(() => openSheet(before, fakeEl("a"))).not.toThrow();
    expect(before).toEqual({ open: false, returnTo: null });
  });
});

describe("closing: where focus goes back to", () => {
  it("to the element that opened it", () => {
    const opener = fakeEl("job link");
    const launcher = fakeEl("launcher");
    const r = closeSheet(openSheet(closedSheet(), opener), launcher);
    expect(r.state).toEqual({ open: false, returnTo: null });
    expect(r.focusTarget).toBe(opener);
  });
  it("to the fallback (the launcher) when the opener has left the page", () => {
    const gone = fakeEl("card link that scrolled out of a list that re-rendered", false);
    const launcher = fakeEl("launcher");
    expect(closeSheet(openSheet(closedSheet(), gone), launcher).focusTarget).toBe(launcher);
  });
  it("to the fallback when it was opened by code", () => {
    const launcher = fakeEl("launcher");
    expect(closeSheet(openSheet(closedSheet(), null), launcher).focusTarget).toBe(launcher);
  });
  it("to nothing when the opener and the fallback are both gone, and it never throws", () => {
    const gone = fakeEl("a", false);
    expect(closeSheet(openSheet(closedSheet(), gone), fakeEl("b", false)).focusTarget).toBeNull();
    expect(closeSheet(openSheet(closedSheet(), gone), null).focusTarget).toBeNull();
  });
  it("an element that does not say whether it is connected is treated as connected", () => {
    const bare = { focus: vi.fn() };
    expect(closeSheet(openSheet(closedSheet(), bare), null).focusTarget).toBe(bare);
  });
  it("closing a sheet that is not open changes nothing and takes no focus", () => {
    const launcher = fakeEl("launcher");
    const r = closeSheet(closedSheet(), launcher);
    expect(r.state).toEqual(closedSheet());
    expect(r.focusTarget).toBeNull();
  });
  it("the next open starts clean: it does not remember the previous opener", () => {
    const a = fakeEl("a");
    const b = fakeEl("b");
    const closed = closeSheet(openSheet(closedSheet(), a), null).state;
    expect(openSheet(closed, b).returnTo).toBe(b);
  });
});

describe("keys", () => {
  it("Escape closes an open sheet", () => {
    expect(sheetKeyAction({ key: "Escape" }, true)).toBe("close");
  });
  it("Escape does nothing when the sheet is closed", () => {
    expect(sheetKeyAction({ key: "Escape" }, false)).toBe("none");
  });
  it("Escape does nothing while an input method is composing, or when an inner widget already handled it", () => {
    expect(sheetKeyAction({ key: "Escape", isComposing: true }, true)).toBe("none");
    expect(sheetKeyAction({ key: "Escape", defaultPrevented: true }, true)).toBe("none");
  });
  it.each(["Enter", "Tab", " ", "a", "ArrowDown", "Esc", "escape", ""])("%j does not close it", (key) => {
    expect(sheetKeyAction({ key }, true)).toBe("none");
  });
});

describe("taps on the scrim", () => {
  it("a tap whose target is the scrim itself closes", () => {
    const scrim = {};
    expect(isScrimTap(scrim, scrim)).toBe(true);
  });
  it("a tap that landed on something inside the sheet does not", () => {
    expect(isScrimTap({ inner: true }, {})).toBe(false);
  });
  it("a missing target does not", () => {
    expect(isScrimTap(null, {})).toBe(false);
    expect(isScrimTap(undefined, undefined)).toBe(false);
    expect(isScrimTap(null, null)).toBe(false);
  });
});

describe("the breakpoint", () => {
  it("an open sheet closes when the width reaches 760 (the docked panel takes over)", () => {
    const open = openSheet(closedSheet(), fakeEl("a"));
    expect(sheetForWidth(open, 760)).toEqual(closedSheet());
    expect(sheetForWidth(open, 1280)).toEqual(closedSheet());
  });
  it("it stays open on a phone width, including a landscape phone", () => {
    const open = openSheet(closedSheet(), fakeEl("a"));
    expect(sheetForWidth(open, 759)).toBe(open);
    expect(sheetForWidth(open, 667)).toBe(open);
  });
  it("a closed sheet stays closed at every width", () => {
    expect(sheetForWidth(closedSheet(), 400)).toEqual(closedSheet());
    expect(sheetForWidth(closedSheet(), 1000)).toEqual(closedSheet());
  });
  it("a width that is not a number leaves the sheet as it is", () => {
    const open = openSheet(closedSheet(), null);
    expect(sheetForWidth(open, Number.NaN)).toBe(open);
  });
});
