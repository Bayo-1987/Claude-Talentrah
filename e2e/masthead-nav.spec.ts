import { test, expect } from "@playwright/test";

/**
 * Regression test for QA audit bug #6 (Tier 5): the masthead nav linked to
 * Job Tracker and Refer a Friend before those routes existed (M7/M8),
 * sending users to a generic, unbranded 404. Fix was to drop them from
 * NAV_LINKS in src/components/app-shell/masthead.tsx until those milestones
 * land, rather than building "coming soon" states.
 *
 * Updated twice during branch reconciliation as the two milestones this
 * test was gating actually shipped: first when M7 (Job Tracker) merged
 * (the "both omitted" assertion went stale, not a regression), again now
 * that M8 (Refer a Friend) has too — same pattern, caught proactively
 * this time before it hit CI. With both milestones merged there's nothing
 * left to assert is *omitted*; this now just confirms all four expected
 * nav links render.
 *
 * Requires the demo user seeded by `npm run seed` (scripts/seed.ts).
 */
test("masthead nav shows all four links once Job Tracker (M7) and Refer a Friend (M8) have shipped", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password").fill("TalentrahDemo123!");
  await page.getByRole("button", { name: "Log in" }).click();

  await page.waitForURL("**/jobs");

  const nav = page.locator("nav");
  await expect(nav.getByRole("link", { name: "Jobs" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Job Tracker" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Resume Builder" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Refer a Friend" })).toBeVisible();
});
