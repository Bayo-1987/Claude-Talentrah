/**
 * Migration 0247: payment_transactions carries what the Paystack check found (reconcile_checked_at, reconcile_result, reconcile_attempts), against a real database.
 * A new payment row starts with no finding; the result is limited to the closed list; the attempts count cannot go negative; the service role can write all three; no API role can read or write them
 * (the application reads them with the service role only); and writing them never moves `status`.
 * DB-backed: runs in CI (the per-job database applies every migration).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { admin, createAuthedTestUser, deleteTestUsers, type TestUser } from "../support/auth";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const anon = createClient<Database>(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
const WORDS = ["error", "fulfilled_by_check", "paystack_abandoned", "paystack_failed", "paystack_not_found", "paystack_reversed", "paystack_unsettled"];

let user: TestUser & { client: ReturnType<typeof createClient<Database>> };
let txId: string;

beforeAll(async () => {
  user = (await createAuthedTestUser("reconcilecols")) as typeof user;
  const { data: pack } = await admin.from("credit_packs").select("id").limit(1).single();
  const { data, error } = await admin
    .from("payment_transactions")
    .insert({ user_id: user.id, amount: 250000, currency: "NGN", product_type: "credit_pack", product_id: pack!.id, paystack_reference: `reconcile-cols-${user.id}`, status: "pending" })
    .select("id")
    .single();
  if (error) throw new Error(`fixture: ${error.message}`);
  txId = data!.id;
});

afterAll(async () => {
  const { error } = await admin.from("payment_transactions").delete().eq("id", txId);
  if (error) throw new Error(`cleanup: ${error.message}`);
  await deleteTestUsers([user.id]);
});

describe("0247: the three columns", () => {
  it("a new payment row has no finding", async () => {
    const { data, error } = await admin.from("payment_transactions").select("reconcile_checked_at, reconcile_result, reconcile_attempts").eq("id", txId).single();
    expect(error).toBeNull();
    expect(data).toEqual({ reconcile_checked_at: null, reconcile_result: null, reconcile_attempts: 0 });
  });

  it.each(WORDS)("the service role can record %s, and status does not move", async (word) => {
    const stamp = new Date().toISOString();
    const { error } = await admin.from("payment_transactions").update({ reconcile_result: word, reconcile_checked_at: stamp, reconcile_attempts: 1 }).eq("id", txId);
    expect(error).toBeNull();
    const { data } = await admin.from("payment_transactions").select("status, reconcile_result").eq("id", txId).single();
    expect(data).toEqual({ status: "pending", reconcile_result: word });
  });

  it("refuses a word outside the closed list", async () => {
    const { error } = await admin.from("payment_transactions").update({ reconcile_result: "abandoned" }).eq("id", txId);
    expect(error?.code).toBe("23514");
  });

  it("refuses a negative attempts count", async () => {
    const { error } = await admin.from("payment_transactions").update({ reconcile_attempts: -1 }).eq("id", txId);
    expect(error?.code).toBe("23514");
  });

  it("the owner of the payment cannot read any of the three", async () => {
    for (const col of ["reconcile_checked_at", "reconcile_result", "reconcile_attempts"] as const) {
      const { error } = await user.client.from("payment_transactions").select(col).eq("id", txId);
      expect(error?.code, `${col} readable by authenticated`).toBe("42501");
    }
  });

  it("the owner cannot write any of the three, and anon cannot read them", async () => {
    const { error } = await user.client.from("payment_transactions").update({ reconcile_result: "paystack_failed" }).eq("id", txId);
    expect(error).not.toBeNull();
    const { data: after } = await admin.from("payment_transactions").select("reconcile_result").eq("id", txId).single();
    expect(after!.reconcile_result).not.toBe("paystack_failed");
    const { error: anonErr } = await anon.from("payment_transactions").select("reconcile_result").eq("id", txId);
    expect(anonErr?.code).toBe("42501");
  });
});
