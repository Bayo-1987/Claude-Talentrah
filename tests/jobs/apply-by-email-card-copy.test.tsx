/**
 * UX-QUICK: on the feed card, "Apply by email" opens the mail app (a plain mailto click), and the button then becomes "Copy email address"; the next click copies the address,
 * says "Copied" through a polite live region, and never prints the address. That copy click must not reach the card.
 *
 * No DOM library here, so the same minimal hook harness as tests/pwa/employer-install-strip-behaviour.test.tsx drives the real component and reads the element tree it returns.
 * Every address below is invented.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ cur: null as null | { useState: (i: unknown) => unknown; useRef: (i: unknown) => unknown; useEffect: (f: () => void | (() => void), d?: unknown[]) => void } }));

vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  return {
    ...real,
    useState: (i: unknown) => h.cur!.useState(i),
    useRef: (i: unknown) => h.cur!.useRef(i),
    useEffect: (f: () => void | (() => void), d?: unknown[]) => h.cur!.useEffect(f, d),
  };
});

import { ApplyByEmailCardControl } from "@/components/jobs/apply-by-email-card";

type El = { type: unknown; props: Record<string, unknown> };
const isEl = (n: unknown): n is El => typeof n === "object" && n !== null && "type" in n && "props" in n;

class Inst {
  slots: unknown[] = [];
  cursor = 0;
  private effects: Array<[number, () => void | (() => void), unknown[] | undefined]> = [];
  private cleanups: Record<number, void | (() => void)> = {};
  private prevDeps: Record<number, unknown[] | undefined> = {};
  useState = (init: unknown) => {
    const i = this.cursor++;
    if (!(i in this.slots)) this.slots[i] = typeof init === "function" ? (init as () => unknown)() : init;
    return [this.slots[i], (next: unknown) => { this.slots[i] = typeof next === "function" ? (next as (p: unknown) => unknown)(this.slots[i]) : next; }];
  };
  useRef = (init: unknown) => {
    const i = this.cursor++;
    if (!(i in this.slots)) this.slots[i] = { current: init };
    return this.slots[i];
  };
  useEffect = (fn: () => void | (() => void), deps?: unknown[]) => { this.effects.push([this.cursor++, fn, deps]); };
  render(props: Record<string, unknown>) {
    h.cur = this;
    this.cursor = 0;
    this.effects = [];
    const out = (ApplyByEmailCardControl as unknown as (p: Record<string, unknown>) => unknown)(props);
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
  unmount() { for (const c of Object.values(this.cleanups)) if (typeof c === "function") c(); }
}

function walk(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return out; }
  if (!isEl(node)) return out;
  out.push(node);
  walk(node.props.children, out);
  return out;
}
const find = (tree: unknown, type: string) => walk(tree).filter((e) => e.type === type);
/** Everything a reader would see: text children only, not attributes. */
function visibleText(node: unknown): string {
  if (Array.isArray(node)) return node.map(visibleText).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!isEl(node)) return "";
  return visibleText(node.props.children);
}

const ADDRESS = "careers@example.test";
const HREF = "mailto:careers@example.test?subject=Application%3A%20Support%20Lead";
const props = { href: HREF, address: ADDRESS, label: "Apply by email", className: "c", adClick: undefined };

const written: string[] = [];
function stubClipboard(fail = false) {
  vi.stubGlobal("navigator", { clipboard: { writeText: async (t: string) => { if (fail) throw new Error("no"); written.push(t); } } });
}
const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const clickEvent = () => ({ stopPropagation: vi.fn(), preventDefault: vi.fn() });

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); written.length = 0; });

describe("the card's Apply by email control", () => {
  it("before any click: one mailto anchor labelled 'Apply by email', no button, address not in the visible text", () => {
    const tree = new Inst().render(props);
    const a = find(tree, "a");
    expect(a).toHaveLength(1);
    expect(a[0].props.href).toBe(HREF);
    expect(visibleText(tree)).toBe("Apply by email");
    expect(find(tree, "button")).toHaveLength(0);
  });

  it("after the mailto click: the anchor is not prevented (the mail app opens) and the button reads 'Copy email address'", () => {
    const inst = new Inst();
    const a = find(inst.render(props), "a")[0];
    const ev = clickEvent();
    (a.props.onClick as (e: unknown) => void)(ev);
    expect(ev.preventDefault).not.toHaveBeenCalled();
    const tree = inst.render(props);
    expect(find(tree, "a")).toHaveLength(0);
    const b = find(tree, "button");
    expect(b).toHaveLength(1);
    expect(b[0].props.type).toBe("button");
    expect(visibleText(b[0])).toBe("Copy email address");
  });

  it("the next click copies the address, announces 'Copied' in a polite live region, and never prints the address", async () => {
    stubClipboard();
    const inst = new Inst();
    (find(inst.render(props), "a")[0].props.onClick as (e: unknown) => void)(clickEvent());
    const b = find(inst.render(props), "button")[0];
    await (b.props.onClick as (e: unknown) => Promise<void>)(clickEvent());
    expect(written).toEqual([ADDRESS]);
    const tree = inst.render(props);
    expect(visibleText(find(tree, "button")[0])).toBe("Copied");
    const status = find(tree, "span").find((s) => s.props.role === "status")!;
    expect(visibleText(status)).toBe("Copied");
    expect(status.props["aria-live"] ?? "polite").toBe("polite");
    expect(visibleText(tree)).not.toContain(ADDRESS);
    expect(visibleText(tree)).not.toContain("@");
  });

  it("the label returns to 'Copy email address' after two seconds", async () => {
    stubClipboard();
    vi.useFakeTimers();
    const inst = new Inst();
    (find(inst.render(props), "a")[0].props.onClick as (e: unknown) => void)(clickEvent());
    await (find(inst.render(props), "button")[0].props.onClick as (e: unknown) => Promise<void>)(clickEvent());
    vi.advanceTimersByTime(2000);
    expect(visibleText(find(inst.render(props), "button")[0])).toBe("Copy email address");
  });

  it("a refused clipboard says so, still without printing the address", async () => {
    stubClipboard(true);
    const inst = new Inst();
    (find(inst.render(props), "a")[0].props.onClick as (e: unknown) => void)(clickEvent());
    await (find(inst.render(props), "button")[0].props.onClick as (e: unknown) => Promise<void>)(clickEvent());
    await flush();
    const tree = inst.render(props);
    expect(visibleText(tree)).toContain("Could not copy");
    expect(visibleText(tree)).not.toContain(ADDRESS);
  });

  it("the copy click does not bubble to the card", async () => {
    stubClipboard();
    const inst = new Inst();
    (find(inst.render(props), "a")[0].props.onClick as (e: unknown) => void)(clickEvent());
    const ev = clickEvent();
    await (find(inst.render(props), "button")[0].props.onClick as (e: unknown) => Promise<void>)(ev);
    expect(ev.stopPropagation).toHaveBeenCalled();
  });

  it("the mailto click is left to bubble, so a sponsored card's delegated tracking (data-ad-click) still sees it", () => {
    const tree = new Inst().render({ ...props, adClick: "true" });
    const a = find(tree, "a")[0];
    expect(a.props["data-ad-click"]).toBe("true");
    const ev = clickEvent();
    (a.props.onClick as (e: unknown) => void)(ev);
    expect(ev.stopPropagation).not.toHaveBeenCalled();
  });
});
