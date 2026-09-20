import { test, expect, type Page } from "@playwright/test";

/**
 * CookieConsentBanner (src/components/legal/cookie-consent-banner.tsx) —
 * send-406. Rendered in the ROOT layout (site-wide: marketing pages and the
 * signed-in app shell both), resolving visibility from localStorage after
 * mount the same deferred way MarketingStickyCta does — see
 * e2e/marketing-sticky-cta.spec.ts for that precedent's own version of the
 * same "starts hidden, resolves after mount" wait.
 */

async function waitForResolved(page: Page) {
  await page.waitForTimeout(300);
}

const BANNER = '[data-testid="cookie-consent-banner"]';

test.describe("shows once, on first visit, and never reappears after a choice", () => {
  test.beforeEach(async ({ page }) => {
    // A clean slate per test — a previous test's (or a previous real
    // visitor's) stored choice must not leak into this one. Deliberately
    // NOT `addInitScript`: that re-runs on every navigation within the
    // page, including a test's own `page.reload()` later — which would
    // silently wipe the very choice a test just stored right before
    // checking it survived a reload. One explicit navigate-then-clear here
    // instead, so it only ever runs once, before the test's own real work.
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("talentrah-cookie-consent"));
  });

  test("appears on a first visit, before any choice is stored", async ({ page }) => {
    await page.goto("/");
    await waitForResolved(page);
    await expect(page.locator(BANNER)).toBeVisible();
  });

  test("Accept dismisses it immediately, and it never reappears on reload", async ({ page }) => {
    await page.goto("/");
    await waitForResolved(page);
    await expect(page.locator(BANNER)).toBeVisible();

    await page.getByRole("button", { name: "Accept" }).click();
    await expect(page.locator(BANNER)).toBeHidden();

    await page.reload();
    await waitForResolved(page);
    await expect(page.locator(BANNER)).toBeHidden();

    const stored = await page.evaluate(() => localStorage.getItem("talentrah-cookie-consent"));
    expect(stored).toBe("accepted");
  });

  test("Decline dismisses it too, and it never reappears on reload", async ({ page }) => {
    await page.goto("/");
    await waitForResolved(page);

    await page.getByRole("button", { name: "Decline" }).click();
    await expect(page.locator(BANNER)).toBeHidden();

    await page.reload();
    await waitForResolved(page);
    await expect(page.locator(BANNER)).toBeHidden();

    const stored = await page.evaluate(() => localStorage.getItem("talentrah-cookie-consent"));
    expect(stored).toBe("rejected");
  });

  test("is genuinely site-wide: also appears on a plain marketing page, not just the homepage", async ({
    page,
  }) => {
    await page.goto("/about");
    await waitForResolved(page);
    await expect(page.locator(BANNER)).toBeVisible();
  });

  test("Learn more links to the real Data & Cookie Notice page", async ({ page }) => {
    await page.goto("/");
    await waitForResolved(page);
    await expect(page.getByRole("link", { name: "Learn more" })).toHaveAttribute(
      "href",
      "/legal/data-cookie-notice",
    );
  });

  test("does not overlap or block the masthead — pushes it down instead", async ({ page }) => {
    await page.goto("/");
    await waitForResolved(page);

    const bannerBox = await page.locator(BANNER).boundingBox();
    const masthead = page.locator("header").first();
    const mastheadBox = await masthead.boundingBox();
    expect(bannerBox).not.toBeNull();
    expect(mastheadBox).not.toBeNull();
    // The masthead starts at or after the banner's bottom edge — no overlap.
    expect(mastheadBox!.y).toBeGreaterThanOrEqual(bannerBox!.y + bannerBox!.height - 1);

    // Still fully interactive: the masthead's own nav is clickable, not
    // covered by anything. `exact` avoids matching the unrelated
    // "Browse jobs instead →" link further down the homepage.
    await expect(page.getByRole("link", { name: "Browse Jobs", exact: true })).toBeVisible();
  });
});

test.describe("degrades quietly when localStorage is unavailable", () => {
  test("dismissing does not throw, and simply doesn't persist across reload", async ({ page }) => {
    // Simulates Safari private-browsing / blocked-storage behavior: every
    // localStorage call throws, the way real blocked storage does.
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("simulated blocked storage");
        },
      });
    });

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await waitForResolved(page);
    await expect(page.locator(BANNER)).toBeVisible();

    await page.getByRole("button", { name: "Accept" }).click();
    await expect(page.locator(BANNER)).toBeHidden();

    expect(pageErrors, "dismissing threw with localStorage blocked").toEqual([]);

    // No persistence possible — degrades to showing again next visit,
    // rather than the page being broken.
    await page.reload();
    await waitForResolved(page);
    await expect(page.locator(BANNER)).toBeVisible();
  });
});
