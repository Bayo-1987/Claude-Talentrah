/**
 * /sw.js (build prompt section 1 and the design note's tests 8 and 9): the route serves the normal worker, or the self-destruct worker when
 * PWA_KILL is "1", with the stated headers. The self-destruct worker unregisters itself and NEVER reloads or navigates a window: the earlier
 * version reloaded open windows while the page kept re-registering /sw.js, which reinstalled the kill worker on every load.
 */
import { afterEach, describe, expect, it } from "vitest";
import vm from "node:vm";
import { GET, dynamic } from "@/app/sw.js/route";
import { KILL_SOURCE, WORKER_SOURCE } from "@/lib/pwa/service-worker-source";
import { loadWorker } from "./support/worker-harness";

const saved = process.env.PWA_KILL;
afterEach(() => {
  if (saved === undefined) delete process.env.PWA_KILL;
  else process.env.PWA_KILL = saved;
});

describe("/sw.js headers", () => {
  it("is dynamic, so the kill switch is read when the worker is fetched", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("serves JavaScript that is never cached and carries its own tight CSP", async () => {
    delete process.env.PWA_KILL;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-cache, no-store, must-revalidate");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'self'; script-src 'self'");
  });

  it("sends the same headers when it serves the self-destruct worker", async () => {
    process.env.PWA_KILL = "1";
    const res = await GET();
    expect(res.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-cache, no-store, must-revalidate");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'self'; script-src 'self'");
  });

  it("sets no cookie", async () => {
    delete process.env.PWA_KILL;
    expect((await GET()).headers.get("set-cookie")).toBeNull();
  });
});

describe("kill switch: which worker is served", () => {
  it("serves the normal worker when PWA_KILL is unset", async () => {
    delete process.env.PWA_KILL;
    expect(await (await GET()).text()).toBe(WORKER_SOURCE);
  });

  it("serves the self-destruct worker when PWA_KILL is exactly '1'", async () => {
    process.env.PWA_KILL = "1";
    const body = await (await GET()).text();
    expect(body).toBe(KILL_SOURCE);
    expect(body).toMatch(/unregister/);
    expect(body).toMatch(/caches\.delete/);
  });

  it.each(["", "0", "true", "yes", " 1", "1 "])("serves the normal worker for PWA_KILL=%j (only '1' kills)", async (v) => {
    process.env.PWA_KILL = v;
    expect(await (await GET()).text()).toBe(WORKER_SOURCE);
  });
});

describe("the self-destruct worker", () => {
  it("parses as JavaScript", () => {
    expect(() => new vm.Script(KILL_SOURCE, { filename: "sw-kill.js" })).not.toThrow();
  });

  it("does not reload, navigate or message any window, and does not even look at them", () => {
    expect(KILL_SOURCE).not.toMatch(/\.navigate\(|\.reload\(|location|postMessage|matchAll|clients\./);
  });

  it("has no fetch handler, so while it is installed it answers nothing", () => {
    expect(Object.keys(loadWorker(KILL_SOURCE).listeners)).not.toContain("fetch");
  });

  it("on install takes over at once (skipWaiting)", async () => {
    const w = loadWorker(KILL_SOURCE);
    await w.runInstall();
    expect(w.calls.skipWaiting).toBe(1);
  });

  it("on activate deletes EVERY cache and unregisters itself, and touches no window", async () => {
    const w = loadWorker(KILL_SOURCE);
    for (const n of ["talentrah-offline-v1", "talentrah-offline-v0", "another-cache"]) w.caches.names.add(n);
    await w.runActivate();
    expect(w.caches.deleted.sort()).toEqual(["another-cache", "talentrah-offline-v0", "talentrah-offline-v1"]);
    expect(w.calls.unregister).toBe(1);
    expect(w.calls.navigate).toBe(0);
    expect(w.calls.claim).toBe(0);
  });
});
