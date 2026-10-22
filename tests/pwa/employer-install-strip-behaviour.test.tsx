/**
 * What a person does with the install strip in the employer shell, driven through the REAL chain: EmployerInstallStrip -> InstallStripLazy (imports the strip after mount) ->
 * InstallStrip -> InstallStripView. Two behaviours of the shared strip that no test held until now, both about "Not now":
 *
 *  T1  the in-page dismissal. Pressing "Not now" hides the strip FOR THE LIFE OF THE PAGE, independent of storage: with a storage that silently forgets (a write that goes nowhere),
 *      a later re-decision (the prompt event, a banner or hint change) must not bring it back. A mutant that ignores the in-page flag survived every other test.
 *  T2  blocked storage. With localStorage throwing on read and on write (a private window), the strip still renders, "Not now" still hides it, and it stays hidden in the page.
 *      A mutant that removes the try/catch around the storage access fails here (the strip never renders, or "Not now" throws).
 *
 * This repo has no DOM or component-test library, so this uses the same minimal hook harness as tests/auth/remembered-account-wiring.test.tsx: React's hooks become slots that live
 * across renders per component instance, `render()` runs the component again, effects run after each render with their cleanups, and only the edges are faked: window, document,
 * localStorage, MutationObserver, ResizeObserver and the browser's install-prompt event. Nothing under src/ is changed or mocked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ cur: null as null | { useState: (i: unknown) => unknown; useRef: (i: unknown) => unknown; useCallback: (f: unknown) => unknown; useEffect: (f: () => void | (() => void), d?: unknown[]) => void } }));

vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  return {
    ...real,
    useState: (i: unknown) => h.cur!.useState(i),
    useRef: (i: unknown) => h.cur!.useRef(i),
    useCallback: (f: unknown) => h.cur!.useCallback(f),
    useEffect: (f: () => void | (() => void), d?: unknown[]) => h.cur!.useEffect(f, d),
  };
});

import { EmployerInstallStrip } from "@/components/employer/employer-install-strip";
import { INSTALL_PROMPT_EVENT, INSTALL_PROMPT_KEY } from "@/lib/pwa/bootstrap";
import { FARAH_FIRST_VISIT_HINT_TEST_ID } from "@/lib/farah/first-visit-hint-id";

type El = { type: unknown; props: Record<string, unknown> };
const isEl = (n: unknown): n is El => typeof n === "object" && n !== null && "type" in n && "props" in n;

/** One mounted function component: its hook slots, its effects and their cleanups. */
class Inst {
  slots: unknown[] = [];
  cursor = 0;
  dirty = false;
  private effects: Array<[number, () => void | (() => void), unknown[] | undefined]> = [];
  private cleanups: Record<number, void | (() => void)> = {};
  private prevDeps: Record<number, unknown[] | undefined> = {};

  useState = (init: unknown) => {
    const i = this.cursor++;
    if (!(i in this.slots)) this.slots[i] = typeof init === "function" ? (init as () => unknown)() : init;
    return [this.slots[i], (next: unknown) => {
      this.slots[i] = typeof next === "function" ? (next as (p: unknown) => unknown)(this.slots[i]) : next;
      this.dirty = true;
    }];
  };
  useRef = (init: unknown) => {
    const i = this.cursor++;
    if (!(i in this.slots)) this.slots[i] = { current: init };
    return this.slots[i];
  };
  useCallback = (fn: unknown) => {
    const i = this.cursor++;
    if (!(i in this.slots)) this.slots[i] = fn; // every call here passes []: the first function is the stable one
    return this.slots[i];
  };
  useEffect = (fn: () => void | (() => void), deps?: unknown[]) => {
    this.effects.push([this.cursor++, fn, deps]);
  };

  render(Component: (props: Record<string, unknown>) => unknown, props: Record<string, unknown> = {}) {
    h.cur = this;
    this.cursor = 0;
    this.dirty = false;
    this.effects = [];
    const out = Component(props);
    h.cur = null;
    for (const [i, fn, deps] of this.effects) {
      const prev = this.prevDeps[i];
      const changed = !(i in this.prevDeps) || !deps || !prev || deps.length !== prev.length || deps.some((d, k) => d !== prev[k]);
      if (changed) {
        if (typeof this.cleanups[i] === "function") (this.cleanups[i] as () => void)();
        this.cleanups[i] = fn();
        this.prevDeps[i] = deps;
      }
    }
    return out;
  }
  unmount() {
    for (const c of Object.values(this.cleanups)) if (typeof c === "function") c();
  }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
/** Render, then keep re-rendering while the instance says its state changed (the async effects need a turn to land). */
async function settle(inst: Inst, Component: (p: Record<string, unknown>) => unknown, props: Record<string, unknown> = {}) {
  let out = inst.render(Component, props);
  for (let i = 0; i < 20; i += 1) {
    await flush();
    if (!inst.dirty) break;
    out = inst.render(Component, props);
  }
  return out;
}

/** The first element in the tree that carries `onDismiss`: the strip's view (its props are all the test needs: kind, onInstall, onDismiss). */
function findView(node: unknown): El | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findView(n);
      if (hit) return hit;
    }
    return null;
  }
  if (!isEl(node)) return null;
  if (typeof node.props.onDismiss === "function") return node;
  return findView(node.props.children);
}

