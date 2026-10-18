import { test, expect } from "@playwright/test";
import { cacheNames, cachedPaths, waitForWorkerControl } from "./support/pwa";

/**
 * The offline page, in a real browser, with the worker ACTIVE and navigation preload ENABLED (Chromium's default; asserted below, because a
 * test that quietly ran with preload off would not be testing the path real phones take).
 *
 * What it proves (build prompt section 2, and v2.1 section E):
 *  - the worker installs, takes control of the page that registered it, and caches /offline and nothing else;
 *  - cut the network, navigate somewhere else: the person sees the offline page, STYLED (computed styles, not just words), with no failed
 *    sub-request, and the URL they asked for is still the document URL;
 *  - the retry link is a plain link: back online, one click returns the real page.
 */
test.describe("offline navigation with the worker active", () => {
  test("a navigation with no network shows the styled offline page; the retry link works once back online", async ({ page, context }) => {
    await page.goto("/about");
    await waitForWorkerControl(page);

    // Navigation preload is on in the worker that is running (the browser default is "off" until the worker enables it on activate).
    const preload = await page.evaluate(async () => (await (await navigator.serviceWorker.getRegistrations())[0].navigationPreload.getState()).enabled);
    expect(preload, "navigationPreload.getState().enabled before going offline").toBe(true);

    // The worker's one cache holds the offline page and nothing else.
    expect(await cacheNames(page)).toEqual(["talentrah-offline-v1"]);
    expect(await cachedPaths(page, "talentrah-offline-v1")).toEqual(["/offline"]);

    const failed: string[] = [];
    const requested: string[] = [];
    page.on("requestfailed", (r) => failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));
    page.on("request", (r) => requested.push(new URL(r.url()).pathname));

    await context.setOffline(true);
    const response = await page.goto("/jobs?from=offline-test");
    expect(response?.status()).toBe(200);
    // The document URL is the page the person asked for, not /offline: that is what makes the retry link re-request it.
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe("/jobs?from=offline-test");

    await expect(page.getByRole("heading", { name: "You are offline." })).toBeVisible();
    await expect(page.getByText("Pages are not saved on this phone")).toBeVisible();

    // STYLED, by computed style: the inline <style> applied (a page that lost its CSS would report the browser defaults).
    const retryLink = page.getByRole("link", { name: "Try again" });
    const retry = await retryLink.evaluate((el) => {
      const r = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return { bg: r.backgroundColor, radius: r.borderTopLeftRadius, height: rect.height, width: rect.width, href: el.getAttribute("href"), resolved: (el as HTMLAnchorElement).href };
    });
    const page_ = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const h1 = getComputedStyle(document.querySelector("h1")!);
      return { bodyBg: body.backgroundColor, bodyColor: body.color, h1Font: h1.fontFamily, h1Size: h1.fontSize };
    });
    const styles = {
      ...page_,
      retryBg: retry.bg,
      retryRadius: retry.radius,
      retryHeight: retry.height,
      retryWidth: retry.width,
      retryHref: retry.href,
      retryResolved: retry.resolved,
    };
    expect(styles.bodyBg).toBe("rgb(249, 248, 245)"); // --paper
    expect(styles.bodyColor).toBe("rgb(16, 28, 40)"); // --ink
    expect(styles.h1Font).toContain("Georgia");
    expect(styles.h1Size).toBe("36px");
    expect(styles.retryBg).toBe("rgb(16, 28, 40)");
    expect(styles.retryRadius).toBe("0px");
    expect(styles.retryHeight).toBeGreaterThanOrEqual(44);
    expect(styles.retryWidth).toBeGreaterThanOrEqual(44);
    expect(styles.retryHref).toBe("");
    expect(styles.retryResolved).toBe(page.url());

    // No failed sub-request, and nothing requested beyond the navigation itself (no stylesheet, script, font, image or favicon fetch).
    expect(failed, "failed sub-requests while offline").toEqual([]);
    expect(requested.filter((p) => p !== "/jobs"), "requests made by the offline page").toEqual([]);

    // Retry while still offline lands back on the offline page: nothing crashes.
    await page.getByRole("link", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "You are offline." })).toBeVisible();

    // Back online, one click on the plain link returns the real page the person wanted.
    await context.setOffline(false);
    await page.getByRole("link", { name: "Try again" }).click();
    await page.waitForURL("**/jobs?from=offline-test");
    await expect(page.getByRole("heading", { name: "You are offline." })).toHaveCount(0);
    await expect(page.locator("main#main-content")).toBeVisible();
  });

  test("the offline page is served for ANY page, not just /jobs", async ({ page, context }) => {
    await page.goto("/about");
    await waitForWorkerControl(page);
    await context.setOffline(true);
    for (const path of ["/", "/employer", "/login", "/blog", "/dashboard"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(page.getByRole("heading", { name: "You are offline." }), path).toBeVisible();
    }
  });

  test("/offline itself is reachable online, noindex, and the same document", async ({ request }) => {
    const res = await request.get("/offline");
    expect(res.status()).toBe(200);
    expect(res.headers()["x-robots-tag"]).toBe("noindex");
    expect(res.headers()["content-type"]).toBe("text/html; charset=utf-8");
    expect(await res.text()).toContain("You are offline.");
  });
});
