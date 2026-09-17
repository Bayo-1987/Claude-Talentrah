import { test as base, expect, type Page } from "@playwright/test";
import { test as authedTest } from "./fixtures/authed";

/**
 * MarketingStickyCta (src/components/marketing/marketing-sticky-cta.tsx) —
 * the mobile-only "Get started for free" bar pinned to the bottom of the
 * marketing homepage, mirroring FarahMobileTab's own fixed/spacer mechanics
 * (see e2e/fixed-tab-row.spec.ts for that component's equivalent coverage).
 *
 * It resolves visibility via a client-side `getSession()` check rather than
 * a signal the page already has (see the component's own comment for why),
 * so "does it ever appear for a signed-in visitor" is a real regression
 * class worth pinning here, not just "does it render at mobile width".
 */

async function waitForResolved(page: Page) {
  // Starts hidden until the client-side session check resolves — give it a
  // moment rather than asserting against the pre-resolution state.
  await page.waitForTimeout(500);
}

base.describe("signed out, at mobile width", () => {
  base.use({ viewport: { width: 390, height: 844 } });

  base("the sticky CTA is visible and links to /signup", async ({ page }) => {
    await page.goto("/");
    await waitForResolved(page);

    const bar = page.locator('[data-testid="marketing-sticky-cta"]');
    await expect(bar).toBeVisible();

    const link = bar.getByRole("link", { name: "Get started for free" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/signup");

    const position = await bar.evaluate((el) => getComputedStyle(el).position);
    expect(position).toBe("fixed");
  });

  base("the spacer reserves exactly the bar's height, so nothing jumps", async ({ page }) => {
    await page.goto("/");
    await waitForResolved(page);

    const bar = await page
      .locator('[data-testid="marketing-sticky-cta"]')
      .evaluate((el) => el.getBoundingClientRect());
    const spacer = await page
      .locator('[data-testid="marketing-sticky-cta-spacer"]')
      .evaluate((el) => el.getBoundingClientRect());

    // Sub-pixel rounding between the two independently-measured boxes can
    // land exactly on toBeCloseTo's precision-0 boundary (0.5px) — assert
    // the tolerance directly rather than fight Jest's rounding rule.
    expect(Math.abs(spacer.height - bar.height)).toBeLessThanOrEqual(1);
  });
});

base.describe("signed out, at desktop width", () => {
  base.use({ viewport: { width: 1280, height: 900 } });

  base("the sticky CTA does not render", async ({ page }) => {
    await page.goto("/");
    await waitForResolved(page);
    await expect(page.locator('[data-testid="marketing-sticky-cta"]')).toBeHidden();
  });
});

authedTest.describe("signed in, at mobile width", () => {
  authedTest.use({ viewport: { width: 390, height: 844 } });

  authedTest("the sticky CTA never appears", async ({ authedPage }) => {
    await authedPage.goto("/");
    await waitForResolved(authedPage);
    await expect(authedPage.locator('[data-testid="marketing-sticky-cta"]')).toBeHidden();
  });
});
