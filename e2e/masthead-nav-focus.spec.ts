import { test as base, expect } from "@playwright/test";
import { test as authedTest } from "./fixtures/authed";

/**
 * Keyboard focus management for the mobile nav disclosures — the seeker
 * masthead's "Main menu" and "Account menu", and the employer masthead's
 * "Main menu". All three had correct `aria-expanded`/`aria-haspopup="menu"`,
 * `role="menu"`/`role="menuitem"`, real `<Link>` navigation, and outside-click
 * plus Escape closing already. What none of them did: move focus INTO the
 * panel when it opened, or back to the trigger when it closed by Escape or an
 * outside click. A keyboard-only or screen-reader user could reach and use
 * every one of these menus, just not smoothly — an extra Tab to get in, and
 * focus falling back to <body> (rather than somewhere sensible) on the way
 * out.
 *
 * This does not touch the account/nav menus' visual behaviour, outside-click
 * handling, or the link-click-closes-without-forcing-focus path — a link
 * click still just closes the menu and lets the browser/Next.js's own
 * navigation move focus, unchallenged, matching masthead.tsx's and
 * employer-masthead.tsx's own comments on the fix.
 *
 * DEMO_PASSWORD / viewport conventions copied from e2e/masthead-nav.spec.ts
 * and e2e/masthead-nav-fit.spec.ts; the employer half uses the same
 * fresh-throwaway-user fixture as e2e/employer.spec.ts rather than the demo
 * account, since posting a job isn't needed here — just an organisation to
 * clear onboarding.
 */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

base.describe("seeker masthead mobile disclosures manage keyboard focus", () => {
  base.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");

  base.beforeEach(async ({ page }) => {
    // Below the 2xl (1536px) breakpoint where masthead.tsx puts the nav
    // behind the disclosure — see masthead-nav-fit.spec.ts's own note on why
    // it moved there.
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto("/login");
    await page.getByLabel("Email").fill("demo@talentrah.dev");
    await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD!);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/jobs");
  });

  base("Main menu: Enter opens it with focus inside, Escape closes it and returns focus to the trigger", async ({
    page,
  }) => {
    const trigger = page.getByRole("button", { name: "Main menu" });
    const menu = page.getByRole("menu").first();

    // Reach the trigger by keyboard alone, the way a keyboard user actually
    // would, rather than Locator.focus() short-circuiting real Tab traversal.
    await trigger.focus();
    await expect(trigger).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();

    // The fix: focus moved INTO the panel without an extra Tab.
    const firstItem = menu.getByRole("menuitem").first();
    await expect(firstItem).toBeFocused();

    // Tabbing from there moves within the now-open panel, not back out to
    // whatever the DOM order would otherwise dictate.
    await page.keyboard.press("Tab");
    const focusedRole = await page.evaluate(
      () => document.activeElement?.getAttribute("role"),
    );
    expect(focusedRole).toBe("menuitem");

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    // The fix: focus returned to the trigger rather than falling back to
    // <body> once the focused menuitem unmounted.
    await expect(trigger).toBeFocused();
  });

  base("Account menu: Space opens it with focus inside, an outside click closes it and returns focus to the trigger", async ({
    page,
  }) => {
    const trigger = page.getByRole("button", { name: "Account menu" });
    const menu = page.getByRole("menu").last();

    await trigger.focus();
    await page.keyboard.press(" ");
    await expect(menu).toBeVisible();

    const firstItem = menu.getByRole("menuitem").first();
    await expect(firstItem).toBeFocused();

    // Outside click — the mouse-user dismissal path, asserted to return
    // focus too: nothing else in the DOM was going to receive it once the
    // focused menuitem was removed. Clicks the "EN" chip deliberately: a
    // plain, non-focusable <span> outside the account menu, so the browser's
    // own default click-to-focus behaviour on the target can't race this
    // fix's forced refocus the way clicking a real link (e.g. the brand logo)
    // would.
    await page.getByText("EN", { exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  base("Main menu: a menuitem click that navigates away does not fight the page's own focus handling", async ({
    page,
  }) => {
    const trigger = page.getByRole("button", { name: "Main menu" });
    const menu = page.getByRole("menu").first();

    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();

    // A real navigation, not Escape/outside-click — this must not be forced
    // back onto the (now-gone) trigger button.
    await menu.getByRole("menuitem", { name: "Job Tracker" }).click();
    await page.waitForURL("**/tracker");
    await expect(trigger).not.toBeFocused();
  });
});

authedTest.describe("employer masthead mobile disclosure manages keyboard focus", () => {
  authedTest(
    "Main menu: Enter opens it with focus inside, Escape closes it and returns focus to the trigger",
    async ({ authedPage, testUser }) => {
      // Same onboarding step as e2e/employer.spec.ts's own nav-collapse test
      // — a fresh throwaway user has no organisation yet, and the masthead
      // this test cares about only renders past /employer/onboarding.
      const orgName = `E2E Employer Co ${testUser.id.slice(0, 8)}`;
      await authedPage.goto("/employer");
      await authedPage.getByLabel("Company name").fill(orgName);
      await authedPage
        .getByLabel("Company website domain")
        .fill("e2e-employer.example");
      await authedPage.getByRole("button", { name: "Create company" }).click();
      await expect(authedPage).toHaveURL(/\/employer\/jobs$/);

      // Below the 640px breakpoint employer-masthead.tsx collapses at — see
      // that file's own comment on why it's 640 rather than the seeker
      // masthead's 760/1536.
      await authedPage.setViewportSize({ width: 390, height: 844 });

      const trigger = authedPage.getByRole("button", { name: "Main menu" });
      const menu = authedPage.getByTestId("employer-nav-menu");

      await trigger.focus();
      await authedPage.keyboard.press("Enter");
      await expect(menu).toBeVisible();

      const firstItem = menu.getByRole("menuitem").first();
      await expect(firstItem).toBeFocused();

      await authedPage.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();
    },
  );
});
