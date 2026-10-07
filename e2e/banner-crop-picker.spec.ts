import { test, expect, type Page } from "@playwright/test";
import { makeRealPng } from "./support/real-png";

/**
 * send-511 (issue #591) — the banner crop picker opens its crop dialog for a file chosen at ANY point,
 * including before the page has hydrated. See the issue and the PR for the measurements.
 */
const BANNER_PNG = makeRealPng(1600, 400);

async function pick(page: Page) {
  await page.locator('input#banner[type="file"]').setInputFiles({ name: "banner.png", mimeType: "image/png", buffer: BANNER_PNG });
}

test("the crop dialog opens after a normal pick, and the crop can be confirmed", async ({ page }) => {
  await page.goto("/dev/banner-crop-fixture");
  await pick(page);
  await expect(page.getByRole("dialog", { name: "Crop your banner" })).toBeVisible();
  await page.getByRole("button", { name: "Use this crop" }).click();
  await expect(page.getByText("Cropped and ready")).toBeVisible();
});

test("a file chosen BEFORE hydration still opens the crop dialog (the change event is not lost)", async ({ page }) => {
  // Hold every script chunk back (a gate each request waits on) so the page stays server-rendered markup that
  // nothing is listening to yet.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  // Script chunks only, not the stylesheet: the page paints nothing until its CSS arrives, and an inline script placed ahead of the page content (the cookie banner's pre-paint
  // script, layout.tsx) waits for a pending stylesheet, so holding the CSS too keeps the parser from ever reaching the input. Slow JavaScript with CSS delivered is the case this guards.
  await page.route(/\/_next\/static\/chunks\/.*\.js(\?.*)?$/, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/dev/banner-crop-fixture", { waitUntil: "commit" });
  await expect(page.locator('input#banner[type="file"]')).toBeAttached();

  await pick(page);

  // Only now let the page hydrate.
  release();

  // Wait for hydration PROPERLY (React stamps its props key on every node it has hydrated), so a failure below
  // can only mean "hydrated, and the file chosen earlier was ignored", not "hydration never finished".
  await expect
    .poll(() => page.evaluate(() => Object.keys(document.querySelector("#banner")!).some((k) => k.startsWith("__reactProps"))), {
      message: "the page never hydrated",
      timeout: 15_000,
    })
    .toBe(true);
  // The chosen file is still in the input; the picker has to act on it.
  expect(await page.locator("#banner").evaluate((el) => (el as HTMLInputElement).files?.length)).toBe(1);

  await expect(page.getByRole("dialog", { name: "Crop your banner" })).toBeVisible({ timeout: 10_000 });
});
