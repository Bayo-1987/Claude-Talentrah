/**
 * The Farah launcher's "seen before" store (PR-1). ONE key, `talentrah.farahLauncher`, ONE value, `{"v":1,"opened":true}`, in the browser's own localStorage and nowhere else: no cookie, no
 * request, no other key. Written when the user first opens Farah; read after mount to decide whether the pill expands.
 *
 * Every storage access is in a try/catch (localStorage can throw on read, on write, or on merely touching the global), the stored value is validated on the way OUT, and when storage is
 * blocked the store falls back to a module variable: the pill shows once per page load, not on every navigation. The test environment is node, so a stub stands in for localStorage and for
 * the browser global (the store writes only in a browser).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "talentrah.farahLauncher";
const VALID = '{"v":1,"opened":true}';

type Seen = typeof import("@/lib/farah/launcher-seen");
/** A fresh copy of the module, so its module variable starts empty (a new page load). */
async function freshModule(): Promise<Seen> {
  vi.resetModules();
  return import("@/lib/farah/launcher-seen");
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const touched: string[] = [];
  return {
    data,
    touched,
    getItem: (k: string) => (touched.push(k), data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void (touched.push(k), data.set(k, String(v))),
    removeItem: (k: string) => void (touched.push(k), data.delete(k)),
  };
}
const boom = () => {
  throw new DOMException("The operation is insecure.", "SecurityError");
};

beforeEach(() => {
  vi.stubGlobal("window", {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  // a getter that throws is defined with defineProperty below; remove it so the next test starts clean
  if (Object.getOwnPropertyDescriptor(globalThis, "localStorage")?.get) delete (globalThis as Record<string, unknown>).localStorage;
});

describe("the key and the value", () => {
  it("the key is talentrah.farahLauncher", async () => {
    expect((await freshModule()).FARAH_LAUNCHER_KEY).toBe(KEY);
  });
  it("nothing is stored until the user opens Farah, and the first open writes exactly the one value under the one key", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const seen = await freshModule();
    expect(seen.hasSeenLauncher()).toBe(false);
    seen.markLauncherPillShown();
    expect(storage.data.size).toBe(0);
    seen.markLauncherOpened();
    expect([...storage.data.entries()]).toEqual([[KEY, VALID]]);
    expect(seen.hasSeenLauncher()).toBe(true);
  });
  it("it is remembered by the next page load", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    (await freshModule()).markLauncherOpened();
    expect((await freshModule()).hasSeenLauncher()).toBe(true);
  });
  it("opening twice writes the same value again, never a changed one (no counter, no timestamp)", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const seen = await freshModule();
    seen.markLauncherOpened();
    seen.markLauncherOpened();
    expect([...storage.data.entries()]).toEqual([[KEY, VALID]]);
  });
  it("the only key the store ever touches is its own", async () => {
    const storage = memoryStorage({ other: "x" });
    vi.stubGlobal("localStorage", storage);
    const seen = await freshModule();
    seen.hasSeenLauncher();
    seen.markLauncherPillShown();
    seen.markLauncherOpened();
    seen.hasSeenLauncher();
    expect([...new Set(storage.touched)]).toEqual([KEY]);
    expect(storage.data.get("other")).toBe("x");
  });
});

describe("the stored value is validated on the way out", () => {
  it.each([
    ["an empty string", ""],
    ["null as text", "null"],
    ["an array", "[]"],
    ["an empty object", "{}"],
    ["no opened", '{"v":1}'],
    ["no version", '{"opened":true}'],
    ["a wrong version", '{"v":2,"opened":true}'],
    ["a version as text", '{"v":"1","opened":true}'],
    ["opened as text", '{"v":1,"opened":"true"}'],
    ["opened false", '{"v":1,"opened":false}'],
    ["an extra field", '{"v":1,"opened":true,"visits":3}'],
    ["not JSON", "not json"],
    ["a bare true", "true"],
    ["a number", "1"],
    ["a huge string", "x".repeat(10_000)],
    ["a huge valid-looking object", `{"v":1,"opened":true,"pad":"${"x".repeat(10_000)}"}`],
    ["the exact value padded with whitespace to a long string (valid JSON, not what was written)", `${VALID}${" ".repeat(200)}`],
  ])("%s is treated as not seen", async (_name, stored) => {
    vi.stubGlobal("localStorage", memoryStorage({ [KEY]: stored }));
    const seen = await freshModule();
    expect(() => seen.hasSeenLauncher()).not.toThrow();
    expect(seen.hasSeenLauncher()).toBe(false);
  });
  it("the exact value is accepted", async () => {
    vi.stubGlobal("localStorage", memoryStorage({ [KEY]: VALID }));
    expect((await freshModule()).hasSeenLauncher()).toBe(true);
  });
});

