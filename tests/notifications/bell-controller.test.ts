/**
 * The bell's behaviour without React: load on mount and on visibilitychange, mark ONE read only when an item is opened, mark all only when asked, and after EVERY load and every read-state write the app badge is
 * synced to the count the server answered (NOTIF-BADGE-CALLERS-1). Opening the bell, on its own, writes nothing.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createBellController, type BellState } from "@/components/notifications/bell-controller";

type Req = { url: string; method: string };
let requests: Req[];
let answers: Record<string, { status: number; body: unknown }>;
const fetchImpl = (async (url: string, init?: { method?: string }) => {
  requests.push({ url, method: init?.method ?? "GET" });
  const a = answers[`${init?.method ?? "GET"} ${url}`] ?? { status: 500, body: {} };
  return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body } as Response;
}) as unknown as typeof fetch;

const ITEMS = [
  { id: "n1", type: "m", title: "A", body: "a", link: "/jobs/1", createdAt: "2026-11-02T00:00:00Z", read: false },
  { id: "n2", type: "m", title: "B", body: "b", link: null, createdAt: "2026-11-01T00:00:00Z", read: false },
];
let synced: Array<number | null>;
let last: BellState;
const make = () => createBellController({ fetchImpl, syncBadge: (n) => synced.push(n), onChange: (s) => (last = s) });

beforeEach(() => {
  requests = [];
  synced = [];
  answers = {
    "GET /api/notifications": { status: 200, body: { items: ITEMS, unreadCount: 2 } },
    "POST /api/notifications/read-all": { status: 200, body: { unreadCount: 0 } },
    "POST /api/notifications/n1/read": { status: 200, body: { unreadCount: 1 } },
  };
});

describe("load", () => {
  it("fetches the list, shows it, and syncs the badge to the server's count", async () => {
    const c = make();
    await c.load();
    expect(requests).toEqual([{ url: "/api/notifications", method: "GET" }]);
    expect(last.items).toHaveLength(2);
    expect(last.unreadCount).toBe(2);
    expect(synced).toEqual([2]);
  });
  it("a 404 (the flag was turned off) hides the bell and syncs nothing", async () => {
    answers["GET /api/notifications"] = { status: 404, body: {} };
    const c = make();
    await c.load();
    expect(last.status).toBe("hidden");
    expect(synced).toEqual([]);
  });
  it("a failed load keeps what was shown and syncs nothing", async () => {
    const c = make();
    await c.load();
    synced.length = 0;
    answers["GET /api/notifications"] = { status: 500, body: {} };
    await c.load();
    expect(last.items).toHaveLength(2);
    expect(synced).toEqual([]);
  });
});

describe("read-state writers", () => {
  it("opening ONE item posts for that id only, marks only it read, and syncs the badge to the answer", async () => {
    const c = make();
    await c.load();
    requests.length = 0;
    synced.length = 0;
    await c.markOne("n1");
    expect(requests).toEqual([{ url: "/api/notifications/n1/read", method: "POST" }]);
    expect(last.items.map((i) => [i.id, i.read])).toEqual([["n1", true], ["n2", false]]);
    expect(last.unreadCount).toBe(1);
    expect(synced).toEqual([1]);
  });
  it("mark all posts once, marks every item read, and syncs the badge to 0", async () => {
    const c = make();
    await c.load();
    requests.length = 0;
    synced.length = 0;
    await c.markAll();
    expect(requests).toEqual([{ url: "/api/notifications/read-all", method: "POST" }]);
    expect(last.items.every((i) => i.read)).toBe(true);
    expect(last.unreadCount).toBe(0);
    expect(synced).toEqual([0]);
  });
  it("a failed write changes nothing and syncs nothing", async () => {
    answers["POST /api/notifications/read-all"] = { status: 500, body: {} };
    const c = make();
    await c.load();
    synced.length = 0;
    await c.markAll();
    expect(last.items.some((i) => !i.read)).toBe(true);
    expect(synced).toEqual([]);
  });
  it("opening or closing the bell writes nothing (only an item or 'mark all' does)", async () => {
    const c = make();
    await c.load();
    requests.length = 0;
    c.toggle();
    c.toggle();
    expect(requests).toEqual([]);
    expect(last.open).toBe(false);
  });
});

describe("visibilitychange", () => {
  it("reloads and re-syncs when the page becomes visible, and not when it is hidden", async () => {
    const listeners: Record<string, () => void> = {};
    const doc = { visibilityState: "hidden", addEventListener: (t: string, f: () => void) => (listeners[t] = f), removeEventListener: () => {} };
    const c = make();
    const stop = c.watchVisibility(doc as never);
    await c.load();
    requests.length = 0;
    synced.length = 0;
    listeners.visibilitychange();
    expect(requests).toEqual([]);
    doc.visibilityState = "visible";
    listeners.visibilitychange();
    await Promise.resolve();
    await Promise.resolve();
    expect(requests).toEqual([{ url: "/api/notifications", method: "GET" }]);
    expect(typeof stop).toBe("function");
  });
});
