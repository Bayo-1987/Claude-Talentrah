/**
 * Helpers for the "an error keeps what was typed" form specs (QA, 8 Oct). A fixed sleep after the error message is flaky in CI and proves little: React 19 resets an
 * uncontrolled form when its action COMPLETES, which can be after the message paints. So:
 *  - submitAndSettle waits for the form's own server response (the Next.js server-action POST, recognised by its `next-action` header) to finish;
 *  - expectStaysFor then re-reads the fields repeatedly over a window and FAILS AT THE FIRST SAMPLE where any field differs, so a wipe at any point in the window is caught
 *    and a pass means the values were there throughout, not just at one lucky instant.
 */
import { expect, type Page } from "@playwright/test";

export async function submitAndSettle(page: Page, submit: () => Promise<void>, timeoutMs = 30_000): Promise<void> {
  const done = page.waitForResponse((r) => r.request().method() === "POST" && r.request().headers()["next-action"] !== undefined, { timeout: timeoutMs });
  await submit();
  await done;
}

export async function expectStaysFor(read: () => Promise<unknown>, expected: unknown, message: string, windowMs = 3000, everyMs = 100): Promise<void> {
  const end = Date.now() + windowMs;
  do {
    expect(await read(), message).toEqual(expected);
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  } while (Date.now() < end);
}
