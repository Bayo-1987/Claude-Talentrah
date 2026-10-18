/**
 * The service worker is a decision table, not a cache (build prompt section 3). Every test here runs the REAL script text
 * (src/lib/pwa/service-worker-source.ts) in a fake worker scope (tests/pwa/support/worker-harness.ts).
 *
 * The table, in full:
 *   a GET navigation, same-origin, not an iframe, not under /api, /billing, /embed or /data-export  -> respondWith: preload or fetch; if that
 *                                                                                                     REJECTS, the cached /offline. Any HTTP
 *                                                                                                     response is returned unchanged. Stores nothing.
 *   any other navigation (POST, /api/*, /billing/*, /embed/*, /data-export/*, an iframe)             -> no respondWith
 *   everything else (every non-navigation fetch, every cross-origin request)                         -> no respondWith
 */
import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { WORKER_SOURCE, OFFLINE_CACHE_NAME, OFFLINE_URL } from "@/lib/pwa/service-worker-source";
import { loadWorker, ORIGIN, type FetchInit } from "./support/worker-harness";

const worker = () => loadWorker(WORKER_SOURCE);

describe("the script", () => {
  it("parses as JavaScript", () => {
    expect(() => new vm.Script(WORKER_SOURCE, { filename: "sw.js" })).not.toThrow();
  });

  it("NEVER calls skipWaiting (an update activates on the next load, so a half-finished form is not swapped under a person)", () => {
    expect(WORKER_SOURCE).not.toMatch(/skipWaiting/);
  });

  it("never navigates or reloads a window", () => {
    expect(WORKER_SOURCE).not.toMatch(/\.navigate\(|\.reload\(|location\.href\s*=|location\.reload/);
  });

  it("says why nothing is stored: a worker cannot read Set-Cookie", () => {
    expect(WORKER_SOURCE).toMatch(/Set-Cookie/);
  });

  it("names its one cache with a version, and the only URL it knows is /offline", () => {
    expect(OFFLINE_CACHE_NAME).toMatch(/^talentrah-offline-v\d+$/);
    expect(OFFLINE_URL).toBe("/offline");
  });
});

describe("install", () => {
  it("caches ONLY /offline, and never calls skipWaiting", async () => {
    const w = worker();
    await w.runInstall();
    expect(w.caches.opened).toEqual([OFFLINE_CACHE_NAME]);
    expect(w.caches.writes).toEqual([{ cache: OFFLINE_CACHE_NAME, api: "add", url: "/offline" }]);
    expect(w.calls.skipWaiting).toBe(0);
  });

  it("fetches /offline fresh from the network rather than from the HTTP cache", async () => {
    // A request built with cache "reload" bypasses a stale HTTP-cached copy, so a new worker version stores the page it was released with.
    expect(WORKER_SOURCE).toMatch(/cache:\s*"reload"/);
  });
});

describe("activate", () => {
  it("deletes every cache except its own, claims the open page, and turns navigation preload on", async () => {
    const w = worker();
    w.caches.names.add("talentrah-offline-v0");
    w.caches.names.add("some-old-workbox-cache");
    w.caches.names.add(OFFLINE_CACHE_NAME);
    await w.runActivate();
    expect(w.caches.deleted.sort()).toEqual(["some-old-workbox-cache", "talentrah-offline-v0"]);
    expect(w.caches.names.has(OFFLINE_CACHE_NAME)).toBe(true);
    expect(w.calls.claim).toBe(1);
    expect(w.calls.preloadEnable).toBe(1);
    expect(w.calls.skipWaiting).toBe(0);
  });
});

/** [label, request, expected] for the decision table, including every near miss the build prompt names. */
const TABLE: [string, FetchInit, boolean][] = [
  // intercepted: a plain same-origin GET navigation
  ["navigation to /", { url: "/" }, true],
  ["navigation to /jobs", { url: "/jobs" }, true],
  ["navigation to /jobs with a query", { url: "/jobs?q=nurse&page=2" }, true],
  ["navigation to /dashboard", { url: "/dashboard" }, true],
  ["navigation to /login", { url: "/login" }, true],
  ["navigation to /auth/callback", { url: "/auth/callback?code=abc&next=/jobs" }, true],
  ["navigation to /admin", { url: "/admin" }, true],
  ["navigation to /offline itself", { url: "/offline" }, true],
  // near misses: look like an excluded prefix but are not
  ["near miss /apix", { url: "/apix" }, true],
  ["near miss /api-docs", { url: "/api-docs" }, true],
  ["near miss /billing-x", { url: "/billing-x" }, true],
  ["near miss /billingx/callback", { url: "/billingx/callback" }, true],
  ["near miss /embedded", { url: "/embedded" }, true],
  ["near miss /data-exports", { url: "/data-exports" }, true],
  ["near miss /x/api/y (not the prefix)", { url: "/x/api/y" }, true],
  // pass-through: the excluded prefixes, exact and nested
  ["navigation to /api", { url: "/api" }, false],
  ["navigation to /api/", { url: "/api/" }, false],
  ["navigation to /api/anything", { url: "/api/billing/verify" }, false],
  ["navigation to /billing", { url: "/billing" }, false],
  ["navigation to /billing/", { url: "/billing/" }, false],
  ["navigation to /billing/callback (the Paystack return)", { url: "/billing/callback?reference=abc&trxref=abc" }, false],
  ["navigation to /embed", { url: "/embed" }, false],
  ["navigation to /embed/jobs/abc", { url: "/embed/jobs/abc" }, false],
  ["navigation to /data-export", { url: "/data-export" }, false],
  ["navigation to /data-export/abc (single use link: never retry it)", { url: "/data-export/abc?token=once" }, false],
  // pass-through: not a plain GET navigation
  ["a POST navigation (a form submit)", { url: "/jobs", method: "POST" }, false],
  ["a POST navigation to /login", { url: "/login", method: "POST" }, false],
  ["an iframe navigation", { url: "/jobs", destination: "iframe" }, false],
  ["an iframe navigation to /", { url: "/", destination: "iframe" }, false],
  ["a cross-origin navigation", { url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" }, false],
  ["a cross-origin navigation to a look-alike host", { url: "https://www.talentrah.com.evil.example/" }, false],
  // pass-through: everything that is not a navigation
  ["a script", { url: "/_next/static/chunks/a.js", mode: "no-cors", destination: "script" }, false],
  ["a stylesheet", { url: "/_next/static/css/a.css", mode: "no-cors", destination: "style" }, false],
  ["an image", { url: "/icons/talentrah-mark-192.png", mode: "no-cors", destination: "image" }, false],
  ["a font", { url: "/_next/static/media/f.woff2", mode: "cors", destination: "font" }, false],
  ["a fetch() JSON call", { url: "/api/farah/history", mode: "cors", destination: "" }, false],
  ["a fetch() to a page URL", { url: "/jobs", mode: "cors", destination: "" }, false],
  ["an RSC request", { url: "/jobs?_rsc=abc", mode: "cors", destination: "", headers: { RSC: "1" } }, false],
  ["a router prefetch", { url: "/tracker", mode: "cors", destination: "", headers: { "Next-Router-Prefetch": "1", RSC: "1" } }, false],
  ["a Server Action POST", { url: "/jobs", method: "POST", mode: "cors", destination: "", headers: { "Next-Action": "abc" } }, false],
  ["a range request", { url: "/files/a.pdf", mode: "no-cors", destination: "", headers: { Range: "bytes=0-99" } }, false],
  ["a cross-origin script", { url: "https://www.googletagmanager.com/gtag.js", mode: "no-cors", destination: "script" }, false],
  ["a cross-origin fetch", { url: "https://abc.supabase.co/rest/v1/x", mode: "cors", destination: "" }, false],
];

describe("the decision table: which requests the worker answers", () => {
  it.each(TABLE)("%s", (_label, init, expected) => {
    const w = worker();
    const { intercepted } = w.fetchEvent(init);
    expect(intercepted).toBe(expected);
  });

  it("a request it passes through is never fetched, cached or touched by the worker", async () => {
    const w = worker();
    for (const [, init, expected] of TABLE) if (!expected) w.fetchEvent(init);
    expect(w.fetched).toHaveLength(0);
    expect(w.caches.opened).toHaveLength(0);
  });

  it("an unlisted event type does nothing: the worker registers exactly install, activate and fetch", () => {
    expect(Object.keys(worker().listeners).sort()).toEqual(["activate", "fetch", "install"]);
  });
});

describe("what it does with a navigation it answers", () => {
  const NAV = { url: "/jobs?page=2" } satisfies FetchInit;

  it("returns whatever the network answers, unchanged, for every status (2xx, 3xx, 4xx, 5xx), and stores nothing", async () => {
    for (const status of [200, 204, 301, 302, 307, 308, 401, 403, 404, 429, 500, 503]) {
      const w = worker();
      const net = new Response(status === 204 || status >= 300 && status < 400 ? null : `body ${status}`, { status, headers: status >= 300 && status < 400 ? { Location: "/login" } : {} });
      w.fetchImpl.current = async () => net;
      const { intercepted, response } = w.fetchEvent(NAV);
      expect(intercepted).toBe(true);
      const got = await response!;
      expect(got, `status ${status}`).toBe(net);
      expect(got.status).toBe(status);
      expect(w.caches.writes, `status ${status}`).toEqual([]);
    }
  });

  it("hands the request to the network as it came, once", async () => {
    const w = worker();
    const { response } = w.fetchEvent(NAV);
    await response;
    expect(w.fetched).toHaveLength(1);
    expect(new URL(w.fetched[0].url).pathname + new URL(w.fetched[0].url).search).toBe("/jobs?page=2");
  });

  it("uses the navigation preload response when there is one, and does not fetch a second time", async () => {
    const w = worker();
    const preloaded = new Response("preloaded", { status: 200 });
    const { response } = w.fetchEvent({ ...NAV, preload: Promise.resolve(preloaded) });
    expect(await response!).toBe(preloaded);
    expect(w.fetched).toHaveLength(0);
  });

  it("answers with the cached /offline when the network REJECTS", async () => {
    const w = worker();
    w.fetchImpl.current = async () => {
      throw new TypeError("Failed to fetch");
    };
    const { response } = w.fetchEvent(NAV);
    const got = await response!;
    expect(await got.text()).toBe("OFFLINE PAGE");
    expect(w.caches.opened).toEqual([OFFLINE_CACHE_NAME]);
    expect(w.caches.writes).toEqual([]);
  });

  it("answers with the cached /offline when the preload response REJECTS", async () => {
    const w = worker();
    const { response } = w.fetchEvent({ ...NAV, preload: Promise.reject(new TypeError("preload failed")) });
    expect(await (await response!).text()).toBe("OFFLINE PAGE");
  });

  it("does not turn a server error into the offline page", async () => {
    const w = worker();
    w.fetchImpl.current = async () => new Response("Internal Server Error", { status: 500 });
    const { response } = w.fetchEvent(NAV);
    const got = await response!;
    expect(got.status).toBe(500);
    expect(await got.text()).toBe("Internal Server Error");
  });

  it("fails like the browser would (a network error) when offline and /offline was never cached, instead of hanging", async () => {
    const w = loadWorker(WORKER_SOURCE, { cachedOffline: false });
    w.fetchImpl.current = async () => {
      throw new TypeError("Failed to fetch");
    };
    const { response } = w.fetchEvent(NAV);
    const got = await response!;
    expect(got.type).toBe("error");
  });
});

describe("storing: the only write the worker ever makes", () => {
  it("is add('/offline') at install; across every row of the table and every outcome nothing else is ever put, added or addAll'd", async () => {
    const w = worker();
    await w.runInstall();
    await w.runActivate();
    for (const [, init] of TABLE) {
      const r = w.fetchEvent(init);
      await r.response?.catch(() => undefined);
    }
    w.fetchImpl.current = async () => {
      throw new TypeError("offline");
    };
    for (const [, init] of TABLE) {
      const r = w.fetchEvent(init);
      await r.response?.catch(() => undefined);
    }
    expect(w.caches.writes).toEqual([{ cache: OFFLINE_CACHE_NAME, api: "add", url: "/offline" }]);
  });
});

describe("origin handling", () => {
  it("compares against the worker's own origin, not a hard-coded host", () => {
    expect(WORKER_SOURCE).not.toContain("talentrah.com");
    expect(ORIGIN).toBe("https://www.talentrah.com");
  });
});
