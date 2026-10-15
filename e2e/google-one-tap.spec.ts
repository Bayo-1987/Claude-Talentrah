/**
 * Google One Tap in a real browser (PERF-ONE-TAP-DYNAMIC-1) — the e2e file tests/ui/google-one-tap.test.tsx has always pointed at.
 *
 * The component renders NOTHING of its own (Google injects its popup into document.body), so "mounted" is evidenced by what it does: it appends
 * Google's script element and then calls google.accounts.id.initialize and .prompt. Google's own popup is third-party and cannot be asserted in CI, and this
 * spec never talks to Google or needs a Google account: https://accounts.google.com/gsi/client is answered by a route handler with a stub that defines
 * window.google.accounts.id.{initialize,prompt,cancel} as recording functions.
 *
 * What it pins:
 *  1. The Supabase auth client (its `GoTrueClient` class) is in NO script the page's initial HTML references, on /login and on /: One Tap loads it by dynamic import.
 *  2. With a client id, the client chunk is fetched AFTER that (a dynamic import), and One Tap then initialises and prompts exactly once.
 *  3. With Google's script blocked, the page renders and the form works, with no page error.
 *  4. Without a client id the feature is fully off: no Google request, no auth client on /login.
 *
 * ENV: tests 2 and 3 need the app BUILT with NEXT_PUBLIC_GOOGLE_CLIENT_ID set (it is inlined at build time) and the same variable in the environment of the
 * `playwright test` process, so the spec knows which build it is looking at; any dummy value such as `e2e-stub.apps.googleusercontent.com` will do.
 * CI builds without one, so there tests 2 and 3 skip (named, with the reason) and test 4 runs instead.
 */
import { test, expect, type Page } from "@playwright/test";

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const GSI = "https://accounts.google.com/gsi/client";
const AUTH_CLIENT_SIGNATURE = "GoTrueClient";

const STUB = `
window.__gsi = { initialize: [], prompt: 0, cancel: 0, initializeAt: null, promptAt: null };
window.google = { accounts: { id: {
  initialize: function (c) { window.__gsi.initialize.push({ client_id: c.client_id, hasNonce: typeof c.nonce === "string" && c.nonce.length > 0 }); window.__gsi.initializeAt = performance.now(); },
  prompt: function () { window.__gsi.prompt += 1; window.__gsi.promptAt = performance.now(); },
  cancel: function () { window.__gsi.cancel += 1; },
} } };
`;

type Gsi = { initialize: Array<{ client_id: string; hasNonce: boolean }>; prompt: number; cancel: number; initializeAt: number | null; promptAt: number | null };
const readGsi = (page: Page) => page.evaluate(() => (window as unknown as { __gsi?: Gsi }).__gsi);

/** Scripts the browser really fetched, with whether each carries the auth client. */
function watchScripts(page: Page) {
  const seen: Array<{ path: string; hasAuthClient: boolean; at: number }> = [];
  const pending: Array<Promise<void>> = [];
  const t0 = Date.now();
  page.on("response", (res) => {
    if (res.request().resourceType() !== "script" || !new URL(res.url()).pathname.endsWith(".js")) return;
    const at = Date.now() - t0;
    pending.push(
      res
        .text()
        .then((body) => void seen.push({ path: new URL(res.url()).pathname, hasAuthClient: body.includes(AUTH_CLIENT_SIGNATURE), at }))
        .catch(() => {}),
    );
  });
  return { seen, settled: () => Promise.all(pending) };
}

