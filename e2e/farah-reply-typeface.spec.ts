/**
 * Farah's replies are regular body text, italic only for emphasis (owner, 8 Oct), and a reply with a very long unbroken word still fits a 360px phone.
 * The reply is written straight to farah_messages for the test user (no LLM), then read back on a page the panel is on, in a browser at 360 x 800.
 * The unit pins are tests/farah/reply-typeface.test.tsx; this proves the computed style and the width in a real browser.
 */
import { test, expect, admin } from "./fixtures/authed";

const LONG_TOKEN = "https://example.test/a/very/long/path/with/no/spaces/that/would/widen/a/narrow/panel/if/it/could/not/wrap/at/all/0123456789";
const REPLY = `Start with the number you can defend, and say *why* it is fair. Sources: ${LONG_TOKEN}`;

test.use({ viewport: { width: 360, height: 800 } });

test("a Farah reply is upright body text with italic only on the emphasised word, and does not scroll the page sideways at 360px", async ({ authedPage, testUser }) => {
  const now = Date.now();
  const { error } = await admin.from("farah_messages").insert([
    { user_id: testUser.id, role: "user" as const, content: "E2E typeface: how do I negotiate?", created_at: new Date(now - 60_000).toISOString() },
    { user_id: testUser.id, role: "farah" as const, content: REPLY, created_at: new Date(now).toISOString() },
  ]);
  if (error) throw new Error(`could not seed the Farah thread: ${error.message}`);

  await authedPage.goto("/tracker");
  const reply = authedPage.getByTestId("farah-message").filter({ hasText: "Start with the number you can defend" });
  await expect(reply).toBeVisible();

  const paragraph = reply.locator("p").first();
  const style = await paragraph.evaluate((el) => {
    const s = getComputedStyle(el);
    return { fontStyle: s.fontStyle, fontFamily: s.fontFamily };
  });
  expect(style.fontStyle, "the reply paragraph is upright").toBe("normal");
  expect(style.fontFamily.toLowerCase(), "the reply is not set in Newsreader").not.toContain("newsreader");

  const emphasis = await reply.locator("em").first().evaluate((el) => getComputedStyle(el).fontStyle);
  expect(emphasis, "the emphasised word is italic").toBe("italic");

  const widths = await authedPage.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(widths.scroll, "the page does not scroll sideways").toBeLessThanOrEqual(widths.client);
});
