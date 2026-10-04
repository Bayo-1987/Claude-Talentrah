/**
 * CHARACTERIZATION (report only; this work does not change behaviour): pins what the commits do today, against the real database and the real
 * functions, when PARALLEL = 10 requests are in flight at once with one free message, or one credit, left. Any future change to charge timing
 * has to change these numbers on purpose. Database-backed: it runs in CI only, and its first run is CI's.
 */
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
  await admin.from("credit_gate_events").delete().eq("user_id", userId);
  await admin.from("credit_ledger").delete().eq("user_id", userId);
  await setBalance(0);
});

describe(`${PARALLEL} requests in flight together`, () => {
  it("free allowance, one message left: every request passes the check, every commit records its event", async () => {
    await insertFreeEvents(FARAH_CHAT_FREE_ALLOWANCE - 1);
    expect(await farahChatFreeMessagesRemaining(userId)).toBe(1);

    const allowances = await Promise.all(Array.from({ length: PARALLEL }, () => checkFarahChatAllowance(userId)));
    expect(allowances.every((a) => a.isFreeAllowance), "every request was told it is covered by the free allowance").toBe(true);

    const results = await Promise.allSettled(allowances.map((a) => commitFarahChatAllowance(userId, a)));
    const completedFree = results.filter((r) => r.status === "fulfilled").length;
    console.info(`[characterization] ${completedFree} of ${PARALLEL} parallel requests completed under the free allowance`);
    expect(completedFree).toBe(PARALLEL);

    const { count } = await admin
      .from("credit_gate_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("outcome", "covered_by_free_allowance");
    expect(count, "events recorded in the window").toBe(FARAH_CHAT_FREE_ALLOWANCE - 1 + PARALLEL);
    expect(await farahChatFreeMessagesRemaining(userId)).toBe(0);
  });

  it("one credit left: every request passes the check; exactly one commit succeeds, the rest throw InsufficientCreditsError, the balance is 0 and one ledger row exists", async () => {
    await insertFreeEvents(FARAH_CHAT_FREE_ALLOWANCE);
    await setBalance(1);

    const allowances = await Promise.all(Array.from({ length: PARALLEL }, () => checkFarahChatAllowance(userId)));
    expect(allowances.every((a) => a.creditsSpent === 1)).toBe(true);

    const results = await Promise.allSettled(allowances.map((a) => commitFarahChatAllowance(userId, a)));
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    console.info(`[characterization] ${fulfilled.length} of ${PARALLEL} parallel requests completed by spending the one credit`);
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(PARALLEL - 1);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(InsufficientCreditsError);

    expect(await balance(), "never negative").toBe(0);
    const { data: ledger } = await admin.from("credit_ledger").select("delta, reason").eq("user_id", userId).eq("reason", "farah_chat_message");
    expect(ledger?.length).toBe(1);
    expect(ledger?.[0].delta).toBe(-1);

    // The check wrote a 'proceeded' funnel row for EACH request, though one was charged: the funnel is not a charge log.
    const { count: proceeded } = await admin
      .from("credit_gate_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("outcome", "proceeded");
    expect(proceeded).toBe(PARALLEL);
  });
});
