import { chromium, test, expect } from "@playwright/test";
import { cacheNames, registrationScopes, waitForWorkerControl } from "./support/pwa";

/**
 * The kill switch, in a real browser (build prompt section 1). PWA_KILL is read at BUILD time by the root layout and at request time by /sw.js, so
 * the app under test has to be BUILT and started with it set; these specs therefore do nothing unless PWA_KILL_PHASE says which server is up:
 *
 *   PWA_KILL_PHASE=install  the normal build (PWA_KILL unset): installs a worker into the profile at PWA_PROFILE_DIR, then closes
 *   PWA_KILL_PHASE=killed   a build made and started with PWA_KILL=1, loaded in that SAME profile: the old worker must be gone and nothing reloads
 *   PWA_KILL_PHASE=fresh    a build made and started with PWA_KILL=1, loaded in an empty profile: nothing is ever registered and nothing reloads
 *
 * (The commands are in docs/pwa.md. CI runs one normal build, so these are skipped there.)
 */
const PHASE = process.env.PWA_KILL_PHASE;
const PROFILE = process.env.PWA_PROFILE_DIR;
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.describe("PWA_KILL", () => {
  test.skip(!PHASE, "set PWA_KILL_PHASE (see the header) against a server built for that phase");

  test("install phase: a worker is installed in the profile", async () => {
    test.skip(PHASE !== "install", "phase is not install");
    const ctx = await chromium.launchPersistentContext(PROFILE!, { baseURL: BASE });
    const page = await ctx.newPage();
    await page.goto("/about");
    await waitForWorkerControl(page);
    expect(await cacheNames(page)).toEqual(["talentrah-offline-v1"]);
    await ctx.close();
  });

  test("killed phase: a previously installed worker is unregistered with its caches, and nothing reloads", async () => {
    test.skip(PHASE !== "killed", "phase is not killed");
    const ctx = await chromium.launchPersistentContext(PROFILE!, { baseURL: BASE });
    const page = await ctx.newPage();
    // Playwright reports a framenavigated for the commit and another for the document, so a page that loaded once is not "1"; the load event is.
    let loads = 0;
    page.on("load", () => loads++);
    await page.addInitScript(() => {
      const w = window as unknown as { __loads?: number };
      w.__loads = (w.__loads ?? 0) + 1;
    });
    await page.goto("/about");
    // The page-side bootstrap unregisters (and deletes this app's caches); poll for it.
    await expect.poll(() => registrationScopes(page), { timeout: 15_000 }).toEqual([]);
    await expect.poll(() => cacheNames(page), { timeout: 15_000 }).toEqual([]);
    await page.waitForTimeout(3000);
    expect(loads, "the page must not reload or navigate by itself").toBe(1);
    expect(await page.evaluate(() => (window as unknown as { __loads: number }).__loads)).toBe(1);
    expect(await registrationScopes(page)).toEqual([]);
    await ctx.close();
  });

  test("fresh phase: with the switch on a page never registers, and does not reload", async ({ browser }) => {
    test.skip(PHASE !== "fresh", "phase is not fresh");
    const ctx = await browser.newContext({ baseURL: BASE });
    const page = await ctx.newPage();
    let loads = 0;
    page.on("load", () => loads++);
    await page.goto("/about");
    await page.waitForLoadState("load");
    await page.waitForTimeout(4000); // far longer than the load-and-idle delay a registration would wait for
    expect(loads, "load events").toBe(1);
    expect(await registrationScopes(page)).toEqual([]);
    expect(ctx.serviceWorkers()).toHaveLength(0);
    // The route still answers with the self-destruct worker for a browser doing its own background update check.
    const sw = await ctx.request.get("/sw.js");
    const text = await sw.text();
    expect(text).toContain("unregister");
    expect(text).not.toContain("/offline");
    await ctx.close();
  });
});
