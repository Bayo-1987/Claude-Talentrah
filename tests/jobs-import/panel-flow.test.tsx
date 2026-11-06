/**
 * PR-U1: the panel's FLOW, with a mocked fetch and no browser. Choose a file, press Preview, read the counts, and see that Confirm stays disabled until the tick; Confirm sends the three
 * numbers it was shown (hash, importable, batches) and the tick; a 409 says the file changed and to preview again (and shows no counts); a 403 shows no counts.
 *
 * There is no DOM library in this repo, so this uses the small hook harness tests/pwa/employer-install-strip-behaviour.test.tsx uses: React's hooks become slots that live across renders
 * of ONE mounted component, `render()` runs the panel again, and the test reads the returned element tree (it does not expand child components) and calls the handlers it finds, as a click
 * or a change would. Only `fetch` is faked (a stubbed global, not a module).
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

import { JobsImportPanel } from "@/components/admin/jobs-import-panel";

type El = { type: unknown; props: Record<string, unknown> };
const isEl = (n: unknown): n is El => typeof n === "object" && n !== null && "type" in n && "props" in n;

class Inst {
  slots: unknown[] = [];
  cursor = 0;
  dirty = false;
  private effects: Array<[number, () => void | (() => void), unknown[] | undefined]> = [];
  private prevDeps: Record<number, unknown[] | undefined> = {};
  useState = (init: unknown) => {
    const i = this.cursor++;
    if (!(i in this.slots)) this.slots[i] = typeof init === "function" ? (init as () => unknown)() : init;
    return [
      this.slots[i],
      (next: unknown) => {
        this.slots[i] = typeof next === "function" ? (next as (p: unknown) => unknown)(this.slots[i]) : next;
        this.dirty = true;
      },
    ];
  };
  useRef = (init: unknown) => {
    const i = this.cursor++;
    if (!(i in this.slots)) this.slots[i] = { current: init };
    return this.slots[i];
  };
  useCallback = (fn: unknown) => {
    const i = this.cursor++;
    if (!(i in this.slots)) this.slots[i] = fn;
    return this.slots[i];
  };
  useEffect = (fn: () => void | (() => void), deps?: unknown[]) => {
    this.effects.push([this.cursor++, fn, deps]);
  };
  render(): unknown {
    h.cur = this;
    this.cursor = 0;
    this.dirty = false;
    this.effects = [];
    const out = JobsImportPanel();
    h.cur = null;
    for (const [i, fn, deps] of this.effects) {
      const prev = this.prevDeps[i];
      const changed = !(i in this.prevDeps) || !deps || !prev || deps.length !== prev.length || deps.some((d, k) => d !== prev[k]);
      if (changed) {
        fn();
        this.prevDeps[i] = deps;
      }
    }
    return out;
  }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
/** Render, then keep re-rendering while a state change is pending (an async handler needs a turn to land). */
async function settle(inst: Inst) {
  let out = inst.render();
  for (let i = 0; i < 20; i += 1) {
    await flush();
    if (!inst.dirty) break;
    out = inst.render();
  }
  return out;
}

function all(node: unknown, pred: (e: El) => boolean): El[] {
  if (Array.isArray(node)) return node.flatMap((n) => all(n, pred));
  if (!isEl(node)) return [];
  return [...(pred(node) ? [node] : []), ...all(node.props.children, pred)];
}
function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isEl(node)) return textOf(node.props.children);
  return "";
}
const button = (tree: unknown, label: string) => all(tree, (e) => typeof e.type !== "string" && textOf(e).includes(label) && typeof e.props.onClick === "function")[0];
const fileInput = (tree: unknown) => all(tree, (e) => e.type === "input" && e.props.type === "file")[0];
const tickBox = (tree: unknown) => all(tree, (e) => e.type === "input" && e.props.type === "checkbox")[0];
/** Calls a handler the panel put on an element, as a click or a change would. */
const fire = (el: El, name: "onClick" | "onChange", arg?: unknown): unknown => (el.props[name] as (a?: unknown) => unknown)(arg);
const isDisabled = (el: El) => el.props.disabled === true;
const previewBlock = (tree: unknown) => all(tree, (e) => e.props["data-testid"] === "jobs-import-preview")[0];

const PREVIEW = {
  ok: true,
  preview: {
    sha12: "abcdef012345",
    sourceKey: "manual-upload-20261105-abcdef01",
    counts: {
      rows: 838,
      importable: 800,
      importableByKind: { link: 700, emailPlusLink: 50, emailOnly: 50 },
      batches: 17,
      skippedByReason: { "deadline already passed": 38 },
      inFileDuplicates: 2,
      alreadyOnTalentrah: 3,
    },
    lines: [{ line: 2, title: "Role A", company: "Co A", batch: 1, reason: "" }],
    truncated: false,
    previewCsv: "",
    notice: "",
  },
};

