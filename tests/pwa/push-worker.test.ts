/**
 * U3: the normal worker's push and notificationclick handlers, run as the REAL script text in the fake worker scope (tests/pwa/support/worker-harness.ts).
 *
 * The rules under test (build prompt 02 section 0 and section 4, addendum R2): the worker still stores nothing but /offline; the normal worker never contains
 * skipWaiting; the push handler always shows a notification and uses neither fetch( nor caches.; a click opens only a same-origin, non-excluded path and anything else
 * opens /dashboard; the badge is a number from the payload and nothing else. Nothing here sends a push: the sender is U4 and every flag stays off.
 */
import { describe, expect, it } from "vitest";
import { OFFLINE_CACHE_NAME, WORKER_SOURCE } from "@/lib/pwa/service-worker-source";
import { loadWorker, ORIGIN } from "./support/worker-harness";

const worker = (opts: Parameters<typeof loadWorker>[1] = {}) => loadWorker(WORKER_SOURCE, opts);

/** The part of the worker source the push work lives in: from its first declaration to the install listener that follows it (no marker comments are served, only code). */
function pushSection(): string {
  const start = WORKER_SOURCE.indexOf("var DEFAULT_PATH");
  const end = WORKER_SOURCE.indexOf('self.addEventListener("install"');
  expect(start, "the push section starts at DEFAULT_PATH").toBeGreaterThan(-1);
  expect(end, "the install listener follows it").toBeGreaterThan(start);
  return WORKER_SOURCE.slice(start, end);
}

describe("the normal worker registers the push handlers", () => {
  it("registers a push handler", () => {
    expect(typeof worker().listeners.push).toBe("function");
  });
  it("registers a notificationclick handler", () => {
    expect(typeof worker().listeners.notificationclick).toBe("function");
  });
});

describe("the push handler always calls showNotification", () => {
  it("with no data at all: a generic notification", async () => {
    const w = worker();
    await w.pushEvent({ data: "none" });
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0].title).toBe("Talentrah");
    expect(typeof w.shown[0].options.body).toBe("string");
    expect((w.shown[0].options.data as { path: string }).path).toBe("/dashboard");
  });

  it("with malformed JSON: the same generic notification, and no throw", async () => {
    const w = worker();
    await w.pushEvent({ data: "throw" });
    await w.pushEvent({ data: "{not json" });
    expect(w.shown).toHaveLength(2);
    for (const s of w.shown) expect(s.title).toBe("Talentrah");
  });

  it("with a payload that is valid JSON but not an object (null, a number, an array, a string): generic", async () => {
    const w = worker();
    for (const raw of ["null", "7", "[1,2]", '"hi"']) await w.pushEvent({ data: raw });
    expect(w.shown).toHaveLength(4);
    for (const s of w.shown) expect(s.title).toBe("Talentrah");
  });

  it("with a valid payload: its title, body, tag and path", async () => {
    const w = worker();
    await w.pushEvent({ data: { title: "New applicant", body: "Someone applied.", path: "/employer/jobs", tag: "applicant", badge: 3 } });
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0].title).toBe("New applicant");
    expect(w.shown[0].options.body).toBe("Someone applied.");
    expect(w.shown[0].options.tag).toBe("applicant");
    expect((w.shown[0].options.data as { path: string }).path).toBe("/employer/jobs");
  });

  it("with fields of the wrong type: each falls back on its own, and the notification is still shown", async () => {
    const w = worker();
    await w.pushEvent({ data: { title: 5, body: { x: 1 }, tag: [], path: 9, badge: "3" } });
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0].title).toBe("Talentrah");
    expect(typeof w.shown[0].options.body).toBe("string");
    expect(w.shown[0].options.tag).toBeUndefined();
    expect((w.shown[0].options.data as { path: string }).path).toBe("/dashboard");
  });

  it("with a hostile path: the notification is shown, carrying /dashboard", async () => {
    const w = worker();
    await w.pushEvent({ data: { title: "x", path: "//evil.example/steal" } });
    expect(w.shown).toHaveLength(1);
    expect((w.shown[0].options.data as { path: string }).path).toBe("/dashboard");
  });

  it("still shows the notification when the Badging API rejects", async () => {
    const w = worker({ badging: "throws" });
    await w.pushEvent({ data: { title: "x", badge: 2 } });
    await w.pushEvent({ data: { title: "x", badge: 0 } });
    expect(w.shown).toHaveLength(2);
  });
});

