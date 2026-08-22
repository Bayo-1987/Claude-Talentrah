import { test, expect } from "@playwright/test";

/**
 * Regression test for QA audit bug #6 (Tier 5): the masthead nav linked to
 * Job Tracker and Refer a Friend before those routes existed (M7/M9),
 * sending users to a generic, unbranded 404. Fix was to drop them from
 * NAV_LINKS in src/components/app-shell/masthead.tsx until those milestones
 * land, rather than building "coming soon" states.
 *
 * Requires the demo user seeded by `npm run seed` (scripts/seed.ts).
 */
test("masthead nav omits unbuilt Job Tracker / Refer a Friend links", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password").fill("TalentrahDemo123!");
  await page.getByRole("button", { name: "Log in" }).click();

  await page.waitForURL("**/jobs");

  const nav = page.locator("nav");
  await expect(nav.getByRole("link", { name: "Jobs" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Resume Builder" })).toBeVisible();

  await expect(nav.getByRole("link", { name: "Job Tracker" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Refer a Friend" })).toHaveCount(0);
  await expect(page.locator('a[href="/job-tracker"]')).toHaveCount(0);
  await expect(page.locator('a[href="/refer-a-friend"]')).toHaveCount(0);
});
