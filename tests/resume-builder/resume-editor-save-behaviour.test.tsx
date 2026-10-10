/**
 * RESUME-SAVE-1/2, behaviourally. The wiring test (tests/forms/keep-input-wiring-resume-save.test.ts) reads the
 * source; this one RUNS the editor. There is no DOM environment here, so the component function is called directly
 * with React's state hooks backed by a plain slot store, the real Save handler is fired from the element tree it
 * returns, and every following render is read back: the alert, the Save label, and the typed values.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  pendingWork: [] as Promise<unknown>[],
  save: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const useState = (init: unknown) => {
    const i = h.cursor++;
    if (!(i in h.slots)) h.slots[i] = typeof init === "function" ? (init as () => unknown)() : init;
    const set = (v: unknown) => {
      h.slots[i] = typeof v === "function" ? (v as (p: unknown) => unknown)(h.slots[i]) : v;
    };
    return [h.slots[i], set];
  };
  const useTransition = () => [false, (fn: () => unknown) => { h.pendingWork.push(Promise.resolve(fn())); }];
  return { ...actual, default: { ...actual, useState, useTransition }, useState, useTransition };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/lib/resume-builder/actions", () => ({ saveResumeAction: h.save, rewriteBulletAction: vi.fn() }));
vi.mock("@/components/app-shell/credits-balance", () => ({ useReportCreditsBalance: () => () => {} }));
vi.mock("@/components/resume-builder/use-unsaved-guard", () => ({ useUnsavedGuard: () => {} }));

import { ResumeEditor } from "@/components/resume-builder/resume-editor";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";

type El = { type: unknown; props: Record<string, unknown> };
const isEl = (n: unknown): n is El => !!n && typeof n === "object" && "props" in (n as object);

function find(node: unknown, pred: (e: El) => boolean, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach((c) => find(c, pred, out));
  else if (isEl(node)) {
    if (pred(node)) out.push(node);
    find(node.props.children, pred, out);
  }
  return out;
}
const textOf = (n: unknown): string =>
  Array.isArray(n) ? n.map(textOf).join("") : isEl(n) ? textOf(n.props.children) : typeof n === "string" || typeof n === "number" ? String(n) : "";

const START: StructuredResume = { ...EMPTY_RESUME, contact: { name: "Ada Obi" } };

function render() {
  h.cursor = 0;
  return ResumeEditor({ resumeId: "r1", initialTitle: "My resume", initialContent: START, templateSlug: null }) as unknown as El;
}
const saveButton = (tree: El) => find(tree, (e) => typeof e.props.onClick === "function" && /^(Save|Saving…|Saved)$/.test(textOf(e.props.children)))[0];
const alerts = (tree: El) => find(tree, (e) => e.props.role === "alert").map((e) => textOf(e.props.children));
const titleValue = (tree: El) => find(tree, (e) => e.type === "input")[0].props.value;
const nameValue = (tree: El) => find(tree, (e) => e.props.id === "contact-full-name")[0].props.value;

async function typeThenSave() {
  let tree = render();
  (find(tree, (e) => e.type === "input")[0].props.onChange as (e: unknown) => void)({ target: { value: "Senior PM resume" } });
  tree = render();
  (find(tree, (e) => e.props.id === "contact-full-name")[0].props.onChange as (e: unknown) => void)({ target: { value: "Adaeze Obi" } });
  tree = render();
  (saveButton(tree).props.onClick as () => void)();
  await Promise.all(h.pendingWork);
  return render();
}

beforeEach(() => {
  h.slots.length = 0;
  h.pendingWork.length = 0;
  h.save.mockReset();
});

describe("the resume editor's Save, run", () => {
  it("a refused Save shows the message in place, keeps every typed field, and does not say Saved", async () => {
    h.save.mockResolvedValue({ ok: false, error: "This resume no longer exists, so it was not saved." });
    const after = await typeThenSave();
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0][1].contact.name).toBe("Adaeze Obi");
    expect(h.save.mock.calls[0][2]).toBe("Senior PM resume");
    expect(alerts(after)).toEqual(["This resume no longer exists, so it was not saved."]);
    expect(textOf(saveButton(after).props.children)).toBe("Save");
    expect(titleValue(after)).toBe("Senior PM resume");
    expect(nameValue(after)).toBe("Adaeze Obi");
  });

  it("a Save that cannot reach the server is shown the same way and keeps the edit", async () => {
    h.save.mockRejectedValue(new Error("network"));
    const after = await typeThenSave();
    expect(alerts(after)[0]).toMatch(/Couldn't reach the server/);
    expect(textOf(saveButton(after).props.children)).toBe("Save");
    expect(nameValue(after)).toBe("Adaeze Obi");
  });

  it("a successful Save says Saved, shows no message, and keeps the values", async () => {
    h.save.mockResolvedValue({ ok: true });
    const after = await typeThenSave();
    expect(alerts(after)).toEqual([]);
    expect(textOf(saveButton(after).props.children)).toBe("Saved");
    expect(nameValue(after)).toBe("Adaeze Obi");
  });

  it("a refusal followed by a successful retry clears the message and says Saved", async () => {
    h.save.mockResolvedValueOnce({ ok: false, error: "Try again." }).mockResolvedValueOnce({ ok: true });
    let after = await typeThenSave();
    expect(alerts(after)).toEqual(["Try again."]);
    h.pendingWork.length = 0;
    (saveButton(after).props.onClick as () => void)();
    await Promise.all(h.pendingWork);
    after = render();
    expect(alerts(after)).toEqual([]);
    expect(textOf(saveButton(after).props.children)).toBe("Saved");
  });
});
