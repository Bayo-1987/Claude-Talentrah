/**
 * The daily paid-hold sweep (FARAH-PAID-HOLD-SWEEP; migration 0252). A paid Farah message takes its credit at the check (#908) and gives it back on any exit that is not a completed reply. A process killed in between leaves
 * the credit taken. The sweep finds those holds and refunds each ONCE.
 *
 * An ORPHAN is a spend row (reason farah_chat_message, delta < 0, carrying a hold id) older than 15 minutes with NO refund row (delta > 0, same hold id) and NO completion marker. There are two markers and either one
 * means "delivered": a 'proceeded' gate event carrying the hold id (written at commit) and a saved message whose context carries the hold id. On a real database, with migration 0252 applied (the unique index is what
 * makes "once" hold when two sweeps overlap).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { checkFarahChatAllowance, commitFarahChatAllowance, FARAH_CHAT_FREE_ALLOWANCE } from "@/lib/farah/chat-gate";
import { sweepPaidHolds } from "@/lib/farah/paid-hold-sweep";

const MIN = 60_000;
let userId = "";
let otherUserId = "";
beforeAll(async () => {
  [userId, otherUserId] = (await Promise.all([createTestUser("holdsweep"), createTestUser("holdsweep2")])).map((u) => u.id);
}, 90_000);
afterAll(async () => {
  await deleteTestUsers([userId, otherUserId].filter(Boolean));
}, 90_000);
beforeEach(async () => {
  for (const u of [userId, otherUserId]) await admin.from("profiles").update({ credits_balance: 10 }).eq("id", u);
});
afterEach(async () => {
  for (const u of [userId, otherUserId]) {
    await admin.from("credit_gate_events").delete().eq("user_id", u);
    await admin.from("farah_messages").delete().eq("user_id", u);
    await admin.from("credit_ledger").delete().eq("user_id", u);
    await (admin as unknown as SupabaseClient).from("farah_free_claims").delete().eq("user_id", u);
    await admin.from("profiles").update({ credits_balance: 10 }).eq("id", u);
  }
  vi.restoreAllMocks();
});

const balance = async (u = userId) => (await admin.from("profiles").select("credits_balance").eq("id", u).single()).data?.credits_balance;
const setBalance = async (n: number, u = userId) => {
  await admin.from("profiles").update({ credits_balance: n }).eq("id", u);
};
const ledgerFor = async (hold: string) => (await admin.from("credit_ledger").select("delta, user_id, reason").eq("related_entity_id", hold).order("delta")).data ?? [];

/** A paid hold exactly as the gate leaves it after the spend: one -1 row under a hold id, `ageMin` minutes old. */
async function spendHold(ageMin: number, u = userId, reason: "farah_chat_message" | "bullet_rewrite" = "farah_chat_message") {
  const hold = randomUUID();
  const { data, error } = await admin.rpc("spend_credits_atomic", { p_user_id: u, p_amount: 1, p_reason: reason, p_related_entity_id: hold });
  if (error || !data?.[0]?.ok) throw new Error(`fixture spend: ${error?.message ?? "refused"}`);
  const { error: ageError } = await admin.from("credit_ledger").update({ created_at: new Date(Date.now() - ageMin * MIN).toISOString() }).eq("related_entity_id", hold);
  if (ageError) throw new Error(ageError.message);
  return hold;
}
const markGate = (hold: string, u = userId) =>
  admin.from("credit_gate_events").insert({ user_id: u, reason: "farah_chat_message", credits_required: 1, credits_available: 5, outcome: "proceeded", related_entity_id: hold });
const markMessage = (hold: string, u = userId) =>
  admin.from("farah_messages").insert({ user_id: u, role: "farah", content: "A saved reply.", context: { hold } });
const refund = (hold: string, u = userId, reason: "farah_chat_message" = "farah_chat_message") =>
  admin.rpc("grant_credits_atomic", { p_user_id: u, p_amount: 1, p_reason: reason, p_related_entity_id: hold });