// --- the edges -------------------------------------------------------------------------------------------------------------------------------------------------------------

class FakeObserver {
  static last: FakeObserver | null = null;
  constructor(public callback: (records: unknown[]) => void) {
    FakeObserver.last = this;
  }
  observe() {}
  disconnect() {}
}
type Storage = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void };

const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const g = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};

function installBrowser(storage: Storage) {
  const win = new EventTarget() as EventTarget & Record<string, unknown>;
  const doc = { documentElement: { getAttribute: () => null }, querySelector: () => null, body: {} };
  Object.assign(win, {
    navigator: { userAgent: ANDROID_CHROME, platform: "Linux armv8l", maxTouchPoints: 5 },
    matchMedia: () => ({ matches: false }),
    localStorage: storage,
    document: doc,
    // The browser's install prompt, already captured by the early bootstrap before the strip loaded.
    [INSTALL_PROMPT_KEY]: { prompt: async () => undefined, userChoice: Promise.resolve({ outcome: "dismissed" }) },
  });
  for (const [k, v] of Object.entries({ window: win, document: doc, MutationObserver: FakeObserver, ResizeObserver: class { observe() {} disconnect() {} } })) {
    saved[k] = g[k];
    g[k] = v;
  }
  return win;
}

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete g[k];
    else g[k] = v;
  }
  FakeObserver.last = null;
});

/** Mount the employer shell's strip through the real chain and return what a test needs to act on it. */
async function mountEmployerStrip() {
  const wrapper = EmployerInstallStrip() as El; // InstallStripLazy (PWA_KILL is not set here)
  expect(isEl(wrapper)).toBe(true);
  const lazy = new Inst();
  let lazyOut = lazy.render(wrapper.type as (p: Record<string, unknown>) => unknown, wrapper.props); // first render: null, and the effect starts importing the strip
  await vi.waitFor(() => expect(lazy.dirty).toBe(true));
  lazyOut = lazy.render(wrapper.type as (p: Record<string, unknown>) => unknown, wrapper.props);
  expect(isEl(lazyOut), "the lazy wrapper rendered the strip after the import").toBe(true);
  const stripType = (lazyOut as El).type as (p: Record<string, unknown>) => unknown;
  const strip = new Inst();
  const view = async () => findView(await settle(strip, stripType));
  return { strip, view, rerender: () => findView(strip.render(stripType)) };
}

const droppingStorage: Storage = { getItem: () => null, setItem: () => undefined }; // accepts the write, remembers nothing
const throwingStorage: Storage = {
  getItem: () => {
    throw new Error("SecurityError: storage is blocked");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

/** Things that make the strip decide again: the bootstrap's late prompt event, and a hint appearing in the page (through the observer the strip installed). */
async function redecideEveryWay(win: EventTarget, strip: Inst, rerender: () => El | null) {
  win.dispatchEvent(new Event(INSTALL_PROMPT_EVENT));
  await flush();
  const hint = { nodeType: 1, matches: (s: string) => s.includes(FARAH_FIRST_VISIT_HINT_TEST_ID), querySelector: () => null };
  FakeObserver.last?.callback([{ type: "childList", addedNodes: [hint], removedNodes: [] }]);
  await flush();
  void strip;
  return rerender();
}

describe("T1: the in-page dismissal of the employer strip", () => {
  it("'Not now' hides it, and it stays hidden after a re-render and after every re-decision, even when storage remembers nothing", async () => {
    const win = installBrowser(droppingStorage);
    const { strip, view, rerender } = await mountEmployerStrip();

    const shown = await view();
    expect(shown, "the strip is offered (a prompt was captured, nothing dismissed)").not.toBeNull();
    expect(shown!.props.kind).toBe("prompt");

    (shown!.props.onDismiss as () => void)();
    expect(strip.dirty, "pressing Not now changed the strip's state").toBe(true);
    expect(rerender(), "hidden after the re-render").toBeNull();

    expect(await redecideEveryWay(win, strip, rerender), "still hidden after the prompt event and a hint appearing: the page's own memory holds").toBeNull();
    strip.unmount();
  });
});

describe("T2: the employer strip with blocked storage (a private window)", () => {
  it("renders, 'Not now' hides it without throwing, and it stays hidden in the page", async () => {
    const win = installBrowser(throwingStorage);
    const { strip, view, rerender } = await mountEmployerStrip();

    const shown = await view();
    expect(shown, "the strip renders even though reading storage throws").not.toBeNull();
    expect(shown!.props.kind).toBe("prompt");

    expect(() => (shown!.props.onDismiss as () => void)(), "Not now must not throw when writing storage throws").not.toThrow();
    expect(rerender(), "hidden after Not now").toBeNull();

    expect(await redecideEveryWay(win, strip, rerender), "stays hidden for the life of the page").toBeNull();
    strip.unmount();
  });
});
