/**
 * send-485 (issue #605) — after a credit-paid Farah message, the masthead's credit balance updates
 * WITHOUT a reload. It used to keep showing the pre-charge number (41) until the next navigation,
 * though the ledger and profiles.credits_balance already said 40.
 *
 * Both directions, because the second is what stops the first from being "always show one less":
 *  - a PAID message (free allowance used up) changes the pill from 41 to 40;
 *  - a FREE message leaves it at 41.
 * The page is never reloaded: a marker set on `window` before sending must still be there afterwards,
 * which a navigation or reload would have wiped. The database is checked too, so "the pill changed" cannot
 * be satisfied by a UI that invented the number.
 *
 * Runs against the stub LLM (LLM_PROVIDER=stub), like the golden path.
 */
import { test, expect, admin, grantTestCredits, requireStubbedLlm } from "./fixtures/authed";
import type { Page } from "@playwright/test";

async function useUpFreeAllowance(userId: string) {
  const { error } = await admin.from("credit_gate_events").insert(
    Array.from({ length: 3 }, () => ({
      user_id: userId,
      reason: "farah_chat_message" as const,
      credits_required: 0,
      credits_available: 41,
      outcome: "covered_by_free_allowance" as const,
    })),
  );
  if (error) throw new Error(`could not use up the free allowance: ${error.message}`);
}

async function sendToFarah(page: Page, text: string) {
  await page.getByPlaceholder("Ask me anything…").fill(text);
  await page.getByRole("button", { name: "Send to Farah" }).click();
}

const pill = (page: Page, n: number) => page.getByRole("link", { name: `${n} credits · Top up` });

async function balanceInDb(userId: string): Promise<number> {
  const { data, error } = await admin.from("profiles").select("credits_balance").eq("id", userId).single();
  if (error || !data) throw new Error(`reading balance: ${error?.message}`);
  return data.credits_balance;
}

test.describe("the masthead credit balance after a Farah message", () => {
  test("a paid message changes it from 41 to 40 without a reload", async ({ authedPage, testUser }) => {
    await requireStubbedLlm(authedPage);
    await grantTestCredits(testUser.id, 41);
    await useUpFreeAllowance(testUser.id);

    await authedPage.goto("/tracker");
    await expect(pill(authedPage, 41), "precondition: the masthead starts at 41").toBeVisible();
    await authedPage.evaluate(() => {
      (window as unknown as { __noReload: boolean }).__noReload = true;
    });

    await sendToFarah(authedPage, "Hello");
    await expect(pill(authedPage, 40), "the masthead must show the post-charge balance").toBeVisible();
    await expect(pill(authedPage, 41)).toHaveCount(0);

    expect(await balanceInDb(testUser.id), "the database agrees").toBe(40);
    expect(
      await authedPage.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload),
      "the page was reloaded or navigated, so this proves nothing about live updating",
    ).toBe(true);
  });

  test("a free message leaves it at 41", async ({ authedPage, testUser }) => {
    await requireStubbedLlm(authedPage);
    await grantTestCredits(testUser.id, 41);

    await authedPage.goto("/tracker");
    await expect(pill(authedPage, 41)).toBeVisible();
    await authedPage.evaluate(() => {
      (window as unknown as { __noReload: boolean }).__noReload = true;
    });

    await sendToFarah(authedPage, "Hello");
    // The reply finishing is what the free counter's update rides on; wait for it so "unchanged" is a
    // statement about the end state and not about a message still in flight.
    await expect(authedPage.getByText("2 free messages left.")).toBeVisible();

    await expect(pill(authedPage, 41)).toBeVisible();
    await expect(pill(authedPage, 40)).toHaveCount(0);
    expect(await balanceInDb(testUser.id)).toBe(41);
    expect(await authedPage.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
  });
});
