/**
 * QA finding proof (RED today): on a first visit the Farah first-visit hint card is partly hidden behind the masthead while the cookie banner is showing.
 * The card is position:fixed at top 84px; the cookie banner (75px) pushes the sticky masthead down to 75-145px, so the card's first 61px (its heading and first lines)
 * sit under the masthead. Once the banner is answered the masthead is 0-70px and the card is fully visible. A new signed-in person meets both on arrival.
 */
import { test, expect, grantTestCredits } from "./fixtures/authed";

test.use({ viewport: { width: 1366, height: 768 } });

test("the first-visit hint card is not covered by the masthead while the cookie banner is showing", async ({ authedPage: page, testUser }) => {
  await grantTestCredits(testUser.id, 200);
  await page.goto("/billing");
  await expect(page.getByRole("button", { name: "Show me" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Decline" })).toBeVisible(); // the banner is up: nothing answered yet
  const { cardTop, headerBottom } = await page.evaluate(() => {
    const show = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Show me")!;
    let c: HTMLElement | null = show as HTMLElement;
    while (c && c !== document.body && getComputedStyle(c).position !== "fixed") c = c.parentElement;
    return { cardTop: c!.getBoundingClientRect().top, headerBottom: document.querySelector("header")!.getBoundingClientRect().bottom };
  });
  expect(cardTop, `card top ${cardTop}px must be at or below the masthead bottom ${headerBottom}px`).toBeGreaterThanOrEqual(headerBottom);
});
