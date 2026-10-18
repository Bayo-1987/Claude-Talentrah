/**
 * Shared helpers for the installable-app specs. The worker is registered by the page after load and idle time, so every spec waits for it to
 * be ACTIVE and CONTROLLING the page before it does anything that depends on it.
 */
import { expect, type Page } from "@playwright/test";

/**
 * Resolves once a service worker is activated for this origin, controls the current page (the worker calls clients.claim() on activate) AND
 * has navigation preload enabled.
 *
 * WHY expect.poll AND NOT page.waitForFunction. waitForFunction with an async predicate resolved on its FIRST poll here, whatever the
 * predicate answered (measured: "wait done" 14ms after navigation, long before the worker existed, so every spec after it raced the real
 * registration and failed about half the time). Polling a page.evaluate that returns a plain boolean has no such trap.
 *
 * Navigation preload is waited for on purpose: Chromium reports the worker "activated" slightly before `getState()` shows what the worker's
 * `activate` enabled, so asserting it straight away tests the race, not the worker.
 */
export async function waitForWorkerControl(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          if (!("serviceWorker" in navigator)) return "no serviceWorker";
          const regs = await navigator.serviceWorker.getRegistrations();
          const reg = regs[0];
          if (regs.length !== 1) return `registrations: ${regs.length}`;
          if (reg.active?.state !== "activated") return `worker state: ${reg.active?.state ?? "none"}`;
          if (!navigator.serviceWorker.controller) return "page not controlled yet";
          return (await reg.navigationPreload.getState()).enabled ? "ready" : "navigation preload not enabled yet";
        }),
      { message: "the service worker becoming active, controlling the page, with navigation preload on", timeout: 20_000, intervals: [100, 250, 500] },
    )
    .toBe("ready");
}

/** Names of every Cache Storage cache, from inside the page. */
export async function cacheNames(page: Page): Promise<string[]> {
  return page.evaluate(() => caches.keys());
}

/** Pathnames of every request stored in the given cache. */
export async function cachedPaths(page: Page, name: string): Promise<string[]> {
  return page.evaluate(async (n) => {
    const cache = await caches.open(n);
    return (await cache.keys()).map((r) => new URL(r.url).pathname);
  }, name);
}

/** Every registration for this origin, as scope strings, from inside the page. */
export async function registrationScopes(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope));
}
