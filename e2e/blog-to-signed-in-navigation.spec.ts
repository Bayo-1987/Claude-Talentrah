/**
 * Payload quick win (owner, 7 Oct 2026), the safety half: not prefetching the home route must not break moving from a marketing page to the signed-in app.
 * A signed-in visitor on /blog still gets the dashboard button (HWR-2), and following it lands on the signed-in app, which renders for them. Also: the masthead's home link
 * (now not prefetched) still goes home when clicked.
 */
import { test, expect } from "./fixtures/authed";

test("a signed-in visitor on /blog still reaches the signed-in app, and the home link still works without a prefetch", async ({ authedPage: page }) => {
  await page.goto("/blog");
  await page.getByRole("link", { name: /go to your dashboard/i }).first().click();
  await page.waitForURL(/\/(jobs|employer|onboarding)(\/|$|\?)/, { timeout: 30_000 });
  // One element: the Farah panel and a heading can both be on the page by now, and a locator that matches two is a strict-mode error.
  await expect(page.getByTestId("farah-panel").or(page.getByRole("heading").first()).first()).toBeVisible();

  await page.goto("/blog");
  await page.getByRole("banner").getByRole("link", { name: /talentrah/i }).first().click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 30_000 });
});