for (const path of ["/login", "/"]) {
  test.describe(`One Tap on ${path}`, () => {
    test("the auth client is in none of the scripts the initial HTML references", async ({ page, baseURL }) => {
      await page.goto("about:blank");
      const res = await page.request.get(`${baseURL}${path}`);
      const html = await res.text();
      const refs = new Set<string>();
      for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) refs.add(m[1]);
      for (const m of html.matchAll(/<link[^>]*href="([^"]+\.js[^"]*)"/g)) refs.add(m[1]);
      expect(refs.size, "the page references scripts (the check looked at something)").toBeGreaterThan(3);
      const withClient: string[] = [];
      for (const ref of refs) {
        const body = await (await page.request.get(new URL(ref.replace(/&amp;/g, "&"), baseURL).toString())).text();
        if (body.includes(AUTH_CLIENT_SIGNATURE)) withClient.push(ref);
      }
      expect(withClient, `scripts referenced by the initial HTML of ${path} that contain the auth client`).toEqual([]);
    });

    test("with a client id: the client chunk arrives after that, then One Tap initialises and prompts exactly once", async ({ page, baseURL }) => {
      test.skip(!CLIENT_ID, "NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set, so the app under test was built with One Tap switched off");
      await page.route(GSI, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: STUB }));
      const scripts = watchScripts(page);

      // What the initial HTML references, fetched separately, so "after" is not a matter of timing.
      const initial = new Set<string>();
      const html = await (await page.request.get(`${baseURL}${path}`)).text();
      for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) initial.add(new URL(m[1].replace(/&amp;/g, "&"), baseURL).pathname);
      for (const m of html.matchAll(/<link[^>]*href="([^"]+\.js[^"]*)"/g)) initial.add(new URL(m[1].replace(/&amp;/g, "&"), baseURL).pathname);

      await page.goto(path);
      await expect.poll(async () => (await readGsi(page))?.prompt, { timeout: 15_000 }).toBe(1);
      await page.waitForTimeout(1000); // a double mount or a second effect would show itself here
      const gsi = (await readGsi(page))!;
      expect(gsi.initialize, "initialize called exactly once").toHaveLength(1);
      expect(gsi.initialize[0]).toEqual({ client_id: CLIENT_ID, hasNonce: true });
      expect(gsi.prompt, "prompt called exactly once").toBe(1);
      expect(gsi.promptAt! >= gsi.initializeAt!, "prompt comes after initialize").toBe(true);

      // The component's own evidence of being mounted: it appended Google's script.
      await expect(page.locator("script#google-identity-services")).toHaveAttribute("src", GSI);

      await scripts.settled();
      const withClient = scripts.seen.filter((s) => s.hasAuthClient);
      expect(withClient.length, "the auth client chunk was fetched").toBeGreaterThanOrEqual(1);
      expect(withClient.filter((s) => initial.has(s.path)).map((s) => s.path), "…and it was not one of the scripts the initial HTML referenced").toEqual([]);

      test.info().annotations.push({ type: "timing", description: `${path}: initialize ${Math.round(gsi.initializeAt!)}ms, prompt ${Math.round(gsi.promptAt!)}ms after navigation start (stubbed Google script, localhost)` });
    });

    test("with Google's script blocked the page still renders and works, with no page error", async ({ page }) => {
      test.skip(!CLIENT_ID, "NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set, so the app under test was built with One Tap switched off");
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      let asked = 0;
      await page.route(GSI, (route) => {
        asked++;
        return route.abort();
      });
      await page.goto(path);
      await expect.poll(() => asked, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
      await page.waitForTimeout(500);
      if (path === "/login") {
        await page.getByLabel("Email").fill("nobody-e2e@talentrah.dev");
        await expect(page.getByLabel("Email")).toHaveValue("nobody-e2e@talentrah.dev");
      } else {
        await expect(page.getByRole("heading").first()).toBeVisible();
      }
      expect(errors, errors.join("\n")).toEqual([]);
    });
  });
}

test("without a client id the feature is fully off: no Google request and, on /login, no auth client", async ({ page }) => {
  test.skip(!!CLIENT_ID, "a client id is set, so the app under test was built with One Tap switched ON (the tests above cover that build)");
  let googleRequests = 0;
  await page.route(GSI, (route) => {
    googleRequests++;
    return route.abort();
  });
  const scripts = watchScripts(page);
  await page.goto("/login");
  await page.waitForTimeout(3000);
  await scripts.settled();
  expect(googleRequests, "requests for Google's script").toBe(0);
  expect(scripts.seen.filter((s) => s.hasAuthClient).map((s) => s.path), "auth client chunks fetched on /login").toEqual([]);
});
