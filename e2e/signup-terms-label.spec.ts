import { test, expect, type Locator } from "@playwright/test";

/**
 * The signup terms checkbox (S1-26 item 3), measured in a real browser: its whole label is a click target at least 44px tall, "Privacy Policy." keeps
 * its full stop with the link (at 360px it used to break as "...Privacy Policy" with a stranded "." on a line of its own), and clicking the empty
 * edge of the label toggles the checkbox. Public page, no database. The same promises are checked without a browser in tests/auth/signup-terms-label.test.tsx.
 */
const MIN_TARGET = 44;

function termsLabel(page: import("@playwright/test").Page): Locator {
  return page.locator("label:has(input[name='termsAccepted'])");
}

for (const width of [360, 390, 1440]) {
  test.describe(`signup terms label at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("the whole label is at least 44px tall", async ({ page }) => {
      await page.goto("/signup");
      const label = termsLabel(page);
      await expect(label).toBeVisible();
      const box = await label.boundingBox();
      expect(box, "the terms label has a box").not.toBeNull();
      expect(box!.height, `the terms label is ${box!.height.toFixed(1)}px tall at ${width}px; the minimum is ${MIN_TARGET}`).toBeGreaterThanOrEqual(MIN_TARGET);
    });

    test("'Privacy Policy.' stays on one line, with its full stop", async ({ page }) => {
      await page.goto("/signup");
      const policy = page.locator("label:has(input[name='termsAccepted']) a[href='/legal/privacy']");
      await expect(policy).toBeVisible();
      const measured = await policy.evaluate((a) => {
        const wrap = a.parentElement as HTMLElement;
        const range = document.createRange();
        range.selectNodeContents(wrap);
        // one rectangle per box and per text fragment, so count the distinct line positions (tops), not the rectangles
        const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
        return { lines: tops.size, text: wrap.textContent };
      });
      expect(measured.text, "the link and its full stop share a wrapper").toBe("Privacy Policy.");
      expect(measured.lines, `'${measured.text}' is on ${measured.lines} lines at ${width}px; the full stop must stay on the same line as the link`).toBe(1);
    });

    test("clicking the empty bottom edge of the label toggles the checkbox", async ({ page }) => {
      await page.goto("/signup");
      const label = termsLabel(page);
      const box = (await label.boundingBox())!;
      const checkbox = page.locator("input[name='termsAccepted']");
      await expect(checkbox).not.toBeChecked();
      // label.click scrolls the label into view first (it is below the fold on a phone); a raw mouse click at a page coordinate would miss it
      await label.click({ position: { x: box.width / 2, y: box.height - 2 } });
      await expect(checkbox).toBeChecked();
    });
  });
}
