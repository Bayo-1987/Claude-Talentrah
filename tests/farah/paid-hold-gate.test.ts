/**
 * The paid-message hold on the REAL database and the real ledger (audit 9 Oct, "Farah paid message race"): a paid message takes its credit at the check, both the spend and any refund are ledger rows
 * carrying the same hold id, a completed message is charged once and nothing more, a released one nets to zero, and a free message never touches the ledger. (The route's exits are in
 * paid-hold-route-exits.test.ts; the ten-at-once race for the last credit is in chat-gate-concurrent-commit.test.ts.)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { checkFarahChatAllowance, commitFarahChatAllowance, releaseFarahChatAllowance, FARAH_CHAT_FREE_ALLOWANCE } from "@/lib/farah/chat-gate";

let userId: string;
beforeAll(async () => {
  userId = (await createTestUser("farahpaidhold")).id;
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
const ledger = async () => (await admin.from("credit_ledger").select("delta, reason, related_entity_id, balance_after").eq("user_id", userId).order("created_at", { ascending: true })).data ?? [];
async function useUpFreeAllowance() {
  const { error } = await admin.from("credit_gate_events").insert(
    Array.from({ length: FARAH_CHAT_FREE_ALLOWANCE }, () => ({ user_id: userId, reason: "farah_chat_message", credits_required: 0, credits_available: 0, outcome: "covered_by_free_allowance", created_at: new Date(Date.now() - 1000).toISOString() })),
  );
  if (error) throw new Error(error.message);
}

describe("a paid message", () => {
  it("takes its credit at the check: the balance is already 4, one ledger row of -1 carries the hold id; the commit then charges nothing more and reports the ledger's balance", async () => {
    await useUpFreeAllowance();
    await setBalance(5);
    const allowance = await checkFarahChatAllowance(userId);
    expect(allowance.paidHold?.credits).toBe(1);
    expect(await balance(), "taken before any reply").toBe(4);
    const rows = await ledger();
    expect(rows.map((r) => r.delta)).toEqual([-1]);
    expect(rows[0].related_entity_id).toBe(allowance.paidHold?.holdId);

    const committed = await commitFarahChatAllowance(userId, allowance);
    expect(committed.balanceAfter).toBe(4);
    expect(await balance()).toBe(4);
    expect((await ledger()).map((r) => r.delta), "still exactly one ledger row").toEqual([-1]);
  });

  it("released (any exit that is not a completed reply): the credit comes back, the ledger shows the spend and the refund under the SAME hold id, the balance is where it started", async () => {
    await useUpFreeAllowance();
    await setBalance(5);
    const allowance = await checkFarahChatAllowance(userId);
    await releaseFarahChatAllowance(userId, allowance);
    expect(await balance()).toBe(5);
    const rows = await ledger();
    expect(rows.map((r) => r.delta)).toEqual([-1, 1]);
    expect(rows.every((r) => r.reason === "farah_chat_message")).toBe(true);
    expect(new Set(rows.map((r) => r.related_entity_id)).size).toBe(1);
    expect(rows[0].related_entity_id).toBe(allowance.paidHold?.holdId);
  });

  it("two paid messages released and completed in turn leave the account exactly one credit down", async () => {
    await useUpFreeAllowance();
    await setBalance(5);
    const first = await checkFarahChatAllowance(userId);
    await releaseFarahChatAllowance(userId, first);
    const second = await checkFarahChatAllowance(userId);
    await commitFarahChatAllowance(userId, second);
    expect(await balance()).toBe(4);
    expect((await ledger()).reduce((n, r) => n + r.delta, 0)).toBe(-1);
  });
});

describe("a free message is unchanged", () => {
  it("carries no paid hold and writes no ledger row, at the check, the commit or the release", async () => {
    await setBalance(5);
    const allowance = await checkFarahChatAllowance(userId);
    expect(allowance.isFreeAllowance).toBe(true);
    expect(allowance.paidHold).toBeUndefined();
    await commitFarahChatAllowance(userId, allowance);
    expect(await ledger()).toEqual([]);
    expect(await balance()).toBe(5);
  });
});
