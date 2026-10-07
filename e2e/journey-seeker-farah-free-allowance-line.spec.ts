/**
 * QA journey (UNRUN when written: authored on a machine with no local stack; CI is its first run): the line under Farah's greeting about the free allowance.
 *
 * What a seeker reads, step by step: a new account sees "3 free messages left."; after one real message through the panel (stub model) it reads "2 free messages
 * left."; with all three used it says the free messages are used and, when a date is known, "Your next free message is available on <weekday time>. Until then,
 * each message costs N credits." Copy from src/lib/credits/price-labels.ts (farahAllowanceText) on main 0dc417f. Clicks and typing only; every step screenshotted.
 */
import { test, expect, admin, grantTestCredits, requireStubbedLlm } from "./fixtures/authed";

test.use({ viewport: { width: 1280, height: 900 } });

async function ask(page: import("@playwright/test").Page, text: string) {
  await page.getByPlaceholder("Ask me anything…").fill(text);
  await page.getByRole("button", { name: "Send to Farah" }).click();
}

test("the allowance line counts down from 3 as free messages are used", async ({ authedPage: page, testUser }, info) => {
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await requireStubbedLlm(page);
  await grantTestCredits(testUser.id, 50);
  await page.goto("/settings");
  await expect(page.getByText("3 free messages left.")).toBeVisible();
  await shot("1-three-left");

  await ask(page, "What should I work on first?");
  await expect(page.getByText("2 free messages left.")).toBeVisible({ timeout: 30_000 });
  await shot("2-two-left-after-one-message");
});

test("with the free messages used, the line says when the next one is available and what messages cost until then", async ({ authedPage: page, testUser }, info) => {
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await requireStubbedLlm(page);
  await grantTestCredits(testUser.id, 50);
  const { error } = await admin.from("credit_gate_events").insert(
    Array.from({ length: 3 }, () => ({ user_id: testUser.id, reason: "farah_chat_message" as const, credits_required: 0, credits_available: 50, outcome: "covered_by_free_allowance" as const })),
  );
  if (error) throw error;

  await page.goto("/settings");
  const note = page.getByText(/You.ve used your free messages\./).first();
  await expect(note).toBeVisible();
  await expect(note).toContainText("Your next free message is available on");
  await expect(note).toContainText(/Until then, each message costs \d+ credits?\./);
  await shot("1-used-up-with-next-free-date");
});
