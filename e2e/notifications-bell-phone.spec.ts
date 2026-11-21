/**
 * N5: the notification bell on a phone, measured in a real browser at 360, 390 and 430 px. The bell is visible and at least 44px by 44px, nothing in the header runs off the right edge, the page does not scroll
 * sideways, and the open panel spans the viewport: its left edge is at or right of 0 and its right edge at or left of the viewport width (on production the panel was cut off the left edge at 390).
 *
 * ISOLATION. The bell exists only with notifications_master on, and the bell changes the masthead's width, so a flag left on would bend the header specs that run after this one. No other spec flips a shared
 * flag (admin-feature-flags uses its own throwaway flag key), so this one earns its isolation itself:
 *   1. It runs only when Playwright has ONE worker (playwright.config.ts: workers 1, fullyParallel false, and CI shards each run their own database). With more workers it skips itself rather than change a flag
 *      other workers are reading.
 *   2. The flag is on for ONE TEST at a time (an auto fixture), not for the file: it is read first, switched on, and put back to the value it had in the fixture's teardown, which Playwright runs after a failure
 *      or a timeout too. A failing restore fails the test loudly.
 *   3. It restores what it read, never a blind false, so a database that already had the flag on keeps it on.
 *   4. The only gap is a killed worker process (the flag then stays on until the shard's database is thrown away); the next run of this spec reads the flag, finds it on, and leaves it as it found it.
 */
import { test as authed, expect, admin } from "./fixtures/authed";

const FLAG = "notifications_master";

const test = authed.extend<{ bellFlag: void }>({
  bellFlag: [
    async ({}, use, testInfo) => {
      testInfo.skip(testInfo.config.workers > 1, "changes a shared feature flag, so it needs a single Playwright worker");
      const { data, error } = await admin.from("feature_flags").select("enabled").eq("key", FLAG).maybeSingle();
      if (error) throw new Error(`reading ${FLAG}: ${error.message}`);
      if (!data) throw new Error(`${FLAG} has no feature_flags row, so the bell cannot be switched on for this spec`);
      const previous = data.enabled;
      if (!previous) {
        const { error: onError } = await admin.from("feature_flags").update({ enabled: true }).eq("key", FLAG);
        if (onError) throw new Error(`switching ${FLAG} on: ${onError.message}`);
      }
      // Playwright runs everything after `use` as the fixture's teardown, also when the test failed or timed out.
      await use();
      if (!previous) {
        const { error: offError } = await admin.from("feature_flags").update({ enabled: false }).eq("key", FLAG);
        if (offError) throw new Error(`restoring ${FLAG} to off: ${offError.message}`);
      }
    },
    { auto: true },
  ],
});

const WIDTHS = [360, 390, 430] as const;
for (const width of WIDTHS) {
  test(`at ${width}px the bell is visible and 44px, the header fits, and the open panel spans the viewport`, async ({ authedPage: page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/jobs");
    const bell = page.locator("[data-notification-bell] button").first();
    await expect(bell).toBeVisible();
    const box = await bell.boundingBox();
    expect(box, "the bell has no box").not.toBeNull();
    expect(box!.width, `bell width at ${width}`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `bell height at ${width}`).toBeGreaterThanOrEqual(44);
    expect(box!.x, "bell starts left of the viewport").toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, "bell runs off the right edge").toBeLessThanOrEqual(width);

    const header = await page.getByTestId("masthead").evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(header.scrollWidth, `the header clips or scrolls sideways at ${width}`).toBeLessThanOrEqual(header.clientWidth);
    const page_ = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(page_.scrollWidth, `the page scrolls sideways at ${width}`).toBeLessThanOrEqual(page_.innerWidth);

    await bell.click();
    const panel = page.getByRole("dialog", { name: "Notifications" });
    await expect(panel).toBeVisible();
    const p = await panel.boundingBox();
    expect(p, "the panel has no box").not.toBeNull();
    expect(p!.x, `the panel starts left of the viewport at ${width}`).toBeGreaterThanOrEqual(0);
    expect(p!.x + p!.width, `the panel ends right of the viewport at ${width}`).toBeLessThanOrEqual(width);
    expect(p!.width, `the panel is not full width at ${width}`).toBeGreaterThanOrEqual(width - 1);
  });
}

test("from 640px up the panel is still the 360px dropdown under the bell", async ({ authedPage: page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/jobs");
  await page.locator("[data-notification-bell] button").first().click();
  const p = await page.getByRole("dialog", { name: "Notifications" }).boundingBox();
  expect(p!.width).toBeLessThanOrEqual(360);
  expect(p!.x).toBeGreaterThanOrEqual(0);
});
