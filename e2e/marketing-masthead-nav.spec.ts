import { test, expect } from "@playwright/test";

/**
 * Regression coverage for the signed-out marketing masthead's mobile nav.
 *
 * src/components/marketing/marketing-masthead.tsx hid its nav ("Browse Jobs",
 * "Meet Farah", "How it works", "FAQs") below 900px with `max-[900px]:hidden`
 * and NO replacement — no hamburger, no drawer, nothing. Confirmed both by
 * reading the source (no fallback existed) and empirically at a real 375x812
 * mobile viewport, where only "Log in" and "Get started for free" rendered.
 *
 * CLAUDE.md is explicit that this product's target market skews low-end
 * Android + expensive mobile data — exactly the population hitting a
 * signed-out landing page on a phone, which makes this the highest-traffic
 * surface for the bug, not an edge case.
 *
 * Fix ports the same disclosure pattern already proven in both signed-in
 * mastheads (src/components/app-shell/masthead.tsx,
 * src/components/employer/employer-masthead.tsx): a hamburger trigger with
 * aria-expanded/aria-haspopup="menu", a role="menu" panel, outside-click and
 * Escape to close. The one real difference from those two specs: this nav is
 * ANCHOR-based (in-page sections, `/#jobs` etc — not routes), so "closes and
 * navigates" here means "closes and scrolls to the right in-page section",
 * asserted via the URL hash and scrollY rather than page.waitForURL.
 *
 * Unlike e2e/masthead-nav.spec.ts and masthead-nav-fit.spec.ts, this page is
 * fully signed-out — no DEMO_PASSWORD / seeded user dependency at all.
 */

test.describe("marketing masthead mobile nav", () => {
  test("nav links are reachable via a disclosure below 900px, hidden as a bar above it", async ({
    page,
  }) => {
    // Below the breakpoint: bar hidden, hamburger shown.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    const bar = page.locator("nav").first();
    await expect(bar).toBeHidden();

    const trigger = page.getByRole("button", { name: "Main menu" });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    // "Log in" and "Get started for free" must stay reachable regardless —
    // this bug never broke those, and the fix must not either. Scoped to the
    // masthead specifically: the hero section below has its own "Get started
    // for free" CTA, and an unscoped lookup hits both (strict-mode violation).
    await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Get started for free" }).first(),
    ).toBeVisible();

    // At and above the breakpoint: bar shown, hamburger gone.
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(bar).toBeVisible();
    await expect(trigger).toBeHidden();
    for (const label of ["Browse Jobs", "Meet Farah", "How it works", "FAQs"]) {
      await expect(bar.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("every nav link is reachable from the mobile disclosure", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    const trigger = page.getByRole("button", { name: "Main menu" });
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();

    for (const label of ["Browse Jobs", "Meet Farah", "How it works", "FAQs"]) {
      await expect(
        menu.getByRole("menuitem", { name: label }),
        `${label} is unreachable below the 900px breakpoint`,
      ).toBeVisible();
    }
  });

  test("clicking a disclosure link closes the menu and scrolls to its in-page anchor", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    const trigger = page.getByRole("button", { name: "Main menu" });
    await trigger.click();

    const menu = page.getByRole("menu");
    await menu.getByRole("menuitem", { name: "How it works" }).click();

    // Closes rather than merely navigating to a dead anchor.
    await expect(menu).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    // Actually activates the anchor — hash updates and the page scrolls,
    // not just a click that silently no-ops.
    await expect(page).toHaveURL(/#how-it-works$/);
    await expect(async () => {
      const scrollY = await page.evaluate(() => window.scrollY);
      expect(scrollY).toBeGreaterThan(500);
    }).toPass({ timeout: 5000 });

    // The section actually being scrolled to is on screen.
    await expect(
      page.getByRole("heading", { name: /From job posting to tailored application/i }),
    ).toBeInViewport();
  });

  test("outside click and Escape both close the disclosure", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    const trigger = page.getByRole("button", { name: "Main menu" });
    const menu = page.getByRole("menu");

    await trigger.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    await trigger.click();
    await expect(menu).toBeVisible();
    // Click somewhere on the page outside the menu and its trigger.
    await page.mouse.click(375, 700);
    await expect(menu).toBeHidden();
  });
});
