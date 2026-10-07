/**
 * send-500 (PR C) — a Farah reply cut off by the output ceiling is shown, said to be cut off, and NOT charged.
 *
 * The owner paid a credit for a reply that ended "I'm a FinTech Product Manager with". The stub LLM
 * (LLM_PROVIDER=stub) reports a length stop for any message carrying `[stub:length]` (STUB_LENGTH_TRIGGER), which
 * drives the real route, the real gate and the real panel through the cut-off path without a model hitting a
 * real ceiling. Each statement is checked against the DATABASE, not just the page:
 *   - the balance did not move, and no `farah_chat_message` ledger row was written;
 *   - the free-message counter did not go down;
 *   - the cut-off reply was still saved, marked truncated;
 *   - the control: an ordinary message right after is charged exactly as before.
 */
import type { Page } from "@playwright/test";
import { test, expect, admin, grantTestCredits, requireStubbedLlm } from "./fixtures/authed";
import { CREDIT_COSTS } from "../src/lib/credits/costs";

/**
 * Typed out here rather than imported: stub-provider.ts is `server-only`, which cannot be loaded by Playwright's
 * plain Node. tests/llm/stream-finish-reason.test.ts pins that the stub's constant equals this literal, so the
 * two cannot drift apart unnoticed.
 */
const STUB_LENGTH_TRIGGER = "[stub:length]";

const START = 50;
const pill = (page: Page, n: number) => page.getByRole("link", { name: `${n} credits · Top up` });

async function useUpFreeMessages(userId: string) {
  const { error } = await admin.from("credit_gate_events").insert(
    Array.from({ length: 3 }, () => ({
      user_id: userId,
      reason: "farah_chat_message" as const,
      credits_required: 0,
      credits_available: START,
      outcome: "covered_by_free_allowance" as const,
    })),
  );
  if (error) throw new Error(`could not use up the free allowance: ${error.message}`);
}

async function balance(userId: string): Promise<number> {
  const { data, error } = await admin.from("profiles").select("credits_balance").eq("id", userId).single();
  if (error || !data) throw new Error(`reading balance: ${error?.message}`);
  return data.credits_balance;
}

async function ledgerRows(userId: string): Promise<number> {
  const { count, error } = await admin
    .from("credit_ledger")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("reason", "farah_chat_message");
  if (error) throw new Error(`reading ledger: ${error.message}`);
  return count ?? 0;
}

async function ask(page: Page, text: string) {
  await page.getByPlaceholder("Ask me anything…").fill(text);
  await page.getByRole("button", { name: "Send to Farah" }).click();
}

test.describe("a reply cut off by the output ceiling", () => {
  test("a PAID message that is cut off is shown, flagged, saved as truncated, and not charged", async ({ authedPage: page, testUser }) => {
    await requireStubbedLlm(page);
    await grantTestCredits(testUser.id, START);
    await useUpFreeMessages(testUser.id);
    await page.goto("/tracker");
    await expect(pill(page, START)).toBeVisible();

    await ask(page, `Tell me everything about my career ${STUB_LENGTH_TRIGGER}`);

    await expect(page.getByTestId("farah-truncated-note")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("farah-truncated-note")).toContainText("wasn't charged");
    await expect(page.getByRole("status").filter({ hasText: "cut off — no credits used" })).toBeVisible();

    expect(await balance(testUser.id), "a cut-off reply must not be charged").toBe(START);
    expect(await ledgerRows(testUser.id), "and must not write a ledger row").toBe(0);
    await expect(pill(page, START), "the masthead stays where it was").toBeVisible();

    const { data: rows } = await admin.from("farah_messages").select("role, context").eq("user_id", testUser.id);
    const farah = (rows ?? []).find((r) => r.role === "farah");
    expect(farah, "the cut-off reply is still saved").toBeTruthy();
    expect((farah!.context as Record<string, unknown>).truncated).toBe(true);
  });

  test("a FREE message that is cut off does not use up one of the three free messages", async ({ authedPage: page, testUser }) => {
    await requireStubbedLlm(page);
    await grantTestCredits(testUser.id, START);
    await page.goto("/tracker");
    await expect(page.getByText("3 free messages left.")).toBeVisible();

    await ask(page, `Go deep ${STUB_LENGTH_TRIGGER}`);
    await expect(page.getByTestId("farah-truncated-note")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("3 free messages left.")).toBeVisible();

    const { count } = await admin
      .from("credit_gate_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", testUser.id)
      .eq("reason", "farah_chat_message")
      .eq("outcome", "covered_by_free_allowance");
    expect(count ?? 0, "no free-allowance event for a cut-off reply").toBe(0);
  });

  test("CONTROL: an ordinary paid message right after is charged exactly as before, and the note goes away", async ({
    authedPage: page,
    testUser,
  }) => {
    await requireStubbedLlm(page);
    await grantTestCredits(testUser.id, START);
    await useUpFreeMessages(testUser.id);
    await page.goto("/tracker");

    await ask(page, `First, cut off ${STUB_LENGTH_TRIGGER}`);
    await expect(page.getByTestId("farah-truncated-note")).toBeVisible({ timeout: 30_000 });
    expect(await balance(testUser.id)).toBe(START);

    await ask(page, "Hello again");
    await expect(page.getByTestId("farah-truncated-note")).toHaveCount(0);
    await expect.poll(() => balance(testUser.id), { timeout: 30_000 }).toBe(START - CREDIT_COSTS.farahChatMessage);
    await expect(pill(page, START - CREDIT_COSTS.farahChatMessage)).toBeVisible();
    expect(await ledgerRows(testUser.id)).toBe(1);
  });
});
