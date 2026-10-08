/**
 * What one Farah chat message takes from a balance, on the real database through the real check-then-commit path the route uses: a PAID message (free allowance used up, no Pass)
 * lowers the balance by exactly 1 and writes exactly one ledger row of -1; a FREE message takes nothing and writes no ledger row. The amounts are literals on purpose: the other
 * gate tests compute them from CREDIT_COSTS, which would follow a wrong constant.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { checkFarahChatAllowance, commitFarahChatAllowance, FARAH_CHAT_FREE_ALLOWANCE } from "@/lib/farah/chat-gate";

let userId: string;
beforeAll(async () => {
  userId = (await createTestUser("farahonecredit")).id;
}, 60_000);
afterAll(async () => {
  if (userId) await deleteTestUsers([userId]);
}, 60_000);
afterEach(async () => {
  await admin.from("credit_gate_events").delete().eq("user_id", userId);
  await admin.from("credit_ledger").delete().eq("user_id", userId);
  await (admin as unknown as SupabaseClient).from("farah_free_claims").delete().eq("user_id", userId);
});

const setBalance = async (n: number) => {
  const { error } = await admin.from("profiles").update({ credits_balance: n }).eq("id", userId);
  if (error) throw new Error(error.message);
};
const balance = async () => (await admin.from("profiles").select("credits_balance").eq("id", userId).single()).data?.credits_balance;
async function useUpFreeAllowance() {
  const { error } = await admin.from("credit_gate_events").insert(
    Array.from({ length: FARAH_CHAT_FREE_ALLOWANCE }, () => ({ user_id: userId, reason: "farah_chat_message", credits_required: 0, credits_available: 0, outcome: "covered_by_free_allowance", created_at: new Date(Date.now() - 1000).toISOString() })),
  );
  if (error) throw new Error(error.message);
}
async function send() {
  const allowance = await checkFarahChatAllowance(userId);
  await commitFarahChatAllowance(userId, allowance);
  return allowance;
}

describe("one Farah message", () => {
  it("a paid message takes exactly 1 credit and writes one ledger row of -1", async () => {
    await useUpFreeAllowance();
    await setBalance(5);
    const allowance = await send();
    expect(allowance.isFreeAllowance).toBe(false);
    expect(allowance.creditsSpent).toBe(1);
    expect(await balance()).toBe(4);
    const { data: rows } = await admin.from("credit_ledger").select("delta").eq("user_id", userId);
    expect((rows ?? []).map((r) => r.delta)).toEqual([-1]);
  });

  it("two paid messages take 2 credits, not 1 and not 3", async () => {
    await useUpFreeAllowance();
    await setBalance(5);
    await send();
    await send();
    expect(await balance()).toBe(3);
  });

  it("a free message takes no credit and writes no ledger row", async () => {
    await setBalance(5);
    const allowance = await send();
    expect(allowance.isFreeAllowance).toBe(true);
    expect(allowance.creditsSpent).toBe(0);
    expect(await balance()).toBe(5);
    const { data: rows } = await admin.from("credit_ledger").select("delta").eq("user_id", userId);
    expect(rows ?? []).toEqual([]);
  });
});