describe("the push handler stores and fetches nothing", () => {
  it("after push and notificationclick events the cache holds only /offline", async () => {
    const w = worker({ windows: [{ url: `${ORIGIN}/jobs` }] });
    await w.runInstall();
    await w.runActivate();
    await w.pushEvent({ data: { title: "x", path: "/jobs", badge: 4 } });
    await w.pushEvent({ data: "none" });
    await w.clickEvent({ path: "/jobs" });
    await w.clickEvent({ path: "//evil.example" });
    expect(w.caches.opened).toEqual([OFFLINE_CACHE_NAME]);
    expect(w.caches.writes).toEqual([{ cache: OFFLINE_CACHE_NAME, api: "add", url: "/offline" }]);
  });

  it("neither handler calls fetch (the network is never touched by a push or a click)", async () => {
    const w = worker();
    await w.pushEvent({ data: { title: "x", path: "/jobs" } });
    await w.clickEvent({ path: "/jobs" });
    expect(w.fetched).toHaveLength(0);
  });

  it("the push handler contains no fetch( and no caches.", () => {
    const section = pushSection();
    expect(section).toMatch(/addEventListener\("push"/);
    expect(section).not.toMatch(/\bfetch\s*\(/);
    expect(section).not.toMatch(/\bcaches\b/);
  });

  it("the push section never calls skipWaiting, navigate or reload either", () => {
    expect(pushSection()).not.toMatch(/skipWaiting|\.navigate\(|\.reload\(/);
  });

  it("the normal worker still never contains skipWaiting", () => {
    expect(WORKER_SOURCE).not.toMatch(/skipWaiting/);
  });
});

/** Every one of these must land on /dashboard: a click can never be turned into an open redirect, an excluded route or a non-path. */
const HOSTILE: [string, unknown][] = [
  ["a protocol-relative URL", "//evil.example"],
  ["a protocol-relative URL with a path", "//evil.example/steal?x=1"],
  ["an absolute https URL", "https://evil.example"],
  ["an absolute https URL to our own host (not a path)", `${ORIGIN}/jobs`],
  ["a backslash after the slash", "/\\evil"],
  ["a backslash path", "\\\\evil.example"],
  ["a javascript: URL", "javascript:alert(1)"],
  ["a data: URL", "data:text/html,<script>1</script>"],
  ["/api/x", "/api/x"],
  ["/api itself", "/api"],
  ["/billing/callback", "/billing/callback"],
  ["/billing itself", "/billing"],
  ["/data-export/abc", "/data-export/abc"],
  ["/embed/x", "/embed/x"],
  ["a relative path with no leading slash", "dashboard"],
  ["an empty string", ""],
  ["a percent-encoded // (no leading slash)", "%2F%2Fevil.example"],
  ["a percent-encoded // (lower case)", "%2f%2fevil.example"],
  ["a slash then a percent-encoded /", "/%2F/evil.example"],
  ["a percent-encoded // after the first slash", "/%2F%2Fevil.example"],
  ["a percent-encoded backslash", "/%5Cevil.example"],
  ["a percent-encoded backslash (lower case)", "/%5cevil.example"],
  ["a double-encoded //", "/%252F%252Fevil.example"],
  ["an encoded /api (the server decodes it)", "/%61pi/x"],
  ["an encoded /billing", "/%62illing/callback"],
  ["a newline in the path", "/jobs\n//evil.example"],
  ["a tab in the path", "/jo\tbs"],
  ["a NUL in the path", "/jobs\u0000"],
  ["a DEL in the path", "/jobs\u007f"],
  ["a malformed percent escape", "/%E0%A4%A"],
  ["a number", 123],
  ["null", null],
  ["undefined", undefined],
  ["an object", { toString: () => "/jobs" }],
  ["an array", ["/jobs"]],
];

describe("a click with a bad path opens /dashboard", () => {
  it.each(HOSTILE)("%s", async (_label, path) => {
    const w = worker();
    await w.clickEvent({ path });
    expect(w.opened, "opened exactly one window").toEqual([`${ORIGIN}/dashboard`]);
    expect(w.closedNotifications).toBe(1);
  });

  it("a notification with no data at all opens /dashboard", async () => {
    const w = worker();
    await w.clickEvent({ data: null });
    await w.clickEvent({ data: undefined as unknown });
    expect(w.opened).toEqual([`${ORIGIN}/dashboard`, `${ORIGIN}/dashboard`]);
  });
});

describe("a good path focuses or opens", () => {
  it.each(["/jobs", "/tracker?tab=saved", "/jobs/abc#top", "/employer/jobs/123/applicants", "/dashboard", "/apix", "/billing-x"])("%s opens a window when none is open", async (path) => {
    const w = worker({ windows: [] });
    await w.clickEvent({ path });
    expect(w.opened).toEqual([`${ORIGIN}${path}`]);
    expect(w.focused).toEqual([]);
  });

  it("focuses an open window already on that URL instead of opening another", async () => {
    const w = worker({ windows: [{ url: `${ORIGIN}/tracker` }, { url: `${ORIGIN}/jobs` }] });
    await w.clickEvent({ path: "/jobs" });
    expect(w.focused).toEqual([`${ORIGIN}/jobs`]);
    expect(w.opened).toEqual([]);
  });

  it("opens the target when the open windows are on other pages (it does not navigate one of them)", async () => {
    const w = worker({ windows: [{ url: `${ORIGIN}/tracker` }] });
    await w.clickEvent({ path: "/jobs" });
    expect(w.opened).toEqual([`${ORIGIN}/jobs`]);
    expect(w.calls.navigate).toBe(0);
  });

  it("closes the notification it was clicked from", async () => {
    const w = worker();
    await w.clickEvent({ path: "/jobs" });
    expect(w.closedNotifications).toBe(1);
  });
});

describe("the badge in a payload is a number and nothing else", () => {
  it("a positive whole number sets the app badge to exactly that number, and the notification is still shown", async () => {
    const w = worker();
    await w.pushEvent({ data: { title: "x", badge: 7 } });
    expect(w.badge.set).toEqual([7]);
    expect(w.badge.cleared).toBe(0);
    expect(w.shown).toHaveLength(1);
  });

  it("zero clears the badge", async () => {
    const w = worker();
    await w.pushEvent({ data: { title: "x", badge: 0 } });
    expect(w.badge.cleared).toBe(1);
    expect(w.badge.set).toEqual([]);
  });

  it.each([["a numeric string", "7"], ["a negative number", -1], ["a fraction", 1.5], ["NaN", null], ["a boolean", true], ["an object", { n: 7 }], ["an array", [7]], ["missing", undefined]])(
    "%s changes nothing",
    async (_l, badge) => {
      const w = worker();
      await w.pushEvent({ data: { title: "x", badge } });
      expect(w.badge.set).toEqual([]);
      expect(w.badge.cleared).toBe(0);
      expect(w.shown).toHaveLength(1);
    },
  );

  it("Infinity and a huge number change nothing", async () => {
    const w = worker();
    await w.pushEvent({ data: '{"title":"x","badge":1e400}' });
    await w.pushEvent({ data: '{"title":"x","badge":1e12}' });
    expect(w.badge.set).toEqual([]);
    expect(w.shown).toHaveLength(2);
  });

  it("when the Badging API is missing nothing throws and the notification is still shown", async () => {
    const w = worker({ badging: false });
    await w.pushEvent({ data: { title: "x", badge: 5 } });
    await w.pushEvent({ data: { title: "x", badge: 0 } });
    expect(w.shown).toHaveLength(2);
  });

  it("when only setAppBadge exists, a zero badge does not throw", async () => {
    const w = worker({ badging: "set-only" });
    await w.pushEvent({ data: { title: "x", badge: 0 } });
    expect(w.shown).toHaveLength(1);
  });
});
