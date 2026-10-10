/**
 * CHARACTERIZATION (changed on purpose by migration 0236, the free-message claim): pins what the gate does against the real database and the real functions when PARALLEL = 10 requests are in
 * flight at once with one free message, or one credit, left. Before the claim, all 10 requests passed the free check and all 10 committed (12 events in the window for an account that had 2
 * used). With the claim, taken before the model call, exactly ONE request gets the last free slot and the other 9 fall through to Pass/credits/refusal. Any future change to charge timing has to
 * change these numbers on purpose. Database-backed: it runs in CI only, and its first run is CI's.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import {
  checkFarahChatAllowance,
  commitFarahChatAllowance,
  farahChatFreeMessagesRemaining,
  FARAH_CHAT_FREE_ALLOWANCE,
  InsufficientCreditsError,
} from "@/lib/farah/chat-gate";

const PARALLEL = 10;
let userId: string;

beforeAll(async () => {
  userId = (await createTestUser("farahconc")).id;
}, 60_000);
afterAll(async () => {
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

async function insertFreeEvents(n: number) {
  const rows = Array.from({ length: n }, () => ({
    user_id: userId,
    reason: "farah_chat_message" as const,
    credits_required: 0,
    credits_available: 0,
    outcome: "covered_by_free_allowance" as const,
  }));
  const { error } = await admin.from("credit_gate_events").insert(rows);
  if (error) throw new Error(`fixture: ${error.message}`);
}
async function setBalance(amount: number) {
  const { error } = await admin.from("profiles").update({ credits_balance: amount }).eq("id", userId);
  if (error) throw new Error(`fixture balance: ${error.message}`);
}
async function balance(): Promise<number> {
  const { data } = await admin.from("profiles").select("credits_balance").eq("id", userId).single();
  return data?.credits_balance ?? NaN;
}

afterEach(async () => {
  await (admin as unknown as SupabaseClient).from("farah_free_claims").delete().eq("user_id", userId);
  await admin.from("credit_gate_events").delete().eq("user_id", userId);
  await admin.from("credit_ledger").delete().eq("user_id", userId);
  await setBalance(0);
});

describe(`${PARALLEL} requests in flight together`, () => {
  it("free allowance, one message left: exactly ONE request is covered by the free allowance; the other 9 are refused (no credits, no Pass) before any model call; the account ends at exactly 3", async () => {
    await insertFreeEvents(FARAH_CHAT_FREE_ALLOWANCE - 1);
    expect(await farahChatFreeMessagesRemaining(userId)).toBe(1);

    const checks = await Promise.allSettled(Array.from({ length: PARALLEL }, () => checkFarahChatAllowance(userId)));
    const free = checks.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof checkFarahChatAllowance>>> => r.status === "fulfilled");
    const refused = checks.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    console.info(`[characterization] ${free.length} of ${PARALLEL} parallel requests were given the last free message`);
    expect(free).toHaveLength(1);
    expect(free[0].value.isFreeAllowance).toBe(true);
    expect(refused).toHaveLength(PARALLEL - 1);
    for (const r of refused) expect(r.reason).toBeInstanceOf(InsufficientCreditsError);

    await commitFarahChatAllowance(userId, free[0].value);
    const { count } = await admin
      .from("credit_gate_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("outcome", "covered_by_free_allowance");
    expect(count, "events recorded in the window").toBe(FARAH_CHAT_FREE_ALLOWANCE);
    expect(await farahChatFreeMessagesRemaining(userId)).toBe(0);
  });

  it("one credit left (changed on purpose, audit 9 Oct): the credit is taken AT THE CHECK, so exactly one request gets it and the other 9 are refused there, before any model call; the balance is 0, one ledger row of -1, and the commit charges nothing more", async () => {
    await insertFreeEvents(FARAH_CHAT_FREE_ALLOWANCE);
    await setBalance(1);

    const checks = await Promise.allSettled(Array.from({ length: PARALLEL }, () => checkFarahChatAllowance(userId)));
    const won = checks.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof checkFarahChatAllowance>>> => r.status === "fulfilled");
    const refused = checks.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    console.info(`[characterization] ${won.length} of ${PARALLEL} parallel requests took the one credit at the check`);
    expect(won).toHaveLength(1);
    expect(won[0].value.paidHold?.credits).toBe(1);
    expect(refused).toHaveLength(PARALLEL - 1);
    for (const r of refused) expect(r.reason).toBeInstanceOf(InsufficientCreditsError);

    const committed = await commitFarahChatAllowance(userId, won[0].value);
    expect(committed.balanceAfter, "the ledger's own balance_after for that spend").toBe(0);

    expect(await balance(), "never negative").toBe(0);
    const { data: ledger } = await admin.from("credit_ledger").select("delta, reason").eq("user_id", userId).eq("reason", "farah_chat_message");
    expect(ledger?.map((l) => l.delta)).toEqual([-1]);

    // Only the winner is logged as 'proceeded'; each refused request is logged as blocked.
    const outcomes = async (outcome: string) =>
      (await admin.from("credit_gate_events").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("outcome", outcome as never)).count;
    expect(await outcomes("proceeded")).toBe(1);
    expect(await outcomes("blocked_insufficient_credits")).toBe(PARALLEL - 1);
  });
});
