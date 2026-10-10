/**
 * Migration 0252 on a real database: a Farah paid-message hold can be refunded at most once, and nothing else about the ledger changes.
 * The refund is grant_credits_atomic (the function the application's release and the paid-hold sweep use), whose balance update and ledger insert are one function: a refused second refund must leave the
 * balance exactly where the first one put it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";

let userId = "";
beforeAll(async () => {
  userId = (await createTestUser("holdonce")).id;
}, 60_000);
afterAll(async () => {
  if (userId) await deleteTestUsers([userId]);
}, 60_000);
afterEach(async () => {
  await admin.from("credit_ledger").delete().eq("user_id", userId);
  await admin.from("profiles").update({ credits_balance: 10 }).eq("id", userId);
});

const setBalance = async (n: number) => {
  const { error } = await admin.from("profiles").update({ credits_balance: n }).eq("id", userId);
  if (error) throw new Error(error.message);
};
const balance = async () => (await admin.from("profiles").select("credits_balance").eq("id", userId).single()).data?.credits_balance;
const grant = (reason: "farah_chat_message" | "purchase" | "admin_adjustment", entity?: string, amount = 1) =>
  admin.rpc("grant_credits_atomic", { p_user_id: userId, p_amount: amount, p_reason: reason, p_related_entity_id: entity });
const spend = (entity: string) => admin.rpc("spend_credits_atomic", { p_user_id: userId, p_amount: 1, p_reason: "farah_chat_message", p_related_entity_id: entity });

describe("one refund per hold", () => {
  it("the first refund works; a second for the SAME hold is refused with 23505 and leaves the balance where the first put it", async () => {
    await setBalance(5);
    const hold = randomUUID();
    expect((await grant("farah_chat_message", hold)).error).toBeNull();
    expect(await balance()).toBe(6);
    const second = await grant("farah_chat_message", hold);
    expect(second.error?.code, "a second refund for one hold was accepted").toBe("23505");
    expect(await balance(), "the refused refund must roll back its balance increase too").toBe(6);
    const { data: rows } = await admin.from("credit_ledger").select("delta").eq("user_id", userId).eq("related_entity_id", hold);
    expect(rows).toHaveLength(1);
  });

  it("two refunds at the same moment for one hold: exactly one wins, the balance rises once", async () => {
    await setBalance(5);
    const hold = randomUUID();
    const both = await Promise.all([grant("farah_chat_message", hold), grant("farah_chat_message", hold)]);
    expect(both.filter((r) => r.error === null)).toHaveLength(1);
    expect(both.filter((r) => r.error?.code === "23505")).toHaveLength(1);
    expect(await balance()).toBe(6);
  });

  it("different holds are refunded independently", async () => {
    await setBalance(5);
    expect((await grant("farah_chat_message", randomUUID())).error).toBeNull();
    expect((await grant("farah_chat_message", randomUUID())).error).toBeNull();
    expect(await balance()).toBe(7);
  });
});

describe("what the index leaves alone", () => {
  it("the hold's own spend row (the -1 that shares the id) and its refund coexist: that is the normal life of a hold", async () => {
    await setBalance(5);
    const hold = randomUUID();
    expect((await spend(hold)).error).toBeNull();
    expect((await grant("farah_chat_message", hold)).error).toBeNull();
    expect(await balance()).toBe(5);
    const { data: rows } = await admin.from("credit_ledger").select("delta").eq("user_id", userId).eq("related_entity_id", hold).order("delta");
    expect(rows?.map((r) => r.delta)).toEqual([-1, 1]);
  });

  it("other reasons may repeat a related id (purchases, admin adjustments)", async () => {
    await setBalance(0);
    const shared = randomUUID();
    expect((await grant("purchase", shared, 5)).error).toBeNull();
    expect((await grant("purchase", shared, 5)).error).toBeNull();
    expect((await grant("admin_adjustment", shared, 2)).error).toBeNull();
    expect(await balance()).toBe(12);
  });

  it("a Farah refund with no id is not limited (nothing in the application writes one; the index must not turn it into an error)", async () => {
    await setBalance(0);
    expect((await grant("farah_chat_message")).error).toBeNull();
    expect((await grant("farah_chat_message")).error).toBeNull();
    expect(await balance()).toBe(2);
  });
});