type Reply = { status: number; json: unknown };
function stubFetch(replies: Reply[]) {
  const calls: { url: string; init: RequestInit & { body: FormData } }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit & { body: FormData }) => {
      calls.push({ url, init });
      const r = replies.shift();
      if (!r) throw new Error("no reply left");
      return { status: r.status, json: async () => r.json };
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

async function chooseFileAndPreview(inst: Inst) {
  let tree = await settle(inst);
  fire(fileInput(tree), "onChange", { target: { files: [new File(["a,b\n1,2\n"], "jobs.csv", { type: "text/csv" })], value: "" } });
  tree = await settle(inst);
  await fire(button(tree, "Preview"), "onClick");
  return settle(inst);
}

describe("choosing a file and previewing", () => {
  it("Preview is disabled until a file is chosen, and enabled after", async () => {
    const inst = new Inst();
    let tree = await settle(inst);
    expect(isDisabled(button(tree, "Preview"))).toBe(true);
    fire(fileInput(tree), "onChange", { target: { files: [new File(["x"], "jobs.csv")], value: "" } });
    tree = await settle(inst);
    expect(isDisabled(button(tree, "Preview"))).toBe(false);
  });

  it("calls the preview route once with the file, and shows the counts it was given", async () => {
    const calls = stubFetch([{ status: 200, json: PREVIEW }]);
    const tree = await chooseFileAndPreview(new Inst());
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/admin/jobs-import/preview");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.body.get("file") as File).name).toBe("jobs.csv");
    const text = textOf(previewBlock(tree));
    expect(text).toContain("838 rows");
    expect(text).toContain("800 would be added");
    expect(text).toContain("17 batch");
    expect(text).toContain("38 skipped: deadline already passed");
    expect(text).toContain("2 repeat an earlier row");
    expect(text).toContain("3 are already on Talentrah");
  });
});

describe("confirm", () => {
  it("stays disabled until the tick, then sends the three numbers it was shown and the tick", async () => {
    const calls = stubFetch([{ status: 200, json: PREVIEW }, { status: 200, json: { ok: true, message: "800 jobs were added and 0 were already there." } }]);
    const inst = new Inst();
    let tree = await chooseFileAndPreview(inst);
    expect(isDisabled(button(tree, "Confirm and write"))).toBe(true);
    fire(tickBox(tree), "onChange", { target: { checked: true } });
    tree = await settle(inst);
    expect(isDisabled(button(tree, "Confirm and write"))).toBe(false);
    await fire(button(tree, "Confirm and write"), "onClick");
    tree = await settle(inst);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe("/admin/jobs-import/confirm");
    const form = calls[1].init.body;
    expect(form.get("sha12")).toBe("abcdef012345");
    expect(form.get("importable")).toBe("800");
    expect(form.get("batches")).toBe("17");
    expect(form.get("tick")).toBe("on");
    expect(form.get("file")).toBeInstanceOf(File);
    expect(textOf(tree)).toContain("800 jobs were added");
    expect(previewBlock(tree)).toBeUndefined();
  });

  it("a 409 says the file changed and to preview again, and shows no counts", async () => {
    stubFetch([{ status: 200, json: PREVIEW }, { status: 409, json: { ok: false, code: "preview_changed" } }]);
    const inst = new Inst();
    let tree = await chooseFileAndPreview(inst);
    fire(tickBox(tree), "onChange", { target: { checked: true } });
    tree = await settle(inst);
    await fire(button(tree, "Confirm and write"), "onClick");
    tree = await settle(inst);
    expect(textOf(tree)).toMatch(/file changed/i);
    expect(textOf(tree)).toMatch(/preview it again/i);
    expect(previewBlock(tree)).toBeUndefined();
    expect(textOf(tree)).not.toContain("would be added");
  });
});

describe("a refusal", () => {
  it("a 403 on Preview shows no counts and says there is no permission", async () => {
    stubFetch([{ status: 403, json: { ok: false, code: "missing_permission" } }]);
    const tree = await chooseFileAndPreview(new Inst());
    expect(previewBlock(tree)).toBeUndefined();
    expect(textOf(tree)).not.toMatch(/would be added|838 rows/);
    expect(textOf(tree)).toMatch(/permission/i);
  });
});
