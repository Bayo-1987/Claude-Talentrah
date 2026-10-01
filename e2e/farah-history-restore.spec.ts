/**
 * send-504 / S7 — a reload brings back the Farah thread you were just in; an old one stays behind "Continue".
 *
 * What the owner hit: two paid answers, a reload, and only "Continue where you left off with Farah?" remained. The thread was
 * fetched and held back behind that line. Rule now: last message under 24 hours old -> restored on load; older -> still behind
 * "Continue", and pressing it restores in place.
 *
 * Both sides of the 24-hour line (23h and 25h, a margin either side so a slow runner cannot flip it; the exact second is pinned by
 * tests/farah/history-restore.test.ts). The rows are written straight to farah_messages for the test user, so no LLM is involved.
 * NOT run locally (no database on the authoring machine): this spec's first run is its CI run.
 */
import { test, expect, admin } from "./fixtures/authed";

const H = 3_600_000;
const RECENT_Q = "E2E restore: how do I negotiate a counter-offer?";
const RECENT_A = "E2E restore: start with the number you can defend, then ask what flexibility exists.";

async function seedThread(userId: string, lastMessageAgeHours: number) {
  const end = Date.now() - lastMessageAgeHours * H;
  const rows = [
    { user_id: userId, role: "user" as const, content: RECENT_Q, created_at: new Date(end - 60_000).toISOString() },
    { user_id: userId, role: "farah" as const, content: RECENT_A, created_at: new Date(end).toISOString() },
  ];
  const { error } = await admin.from("farah_messages").insert(rows);
  if (error) throw new Error(`could not seed the Farah thread: ${error.message}`);
}

const thread = (page: import("@playwright/test").Page) => page.getByTestId("farah-message");

test.describe("Farah's thread after a reload", () => {
  test("a thread whose last message is 23 hours old is restored on load, no click needed", async ({ authedPage, testUser }) => {
    await seedThread(testUser.id, 23);
    await authedPage.goto("/tracker");
    await expect(authedPage.getByText(RECENT_A)).toBeVisible();
    await expect(authedPage.getByText(RECENT_Q)).toBeVisible();
    await expect(authedPage.getByText("Continue where you left off with Farah?")).toHaveCount(0);

    // And it survives a reload, which is the case the owner hit.
    await authedPage.reload();
    await expect(authedPage.getByText(RECENT_A)).toBeVisible();
    await expect(thread(authedPage)).toHaveCount(2);
  });

  test("a thread whose last message is 25 hours old stays behind 'Continue', and Continue restores it in place", async ({ authedPage, testUser }) => {
    await seedThread(testUser.id, 25);
    await authedPage.goto("/tracker");
    const cont = authedPage.getByRole("button", { name: "Continue where you left off with Farah?" });
    await expect(cont).toBeVisible();
    await expect(authedPage.getByText(RECENT_A)).toHaveCount(0);

    await cont.click();
    await expect(authedPage.getByText(RECENT_A)).toBeVisible();
    await expect(authedPage.getByText(RECENT_Q)).toBeVisible();
    await expect(cont).toHaveCount(0);
  });

  test("no thread at all: the greeting, and no Continue offer", async ({ authedPage }) => {
    await authedPage.goto("/tracker");
    await expect(authedPage.getByText(/I can help you prep for an interview/)).toBeVisible();
    await expect(authedPage.getByText("Continue where you left off with Farah?")).toHaveCount(0);
  });
});