describe("a charged but unanswered paid message is refunded", () => {
  it("an orphaned hold (a spend, 20 minutes old, no refund, no marker) is refunded: balance back, one +1 row under the SAME hold id", async () => {
    const hold = await spendHold(20);
    expect(await balance()).toBe(9);
    const summary = await sweepPaidHolds();
    expect(summary.ok).toBe(true);
    expect(summary.refunded).toBeGreaterThanOrEqual(1);
    expect(await balance(), "the credit came back").toBe(10);
    expect((await ledgerFor(hold)).map((r) => r.delta)).toEqual([-1, 1]);
  });

  it("the refund goes to the user the spend belonged to", async () => {
    const hold = await spendHold(30, otherUserId);
    await sweepPaidHolds();
    expect(await balance(otherUserId)).toBe(10);
    expect((await ledgerFor(hold)).every((r) => r.user_id === otherUserId)).toBe(true);
  });

  it("two orphans belonging to two different people are each refunded to their own account", async () => {
    const mine = await spendHold(20, userId);
    const theirs = await spendHold(25, otherUserId);
    await sweepPaidHolds();
    expect(await balance(userId)).toBe(10);
    expect(await balance(otherUserId)).toBe(10);
    expect((await ledgerFor(mine)).map((r) => `${r.delta}:${r.user_id === userId}`)).toEqual(["-1:true", "1:true"]);
    expect((await ledgerFor(theirs)).map((r) => `${r.delta}:${r.user_id === otherUserId}`)).toEqual(["-1:true", "1:true"]);
  });

  it("the real gate end to end: a message whose process was killed after the check (never committed, never released) is refunded; the same message completed is never refunded", async () => {
    await admin.from("credit_gate_events").insert(Array.from({ length: FARAH_CHAT_FREE_ALLOWANCE }, () => ({ user_id: userId, reason: "farah_chat_message" as const, credits_required: 0, credits_available: 0, outcome: "covered_by_free_allowance" as const, created_at: new Date(Date.now() - 1000).toISOString() })));
    await setBalance(5);
    const killed = await checkFarahChatAllowance(userId); // ... and the process dies here
    const delivered = await checkFarahChatAllowance(userId);
    await commitFarahChatAllowance(userId, delivered); // this one completed
    expect(await balance()).toBe(3);
    for (const h of [killed.paidHold!.holdId, delivered.paidHold!.holdId]) await admin.from("credit_ledger").update({ created_at: new Date(Date.now() - 40 * MIN).toISOString() }).eq("related_entity_id", h);

    await sweepPaidHolds();
    expect((await ledgerFor(killed.paidHold!.holdId)).map((r) => r.delta), "the killed message is refunded").toEqual([-1, 1]);
    expect((await ledgerFor(delivered.paidHold!.holdId)).map((r) => r.delta), "the completed message is never refunded").toEqual([-1]);
    expect(await balance()).toBe(4);
  });
});

describe("a delivered reply is never refunded", () => {
  it("completion marker 1 only: a 'proceeded' gate event carrying the hold id", async () => {
    const hold = await spendHold(60);
    await markGate(hold);
    await sweepPaidHolds();
    expect((await ledgerFor(hold)).map((r) => r.delta)).toEqual([-1]);
  });

  it("completion marker 2 only: a saved message whose context carries the hold id", async () => {
    const hold = await spendHold(60);
    await markMessage(hold);
    await sweepPaidHolds();
    expect((await ledgerFor(hold)).map((r) => r.delta)).toEqual([-1]);
  });

  it("a hold that was already released (a +1 row exists) is not refunded a second time", async () => {
    const hold = await spendHold(60);
    expect((await refund(hold)).error).toBeNull();
    const before = await balance();
    const summary = await sweepPaidHolds();
    expect(await balance()).toBe(before);
    expect((await ledgerFor(hold)).map((r) => r.delta)).toEqual([-1, 1]);
    expect(summary.failed).toBe(0);
  });

  it("a hold younger than 15 minutes is left alone (its request may still be running)", async () => {
    const hold = await spendHold(10);
    await sweepPaidHolds();
    expect((await ledgerFor(hold)).map((r) => r.delta)).toEqual([-1]);
  });

  it("a spend for another reason (a bullet rewrite) or without a hold id is never touched", async () => {
    const bullet = await spendHold(60, userId, "bullet_rewrite");
    await admin.rpc("spend_credits_atomic", { p_user_id: userId, p_amount: 1, p_reason: "farah_chat_message" }); // no hold id
    await admin.from("credit_ledger").update({ created_at: new Date(Date.now() - 60 * MIN).toISOString() }).eq("user_id", userId);
    const before = await balance();
    await sweepPaidHolds();
    expect(await balance()).toBe(before);
    expect((await ledgerFor(bullet)).map((r) => r.delta)).toEqual([-1]);
  });
});

