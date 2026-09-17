import { test, expect } from "@playwright/test";

/**
 * src/app/not-found.tsx — before this file existed, a nonexistent URL served
 * Next's bare default 404 (no branding, no masthead, no way back into the
 * product). This pins the real regression class: someone deletes the file
 * later and the site silently reverts to that default.
 */
test("a nonexistent route renders the branded 404, not Next's default", async ({ page }) => {
  const response = await page.goto("/this-route-does-not-exist-e2e");
  expect(response?.status()).toBe(404);

  // Next's own default 404 page's copy — must NOT be what renders.
  await expect(page.getByText("This page could not be found")).toHaveCount(0);

  await expect(page.locator("nav")).toBeVisible();
  await expect(page.getByRole("heading", { name: "This page doesn't exist." })).toBeVisible();

  const homeLink = page.getByRole("link", { name: "Go home" });
  await expect(homeLink).toBeVisible();
  await homeLink.click();
  await page.waitForURL((url) => url.pathname === "/");
});
