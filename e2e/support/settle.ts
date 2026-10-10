import type { Page } from "@playwright/test";

/**
 * "The page has finished reacting to what it was just told", without a fixed sleep: no request is in flight, then two animation frames have passed (React applies a Server Action's result, including
 * resetting a form, in the commit that follows the response; two frames is the earliest point at which that commit has been painted).
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/**
 * Resolves when React resets this form (it dispatches a DOM "reset" event on the form after a Server Action finishes, whatever the action returned). Call it BEFORE submitting, await it AFTER the action has
 * answered: typing into the form before this has happened gets the typed text wiped. Gives up after `timeoutMs` (a remounted form never fires) and carries on, so a missed event costs time, not a failure.
 */
export function formReset(form: import("@playwright/test").Locator, timeoutMs = 10_000): Promise<void> {
  return form
    .evaluate((el, ms) => new Promise<void>((resolve) => { const done = () => resolve(); el.addEventListener("reset", done, { once: true }); setTimeout(done, ms as number); }), timeoutMs)
    .then(() => undefined);
}
