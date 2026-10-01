import { test, expect } from "@playwright/test";
import { installPrintStub } from "./support/print-stub";

/**
 * The seeker's "Save as PDF" button — wording, and the PDF's filename — on the
 * QA-only editor fixture (/dev/resume-editor-fixture: no database, no sign-in).
 *
 * The saved file is named from `document.title` at the moment the print dialog
 * opens, so the print must run under `<First>-<Last>-Resume` and the page's own
 * title must come back afterwards. e2e/print-button-fonts.spec.ts asserts the
 * same title on the real authenticated editor; this one needs no Supabase, so it
 * also runs wherever the app does. `window.print` is the shared stub, which
 * fires `afterprint` the way a browser does once the dialog closes.
 */
test("Save as PDF prints under <First>-<Last>-Resume and restores the page title", async ({ page }) => {
  await installPrintStub(page, async () => {});
  await page.goto("/dev/resume-editor-fixture");
  await page.waitForLoadState("networkidle");

  const originalTitle = await page.title();
  expect(originalTitle, "the fixture page needs a title of its own to restore").not.toBe("");

  const button = page.getByRole("button", { name: "Save as PDF" });
  await expect(button).toBeEnabled();
  await expect(page.getByText("In the print window, choose 'Save as PDF'.")).toBeVisible();
  // The old label must be gone, not merely joined by the new one.
  await expect(page.getByRole("button", { name: "Download PDF" })).toHaveCount(0);

  await button.click();
  await page.waitForFunction(() => window.__printCalls.length > 0, undefined, { timeout: 15_000 });
  await page.waitForFunction(() => window.__titlesAfterPrint.length > 0, undefined, { timeout: 15_000 });

  const calls = await page.evaluate(() => window.__printCalls);
  expect(calls, "window.print() should be called exactly once per click").toHaveLength(1);
  expect(calls[0].title).toBe("Ada-Obi-Resume");
  expect(await page.evaluate(() => window.__titlesAfterPrint[0])).toBe(originalTitle);
  expect(await page.title()).toBe(originalTitle);
});
