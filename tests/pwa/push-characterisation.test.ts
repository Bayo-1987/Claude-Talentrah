/**
 * U3 (service worker push handlers): what must NOT change. Written against the code as it stands before U3 and green on it; every one of these must still be
 * green after. They pin the parts of the worker, the route and the bootstrap that the push work touches next to, so a handler added beside them cannot move them.
 */
import { describe, expect, it } from "vitest";
import { KILL_SOURCE, OFFLINE_CACHE_NAME, WORKER_SOURCE } from "@/lib/pwa/service-worker-source";
import { GET } from "@/app/sw.js/route";
import { startPwa, type PwaWindow } from "@/lib/pwa/bootstrap";
import { loadWorker } from "./support/worker-harness";

describe("the /sw.js route", () => {
  it("keeps its exact headers, the CSP included, for the normal worker and for the kill worker", async () => {
    for (const kill of [undefined, "1"]) {
      if (kill) process.env.PWA_KILL = kill;
      else delete process.env.PWA_KILL;
      const h = (await GET()).headers;
      expect(h.get("content-security-policy")).toBe("default-src 'self'; script-src 'self'");
      expect(h.get("content-type")).toBe("application/javascript; charset=utf-8");
      expect(h.get("cache-control")).toBe("no-cache, no-store, must-revalidate");
      expect(h.get("set-cookie")).toBeNull();
    }
    delete process.env.PWA_KILL;
  });
});

describe("the normal worker", () => {
  it("never contains skipWaiting and never navigates or reloads a window", () => {
    expect(WORKER_SOURCE).not.toMatch(/skipWaiting/);
    expect(WORKER_SOURCE).not.toMatch(/\.navigate\(|\.reload\(|location\.href\s*=|location\.reload/);
  });

  it("stores only /offline: install adds it, and a navigation or a failed fetch never writes anything else", async () => {
    const w = loadWorker(WORKER_SOURCE);
    await w.runInstall();
    await w.runActivate();
    const hit = w.fetchEvent({ url: "/jobs" });
    await hit.response;
    w.fetchImpl.current = async () => {
      throw new TypeError("offline");
    };
    await w.fetchEvent({ url: "/jobs" }).response;
    expect(w.caches.writes).toEqual([{ cache: OFFLINE_CACHE_NAME, api: "add", url: "/offline" }]);
  });
});

describe("the kill worker", () => {
  it("registers exactly install and activate: no fetch, and (today and after U3) no push handler of its own", () => {
    expect(Object.keys(loadWorker(KILL_SOURCE).listeners).sort()).toEqual(["activate", "install"]);
  });

  it("deletes every cache and unregisters itself on activate, and calls skipWaiting once on install", async () => {
    const w = loadWorker(KILL_SOURCE);
    w.caches.names.add("talentrah-offline-v1");
    w.caches.names.add("other");
    await w.runInstall();
    await w.runActivate();
    expect(w.calls.skipWaiting).toBe(1);
    expect(w.caches.deleted.sort()).toEqual(["other", "talentrah-offline-v1"]);
    expect(w.calls.unregister).toBe(1);
  });
});

describe("the page-side kill path", () => {
  it("unregisters every registration it finds, whether or not that registration has a push manager, and deletes only this app's caches", async () => {
    const unregistered: number[] = [0, 0, 0];
    const regs = unregistered.map((_, i) => ({ unregister: async () => (unregistered[i]++, true) }));
    const deleted: string[] = [];
    const win = {
      location: { pathname: "/jobs" },
      document: { readyState: "complete" },
      navigator: { serviceWorker: { register: async () => ({}), getRegistrations: async () => regs } },
      caches: { keys: async () => ["talentrah-offline-v1", "someone-elses"], delete: async (n: string) => (deleted.push(n), true) },
      addEventListener: () => undefined,
      dispatchEvent: () => true,
      setTimeout: (fn: () => void) => (fn(), 0),
    } as unknown as PwaWindow & Record<string, unknown>;
    win.self = win;
    win.top = win;
    startPwa(win, false);
    await new Promise((r) => setTimeout(r, 0));
    expect(unregistered).toEqual([1, 1, 1]);
    expect(deleted).toEqual(["talentrah-offline-v1"]);
  });
});
