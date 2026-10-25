import { expect, type Page } from "@playwright/test";

/**
 * Below 760px the Farah panel is a bottom sheet that is invisible until the launcher opens it, so a spec that works inside the panel on a phone opens it first. From 760px the panel is the
 * docked column and this does nothing. Waits for the sheet to finish sliding in, so what follows measures a settled panel.
 */
export async function openFarahPanelIfSheet(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 1280;
  if (width >= 760) return;
  const sheet = page.getByTestId("farah-sheet");
  if ((await sheet.getAttribute("data-sheet")) === "open") return;
  // The launcher is server-rendered and clickable before React attaches its handler: retry until the sheet is really open.
  await expect(async () => {
    await page.getByTestId("farah-launcher").click({ timeout: 2_000 });
    await expect(sheet).toHaveAttribute("data-sheet", "open", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByTestId("farah-panel")).toBeVisible();
  await page.waitForTimeout(300); // the slide-in
}
