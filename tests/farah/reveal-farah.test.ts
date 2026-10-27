/**
 * scrollToFarahPanel is the ONE way the app brings Farah to the reader (the masthead, the first-visit hint, the job's "Ask Farah" link and the launcher all call it).
 * Above 760px it scrolls the docked panel into view if it is not; on a phone it opens the sheet instead, and runs a follow-up (the job's seed) only AFTER the sheet is open,
 * because the panel's arrival focus cannot land on an element that is still hidden.
 *
 * The unit environment has no DOM, so a minimal window and document stand in.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { FARAH_OPEN_SHEET_EVENT, scrollToFarahPanel } from "@/lib/farah/scroll-to-panel";

type Listener = (e: Event) => void;

function fakeBrowser(opts: { width: number; hostMounted: boolean; panelTop?: number }) {
  const scrolled: unknown[] = [];
  const listeners = new Map<string, Listener[]>();
  const active = { id: "opener" };
  const panel = {
    getBoundingClientRect: () => ({ top: opts.panelTop ?? 2000, bottom: (opts.panelTop ?? 2000) + 600 }),
    scrollIntoView: (o: unknown) => scrolled.push(o),
  };
  const win = {
    innerWidth: opts.width,
    innerHeight: 800,
    matchMedia: () => ({ matches: false }),
    addEventListener: (t: string, l: Listener) => listeners.set(t, [...(listeners.get(t) ?? []), l]),
    removeEventListener: () => {},
    dispatchEvent: (e: Event) => {
      for (const l of listeners.get(e.type) ?? []) l(e);
      return true;
    },
  };
  const doc = { querySelector: () => panel, activeElement: active, documentElement: { clientHeight: 800 } };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("CustomEvent", class extends Event {
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      super(type);
      this.detail = init?.detail;
    }
  });
  if (opts.hostMounted) {
    win.addEventListener(FARAH_OPEN_SHEET_EVENT, (e: Event) => {
      (e as CustomEvent<{ handled: boolean }>).detail.handled = true;
      opened.push((e as CustomEvent<{ opener: unknown }>).detail);
    });
  }
  return { scrolled, active };
}
const opened: Array<Record<string, unknown>> = [];

afterEach(() => {
  vi.unstubAllGlobals();
  opened.length = 0;
});

describe("on a phone with the sheet host mounted", () => {
  it("opens the sheet, naming the element that asked, and does not scroll the page", () => {
    const { scrolled, active } = fakeBrowser({ width: 390, hostMounted: true });
    scrollToFarahPanel();
    expect(opened).toHaveLength(1);
    expect(opened[0].opener).toBe(active);
    expect(scrolled).toEqual([]);
  });

  it("hands the follow-up to the host instead of running it, so the seed arrives after the sheet is open", () => {
    fakeBrowser({ width: 390, hostMounted: true });
    const after = vi.fn();
    scrollToFarahPanel(after);
    expect(after).not.toHaveBeenCalled();
    expect(opened[0].after).toBe(after);
  });
});

describe("on a phone with no sheet host (a page outside the signed-in shell)", () => {
  it("falls back to the old scroll, and runs the follow-up at once", () => {
    const { scrolled } = fakeBrowser({ width: 390, hostMounted: false });
    const after = vi.fn();
    scrollToFarahPanel(after);
    expect(scrolled).toHaveLength(1);
    expect(after).toHaveBeenCalledTimes(1);
  });
});

describe("when something that is not a function is passed (a click event handed in by a bare onClick)", () => {
  it("is ignored: it is not run, and the reveal still happens", () => {
    const { scrolled } = fakeBrowser({ width: 1280, hostMounted: false, panelTop: 2000 });
    expect(() => scrollToFarahPanel({ type: "click" } as unknown as () => void)).not.toThrow();
    expect(scrolled).toHaveLength(1);
  });
});

describe("from 760px up", () => {
  it("never opens a sheet: it scrolls the docked panel only when it is off screen, and runs the follow-up", () => {
    const off = fakeBrowser({ width: 1280, hostMounted: true, panelTop: 2000 });
    const afterOff = vi.fn();
    scrollToFarahPanel(afterOff);
    expect(opened).toHaveLength(0);
    expect(off.scrolled).toHaveLength(1);
    expect(afterOff).toHaveBeenCalledTimes(1);
  });

  it("does nothing to the scroll position when the panel is already in view", () => {
    const { scrolled } = fakeBrowser({ width: 1280, hostMounted: true, panelTop: 68 });
    scrollToFarahPanel();
    expect(scrolled).toEqual([]);
    expect(opened).toHaveLength(0);
  });

  it("treats exactly 760 as the docked layout", () => {
    fakeBrowser({ width: 760, hostMounted: true, panelTop: 68 });
    scrollToFarahPanel();
    expect(opened).toHaveLength(0);
  });
});