describe("blocked or broken storage never throws", () => {
  it("every method throws (storage blocked): reads say not seen, writes are silent, nothing breaks", async () => {
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom });
    const seen = await freshModule();
    expect(() => seen.hasSeenLauncher()).not.toThrow();
    expect(seen.hasSeenLauncher()).toBe(false);
    expect(() => seen.markLauncherPillShown()).not.toThrow();
    expect(() => seen.markLauncherOpened()).not.toThrow();
  });
  it("merely touching the global throws: the same", async () => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: boom });
    const seen = await freshModule();
    expect(() => seen.hasSeenLauncher()).not.toThrow();
    expect(seen.hasSeenLauncher()).toBe(false);
    expect(() => seen.markLauncherOpened()).not.toThrow();
  });
  it("only the write throws (a full or read-only store): the open is still remembered for this page load", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: boom, removeItem: boom });
    const seen = await freshModule();
    expect(seen.hasSeenLauncher()).toBe(false);
    expect(() => seen.markLauncherOpened()).not.toThrow();
    expect(seen.hasSeenLauncher()).toBe(true);
  });
  it("no storage at all (the server): not seen, nothing thrown, and the markers do nothing there", async () => {
    vi.unstubAllGlobals(); // no window, no localStorage
    const seen = await freshModule();
    expect(() => seen.hasSeenLauncher()).not.toThrow();
    expect(seen.hasSeenLauncher()).toBe(false);
    seen.markLauncherPillShown();
    seen.markLauncherOpened();
    expect(seen.hasSeenLauncher()).toBe(false);
  });
});

describe("when storage is blocked, the pill shows once per page load", () => {
  it("not seen at first; once the pill has been shown it is seen for the rest of the page load (client navigations do not re-expand it)", async () => {
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom });
    const seen = await freshModule();
    expect(seen.hasSeenLauncher()).toBe(false);
    seen.markLauncherPillShown();
    expect(seen.hasSeenLauncher()).toBe(true);
  });
  it("a new page load (a new module) shows the pill again", async () => {
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom });
    (await freshModule()).markLauncherPillShown();
    expect((await freshModule()).hasSeenLauncher()).toBe(false);
  });
  it("with WORKING storage, showing the pill alone does not mark it seen (the pill stays until the user opens Farah)", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const seen = await freshModule();
    seen.markLauncherPillShown();
    expect(seen.hasSeenLauncher()).toBe(false);
  });
});

describe("nothing leaves the browser", () => {
  it("no request, no beacon, no cookie is touched by any call", async () => {
    const fetchSpy = vi.fn();
    const beacon = vi.fn();
    const cookieTouched = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    vi.stubGlobal("document", {
      get cookie() {
        cookieTouched();
        return "";
      },
      set cookie(_v: string) {
        cookieTouched();
      },
    });
    vi.stubGlobal("localStorage", memoryStorage());
    const seen = await freshModule();
    seen.hasSeenLauncher();
    seen.markLauncherPillShown();
    seen.markLauncherOpened();
    seen.hasSeenLauncher();
    expect([fetchSpy.mock.calls.length, beacon.mock.calls.length, cookieTouched.mock.calls.length]).toEqual([0, 0, 0]);
  });
  it("the source names no network, cookie or other storage API (comments excluded)", () => {
    const source = readFileSync(path.join(__dirname, "../../src/lib/farah/launcher-seen.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of ["fetch(", "XMLHttpRequest", "sendBeacon", "document.cookie", "sessionStorage", "indexedDB", "cookieStore", "WebSocket", "supabase", "server-only"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
    // the key literal appears exactly once, in its one definition
    expect(source.match(/talentrah\.farahLauncher/g)?.length).toBe(1);
  });
  it("every storage access in the source sits inside a try block", () => {
    const source = readFileSync(path.join(__dirname, "../../src/lib/farah/launcher-seen.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const accesses = [...source.matchAll(/localStorage/g)].map((m) => m.index!);
    expect(accesses.length).toBeGreaterThan(0);
    for (const at of accesses) {
      const before = source.slice(0, at);
      expect(before.lastIndexOf("try {"), `localStorage at ${at}`).toBeGreaterThan(before.lastIndexOf("}\n}"));
      expect(before.lastIndexOf("try {")).toBeGreaterThan(-1);
    }
  });
});