describe("once, however many sweeps", () => {
  it("run twice in a row: refunded once", async () => {
    const hold = await spendHold(20);
    await sweepPaidHolds();
    await sweepPaidHolds();
    expect((await ledgerFor(hold)).map((r) => r.delta)).toEqual([-1, 1]);
    expect(await balance()).toBe(10);
  });

  it("two sweeps OVERLAPPING: a charged-but-unanswered message is refunded exactly once, neither run fails, and the balance rises by exactly one", async () => {
    const hold = await spendHold(20);
    const [a, b] = await Promise.all([sweepPaidHolds(), sweepPaidHolds()]);
    expect((await ledgerFor(hold)).map((r) => r.delta), "MONEY: refunded twice").toEqual([-1, 1]);
    expect(await balance()).toBe(10);
    expect(a.ok && b.ok).toBe(true);
    expect(a.refunded + b.refunded, "exactly one of the two refunded it").toBeGreaterThanOrEqual(1);
    expect(a.alreadyRefunded + b.alreadyRefunded + a.refunded + b.refunded).toBeGreaterThanOrEqual(2);
  });

  it("five overlapping sweeps over three orphans: three refunds in total", async () => {
    const holds = [await spendHold(20), await spendHold(25), await spendHold(30)];
    await Promise.all(Array.from({ length: 5 }, () => sweepPaidHolds()));
    for (const h of holds) expect((await ledgerFor(h)).map((r) => r.delta)).toEqual([-1, 1]);
    expect(await balance()).toBe(10);
  });
});

describe("when something goes wrong", () => {
  it("a refund that fails is counted, the run is not ok, and the other holds are still refunded", async () => {
    const bad = await spendHold(20);
    const good = await spendHold(25);
    const failing = new Proxy(admin, {
      get(target, prop, receiver) {
        if (prop !== "rpc") return Reflect.get(target, prop, receiver);
        return (name: string, args: Record<string, unknown>) =>
          name === "grant_credits_atomic" && args.p_related_entity_id === bad ? Promise.resolve({ data: null, error: { code: "08006", message: "connection failure" } }) : (target.rpc as (n: string, a: unknown) => unknown).call(target, name, args);
      },
    }) as unknown as SupabaseClient<Database>;
    const summary = await sweepPaidHolds({ supabase: failing });
    expect(summary.failed).toBe(1);
    expect(summary.ok).toBe(false);
    expect((await ledgerFor(bad)).map((r) => r.delta)).toEqual([-1]);
    expect((await ledgerFor(good)).map((r) => r.delta)).toEqual([-1, 1]);
  });

  it("a work list that cannot be read is not ok and refunds nothing", async () => {
    const chain: unknown = new Proxy(function () {}, { get: (_t, p) => (p === "then" ? (res: (v: unknown) => void) => res({ data: null, error: { message: "boom" } }) : chain), apply: () => chain });
    const summary = await sweepPaidHolds({ supabase: { from: () => chain, rpc: () => chain } as never });
    expect(summary.ok).toBe(false);
    expect(summary.refunded).toBe(0);
    expect(summary.readError).toContain("boom");
  });
});

describe("the log line and the count", () => {
  it("one content-free line with the counts: no user id, no hold id, no text", async () => {
    const hold = await spendHold(20);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const summary = await sweepPaidHolds();
    const lines = info.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[farah-paid-hold-sweep]"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/examined=\d+ orphaned=\d+ refunded=\d+ already=\d+ failed=\d+/);
    expect(lines[0]).toContain(`refunded=${summary.refunded}`);
    expect(lines[0]).not.toContain(userId);
    expect(lines[0]).not.toContain(hold);
  });
});
