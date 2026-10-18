import { test, expect, admin } from "./fixtures/authed";
import { PENDING_DELETION_PATH } from "../src/lib/auth/pending-deletion-path";

/**
 * The three installable-app paths, a signed-in person and the proxy (design note tests 6, 9, 10 and 11).
 *
 * /manifest.webmanifest, /sw.js and /offline skip the proxy (src/proxy.ts matcher), so none of them runs `updateSession`, writes a cookie, or is
 * redirected by the pending-deletion gate. Requests are made WITH a real session cookie and with redirects off, so a 307 or a Set-Cookie is seen
 * instead of followed.
 */

const PATHS = ["/manifest.webmanifest", "/sw.js", "/offline"];

test.describe("served as themselves", () => {
  test("the manifest answers 200 with no redirect and the right type; the worker and offline page too", async ({ request }) => {
    const manifest = await request.get("/manifest.webmanifest", { maxRedirects: 0 });
    expect(manifest.status()).toBe(200);
    expect(manifest.headers()["content-type"]).toMatch(/^application\/manifest\+json/);
    const body = await manifest.json();
    expect(body.start_url).toBe("/dashboard");
    expect(body.display).toBe("standalone");

    const sw = await request.get("/sw.js", { maxRedirects: 0 });
    expect(sw.status()).toBe(200);
    expect(sw.headers()["content-type"]).toBe("application/javascript; charset=utf-8");
    expect(sw.headers()["cache-control"]).toBe("no-cache, no-store, must-revalidate");
    expect(sw.headers()["content-security-policy"]).toBe("default-src 'self'; script-src 'self'");

    const offline = await request.get("/offline", { maxRedirects: 0 });
    expect(offline.status()).toBe(200);
    expect(offline.headers()["x-robots-tag"]).toBe("noindex");
  });

  test("/offline/ (trailing slash) is ONE redirect to /offline, issued by Next's own redirect step before the proxy", async ({ request }) => {
    const res = await request.get("/offline/", { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(res.headers()["location"]).toBe("/offline");
  });
});

test.describe("a signed-in person", () => {
  test("gets no Set-Cookie from any of the allow-listed URLs", async ({ authedPage: page }) => {
    // A real hashed chunk and an icon, found from a real page, beside the three paths.
    await page.goto("/jobs");
    const html = await page.content();
    const chunk = html.match(/\/_next\/static\/[^"')\s]+\.js/)?.[0];
    expect(chunk, "a /_next/static chunk on the page").toBeTruthy();
    for (const path of [...PATHS, chunk!, "/icons/talentrah-mark-192.png", "/icons/talentrah-mark-maskable-512.png"]) {
      const res = await page.request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(200);
      expect(res.headers()["set-cookie"], `${path} must not set a cookie`).toBeUndefined();
    }
  });

  test("whose account is scheduled for deletion still gets 200 for the manifest, the worker and the offline page (no redirect)", async ({ authedPage: page, testUser }) => {
    const { error } = await admin.auth.admin.updateUserById(testUser.id, { app_metadata: { deletion_pending: true } });
    if (error) throw error;

    // The flag is live: an ordinary page is turned away to the pending-deletion prompt.
    const gated = await page.request.get("/jobs", { maxRedirects: 0 });
    expect(gated.status()).toBe(307);
    expect(gated.headers()["location"]).toContain(PENDING_DELETION_PATH);

    for (const path of PATHS) {
      const res = await page.request.get(path, { maxRedirects: 0 });
      expect(res.status(), `${path} for a person inside the deletion window`).toBe(200);
      expect(res.headers()["location"]).toBeUndefined();
    }
  });
});

test.describe("installability", () => {
  test("Chromium reports no installability error on the production build (Page.getInstallabilityErrors)", async ({ page, context }) => {
    // Lighthouse 12.6.1, the one inside @lhci/cli@0.15.1, has no installability audit (its PWA category was removed in 12), so this asks Chromium directly.
    const cdp = await context.newCDPSession(page);
    await cdp.send("Page.enable");
    await page.goto("/");
    const { url, errors } = (await cdp.send("Page.getAppManifest")) as { url: string; errors: { message: string }[] };
    expect(url).toMatch(/\/manifest\.webmanifest$/);
    expect(errors, "manifest parse errors").toEqual([]);
    const { installabilityErrors } = (await cdp.send("Page.getInstallabilityErrors")) as { installabilityErrors: { errorId: string }[] };
    expect(installabilityErrors, "installability errors").toEqual([]);
  });
});
