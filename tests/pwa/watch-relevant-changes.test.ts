/**
 * The install strip re-decides only when something that can change its answer appears or goes: Farah's first-visit hint or the cookie banner, added or removed, at ANY depth
 * of an added or removed subtree (src/lib/pwa/watch-relevant-changes.ts). It used to observe every change under <body>, which on a busy feed meant a decision per DOM change.
 *
 * No browser here: a fake MutationObserver and fake nodes (nodeType, matches, querySelector). The live behaviour is e2e/pwa-install-strip.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { FARAH_FIRST_VISIT_HINT_TEST_ID } from "@/lib/farah/first-visit-hint-id";
import { COOKIE_BANNER_TEST_ID, isRelevantRecord, watchRelevantChanges } from "@/lib/pwa/watch-relevant-changes";

const sel = (id: string) => `[data-testid="${id}"]`;

interface FakeNode {
  nodeType: number;
  testId?: string;
  children: FakeNode[];
  matches(s: string): boolean;
  querySelector(s: string): FakeNode | null;
}
/** An element with an optional test id and children; querySelector searches descendants like the real one. */
function el(testId?: string, children: FakeNode[] = []): FakeNode {
  const node: FakeNode = {
    nodeType: 1,
    testId,
    children,
    matches: (s) => testId !== undefined && s.split(",").map((x) => x.trim()).includes(sel(testId)),
    querySelector: (s): FakeNode | null => {
      for (const c of children) {
        if (c.matches(s)) return c;
        const deeper = c.querySelector(s);
        if (deeper) return deeper;
      }
      return null;
    },
  };
  return node;
}
const text = (): FakeNode => ({ nodeType: 3, children: [], matches: () => false, querySelector: () => null });
const added = (...n: FakeNode[]) => ({ type: "childList", addedNodes: n, removedNodes: [] }) as unknown as MutationRecord;
const removed = (...n: FakeNode[]) => ({ type: "childList", addedNodes: [], removedNodes: n }) as unknown as MutationRecord;
const attr = () => ({ type: "attributes", addedNodes: [], removedNodes: [] }) as unknown as MutationRecord;

class FakeObserver {
  static last: FakeObserver;
  observed: { target: unknown; options: MutationObserverInit }[] = [];
  disconnected = false;
  constructor(public callback: (records: MutationRecord[]) => void) {
    FakeObserver.last = this;
  }
  observe(target: unknown, options: MutationObserverInit) {
    this.observed.push({ target, options });
  }
  disconnect() {
    this.disconnected = true;
  }
  emit(...records: MutationRecord[]) {
    this.callback(records);
  }
}

function watch() {
  let calls = 0;
  const body = {} as Node;
  const root = {} as Node;
  const stop = watchRelevantChanges(FakeObserver as unknown as typeof MutationObserver, body, root, () => calls++);
  return { obs: FakeObserver.last, calls: () => calls, stop, body, root };
}

describe("isRelevantRecord", () => {
  it("an unrelated element or text node is not relevant", () => {
    expect(isRelevantRecord(added(el("feed-card"), text(), el()))).toBe(false);
    expect(isRelevantRecord(removed(el("feed-card"), text()))).toBe(false);
  });
  it("the hint or the banner added or removed directly is relevant", () => {
    expect(isRelevantRecord(added(el(FARAH_FIRST_VISIT_HINT_TEST_ID)))).toBe(true);
    expect(isRelevantRecord(removed(el(FARAH_FIRST_VISIT_HINT_TEST_ID)))).toBe(true);
    expect(isRelevantRecord(added(el(COOKIE_BANNER_TEST_ID)))).toBe(true);
    expect(isRelevantRecord(removed(el(COOKIE_BANNER_TEST_ID)))).toBe(true);
  });
  it("looks INSIDE added and removed subtrees: a hint nested in a wrapper added or removed with it", () => {
    const wrapper = () => el("shell", [el(undefined, [el(undefined, [el(FARAH_FIRST_VISIT_HINT_TEST_ID)])])]);
    expect(isRelevantRecord(added(wrapper()))).toBe(true);
    expect(isRelevantRecord(removed(wrapper()))).toBe(true);
  });
  it("a subtree without either is not relevant however deep it is", () => {
    expect(isRelevantRecord(added(el("a", [el("b", [el("c", [el("d")])])])))).toBe(false);
  });
  it("an attribute change on the observed root is relevant (the returning-visitor marker)", () => {
    expect(isRelevantRecord(attr())).toBe(true);
  });
});

describe("watchRelevantChanges", () => {
  it("a burst of unrelated DOM changes calls decide() ZERO times", () => {
    const w = watch();
    for (let i = 0; i < 500; i++) w.obs.emit(added(el(`card-${i}`, [el("inner"), text()])), removed(el(`old-${i}`)));
    expect(w.calls()).toBe(0);
  });

  it("adding and removing a relevant node calls decide()", () => {
    const w = watch();
    w.obs.emit(added(el(FARAH_FIRST_VISIT_HINT_TEST_ID)));
    expect(w.calls()).toBe(1);
    w.obs.emit(removed(el(FARAH_FIRST_VISIT_HINT_TEST_ID)));
    expect(w.calls()).toBe(2);
    w.obs.emit(removed(el(COOKIE_BANNER_TEST_ID)));
    expect(w.calls()).toBe(3);
  });

  it("a hint added inside a nested element, and its removal, trigger the re-check", () => {
    const w = watch();
    w.obs.emit(added(el("page", [el("column", [el(FARAH_FIRST_VISIT_HINT_TEST_ID)])])));
    expect(w.calls()).toBe(1);
    w.obs.emit(removed(el("page", [el("column", [el(FARAH_FIRST_VISIT_HINT_TEST_ID)])])));
    expect(w.calls()).toBe(2);
  });

  it("one callback with many records decides once, and only if one of them is relevant", () => {
    const w = watch();
    w.obs.emit(added(el("x")), added(el("y")), removed(el(FARAH_FIRST_VISIT_HINT_TEST_ID)), added(el("z")));
    expect(w.calls()).toBe(1);
  });

  it("observes the body's subtree for added/removed nodes and the root's marker attribute, and nothing else", () => {
    const w = watch();
    expect(w.obs.observed).toEqual([
      { target: w.body, options: { childList: true, subtree: true } },
      { target: w.root, options: { attributes: true, attributeFilter: ["data-cookie-consent"] } },
    ]);
  });

  it("after unmount the observer is disconnected and no further decide() runs, even for a relevant change already queued", () => {
    const w = watch();
    w.stop();
    expect(w.obs.disconnected).toBe(true);
    w.obs.emit(added(el(FARAH_FIRST_VISIT_HINT_TEST_ID)), removed(el(COOKIE_BANNER_TEST_ID)));
    expect(w.calls()).toBe(0);
  });
});
