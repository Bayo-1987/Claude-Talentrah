import { test, expect } from "@playwright/test";

/**
 * Regression test for QA audit bug #6 (Tier 5): the masthead nav linked to
 * Job Tracker and Refer a Friend before those routes existed (M7/M8),
 * sending users to a generic, unbranded 404. Fix was to drop them from
 * NAV_LINKS in src/components/app-shell/masthead.tsx until those milestones
 * land, rather than building "coming soon" states.
 *
 * Updated once M7 (Job Tracker) actually shipped — see the branch-
 * reconciliation task that caught this: the nav now correctly shows Job
 * Tracker, and this test's old "both omitted" assertion was stale, not a
 * real regression. Refer a Friend (M8) still isn't merged as of this PR,
 * so that half of the original assertion still holds.
 *
 * Requires the demo user seeded by `npm run seed` (scripts/seed.ts).
 */
test("masthead nav shows Job Tracker (M7) but still omits unbuilt Refer a Friend (M8)", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password").fill("TalentrahDemo123!");
  await page.getByRole("button", { name: "Log in" }).click();

  await page.waitForURL("**/jobs");

  const nav = page.locator("nav");
  await expect(nav.getByRole("link", { name: "Jobs" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Resume Builder" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Job Tracker" })).toBeVisible();

  await expect(nav.getByRole("link", { name: "Refer a Friend" })).toHaveCount(0);
  await expect(page.locator('a[href="/refer"]')).toHaveCount(0);
});
