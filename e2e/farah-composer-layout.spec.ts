/**
 * The Farah panel's message box at a phone width and at a desktop width (the multi-line box PR).
 *
 *   - the page does not scroll sideways, before and after a message is sent;
 *   - the user's own message is on the page, visible, with its line break, and inside the viewport width;
 *   - the character counter is not there while the message is short, appears at 1,800 of 2,000, and the box
 *     stops taking characters at 2,000;
 *   - the send button is at least 44px in both directions.
 *
 * The stub LLM answers (requireStubbedLlm refuses a real model), so nothing here depends on a model.
 */
import type { Page } from "@playwright/test";
import { test, expect, requireStubbedLlm } from "./fixtures/authed";

const WIDTHS = [
  { name: "phone", width: 360, height: 740 },
  { name: "desktop", width: 1440, height: 900 },
];

const COUNTER_FROM = 1800;
const LIMIT = 2000;

async function noSidewaysScroll(page: Page, where: string) {
  const m = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(m.scroll, `${where}: the page is ${m.scroll}px wide in a ${m.client}px window`).toBeLessThanOrEqual(m.client);
}

for (const { name, width, height } of WIDTHS) {
  test.describe(`the Farah message box at ${width}px (${name})`, () => {
    test.use({ viewport: { width, height } });

    test("no sideways scroll, the user's message is visible, the counter appears near the limit, the send button is at least 44px", async ({ authedPage: page }) => {
      await requireStubbedLlm(page);
      await page.goto("/tracker");
      const box = page.getByPlaceholder("Ask me anything…");
      await box.scrollIntoViewIfNeeded();
      await expect(box).toBeVisible();
      await noSidewaysScroll(page, "before typing");

      // The send button: a real hit target.
      const send = page.getByRole("button", { name: "Send to Farah" });
      const sendBox = await send.boundingBox();
      expect(sendBox!.width, "send button width").toBeGreaterThanOrEqual(44);
      expect(sendBox!.height, "send button height").toBeGreaterThanOrEqual(44);

      // The counter is not on the page while the message is short.
      const counter = page.getByText(new RegExp(`^\\d+ / ${LIMIT}`));
      await box.fill("first line");
      await expect(counter).toHaveCount(0);

      // Shift+Enter adds a line, Enter sends (a keyboard; the touch rule is covered by the unit tests).
      await box.press("Shift+Enter");
      await box.pressSequentially("second line");
      await box.press("Enter");

      const mine = page.getByTestId("farah-message").filter({ hasText: "first line" });
      await expect(mine).toBeVisible({ timeout: 30_000 });
      await expect(mine).toContainText("second line");
      const bubble = await mine.boundingBox();
      expect(bubble!.x, "the message starts inside the window").toBeGreaterThanOrEqual(0);
      expect(bubble!.x + bubble!.width, "the message ends inside the window").toBeLessThanOrEqual(width);
      expect(bubble!.height, "two lines are taller than one").toBeGreaterThan(20);
      await noSidewaysScroll(page, "after a message");

      // One character short of the counter: still none. At 1,800: there, as "1800 / 2000".
      await expect(page.getByTestId("farah-truncated-note")).toHaveCount(0);
      await box.fill("a".repeat(COUNTER_FROM - 1));
      await expect(counter).toHaveCount(0);
      await box.fill("a".repeat(COUNTER_FROM));
      await expect(page.getByText(`${COUNTER_FROM} / ${LIMIT}`)).toBeVisible();
      const counterBox = await page.getByText(`${COUNTER_FROM} / ${LIMIT}`).boundingBox();
      expect(counterBox!.x + counterBox!.width, "the counter is inside the window").toBeLessThanOrEqual(width);

      // The limit blocks: typing past 2,000 adds nothing.
      await box.fill("a".repeat(LIMIT));
      await box.press("End");
      await box.pressSequentially("bbb");
      expect((await box.inputValue()).length).toBe(LIMIT);
      await expect(page.getByText(`${LIMIT} / ${LIMIT}`)).toBeVisible();
      await noSidewaysScroll(page, "at the limit");
    });
  });
}
