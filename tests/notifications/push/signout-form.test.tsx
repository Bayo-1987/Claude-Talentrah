/**
 * U7: the sign-out form runs the push cleanup FIRST and submits only after it has finished or timed out, because the route needs the live session. Driven through the real component with
 * the minimal hook harness of tests/pwa/employer-install-strip-behaviour.test.tsx (no DOM library here); the cleanup is injected, so nothing under src/ is mocked.
 */
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ cur: null as null | { useRef: (i: unknown) => unknown } }));
vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  return { ...real, useRef: (i: unknown) => h.cur!.useRef(i) };
});

import { PushCleanupForm } from "@/components/app-shell/push-cleanup-form";

type El = { type: unknown; props: Record<string, unknown> };
class Inst {
  slots: unknown[] = [];
  cursor = 0;
  useRef = (init: unknown) => {
    const i = this.cursor++;
    if (!(i in this.slots)) this.slots[i] = { current: init };
    return this.slots[i];
  };
  render(props: Record<string, unknown>): El {
    h.cur = this;
    this.cursor = 0;
    const out = (PushCleanupForm as unknown as (p: Record<string, unknown>) => El)(props);
    h.cur = null;
    return out;
  }
}
const event = (log: string[]) => ({ preventDefault: () => log.push("preventDefault"), currentTarget: { requestSubmit: () => log.push("submit") } });

describe("PushCleanupForm", () => {
  it("renders a form that keeps the server action and its children", () => {
    const action = () => undefined;
    const tree = new Inst().render({ action, className: "k", children: "Sign out", cleanup: async () => undefined });
    expect(tree.type).toBe("form");
    expect(tree.props.action).toBe(action);
    expect(tree.props.className).toBe("k");
    expect(tree.props.children).toBe("Sign out");
  });

  it("the cleanup finishes BEFORE the form submits, and the first submit event is held back", async () => {
    const log: string[] = [];
    let release!: () => void;
    const cleanup = () => new Promise<void>((r) => { release = () => { log.push("cleanup done"); r(); }; });
    const inst = new Inst();
    const onSubmit = inst.render({ action: () => undefined, cleanup }).props.onSubmit as (e: unknown) => void;
    onSubmit(event(log));
    expect(log).toEqual(["preventDefault"]);
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual(["preventDefault", "cleanup done", "submit"]);
  });

  it("the submit it triggers itself is let through (not prevented, no second cleanup)", async () => {
    const log: string[] = [];
    const cleanup = vi.fn(async () => undefined);
    const inst = new Inst();
    const onSubmit = inst.render({ action: () => undefined, cleanup }).props.onSubmit as (e: unknown) => void;
    onSubmit(event(log));
    await new Promise((r) => setTimeout(r, 0));
    const second: string[] = [];
    (inst.render({ action: () => undefined, cleanup }).props.onSubmit as (e: unknown) => void)(event(second));
    expect(second).toEqual([]);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("a double click while the cleanup runs does not start a second one and does not submit early", async () => {
    const log: string[] = [];
    let release!: () => void;
    const cleanup = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const inst = new Inst();
    const onSubmit = inst.render({ action: () => undefined, cleanup }).props.onSubmit as (e: unknown) => void;
    onSubmit(event(log));
    onSubmit(event(log));
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(log.filter((l) => l === "submit")).toEqual([]);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(log.filter((l) => l === "submit")).toHaveLength(1);
  });

  it("a cleanup that throws still lets the sign-out go ahead", async () => {
    const log: string[] = [];
    const inst = new Inst();
    const onSubmit = inst.render({ action: () => undefined, cleanup: async () => { throw new Error("x"); } }).props.onSubmit as (e: unknown) => void;
    onSubmit(event(log));
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toContain("submit");
  });
});
