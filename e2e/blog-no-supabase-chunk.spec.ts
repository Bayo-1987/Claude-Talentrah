/**
 * Payload quick win (owner, 7 Oct 2026): a signed-out visitor on /blog downloads no Supabase auth client.
 *
 * The client was not on /blog because the blog needs it. It arrived because the router PREFETCHED the home route (the masthead logo link) and the home route's chunks include
 * it (One Tap, the sticky CTA and the demo input call getSession): on production 88 KB of a 476 KB page. The links to `/` now say prefetch={false}.
 *
 * Two assertions, both by what the browser really does, not by file names (chunk names change every build):
 *  1. no router prefetch request for the home route is issued from /blog or from a blog post;
 *  2. no JS response loaded by the page contains the auth client (its `GoTrueClient` class), with /login as the positive control: the same check must FIND it there,
 *     because One Tap mounts on /login, so a pass on /blog is not a check that cannot fail.
 * Database-free (a signed-out visit to public pages); needs only a built app: `npm run build && npm start`.
 */
import { test, expect, type Page } from "@playwright/test";

const AUTH_CLIENT_SIGNATURE = "GoTrueClient";

async function visit(page: Page, path: string) {
  const prefetchedPaths: string[] = [];
  const jsBodies: Array<{ url: string; hasAuthClient: boolean }> = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.search.includes("_rsc=")) prefetchedPaths.push(u.pathname);
  });
  const pending: Array<Promise<void>> = [];
  page.on("response", (res) => {
    if (res.request().resourceType() !== "script" || !res.url().endsWith(".js")) return;
    pending.push(
      res
        .text()
        .then((body) => void jsBodies.push({ url: res.url().split("/").pop() ?? res.url(), hasAuthClient: body.includes(AUTH_CLIENT_SIGNATURE) }))
        .catch(() => {}),
    );
  });
  await page.goto(path, { waitUntil: "load" });
  // Router prefetches and the chunks they trigger start after hydration: a fixed settle, because "nothing more loads" has no event to wait for.
  await page.waitForTimeout(4000);
  await Promise.all(pending);
  return { prefetchedPaths, jsBodies };
}

test.describe("the blog does not pull in the Supabase auth client", () => {
  test("/blog issues no router prefetch for the home route and loads no auth-client chunk", async ({ page }) => {
    const { prefetchedPaths, jsBodies } = await visit(page, "/blog");
    expect(prefetchedPaths, "the router prefetched the home route from /blog").not.toContain("/");
    expect(jsBodies.length, "the page loaded scripts (the check looked at something)").toBeGreaterThan(3);
    expect(jsBodies.filter((b) => b.hasAuthClient).map((b) => b.url), "chunks containing the auth client on /blog").toEqual([]);
  });

  test("a blog post is the same", async ({ page }) => {
    await page.goto("/blog");
    const links = page.locator('a[href^="/blog/"]');
    test.skip((await links.count()) === 0, "no blog post is listed in this environment");
    const first = await links.first().getAttribute("href");
    const { prefetchedPaths, jsBodies } = await visit(page, first!);
    expect(prefetchedPaths).not.toContain("/");
    expect(jsBodies.filter((b) => b.hasAuthClient).map((b) => b.url)).toEqual([]);
  });

  test("control: /login DOES load the auth client (One Tap mounts there), so the check can fail", async ({ page }) => {
    const { jsBodies } = await visit(page, "/login");
    expect(jsBodies.filter((b) => b.hasAuthClient).length, "the auth client chunk on /login").toBeGreaterThanOrEqual(1);
  });
});
