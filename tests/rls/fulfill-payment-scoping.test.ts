/**
 * Service-role scoping regression test for fulfillPayment.
 *
 * The RLS suite (tests/rls/cross-user.test.ts) proves the database boundary
 * holds for the authenticated client. It cannot see this class of bug at
 * all: fulfillPayment runs on the service-role client, which bypasses RLS by
 * design, so the only thing deciding which row is acted on is the code's own
 * scoping — and on the callback path the reference arrives as a URL query
 * parameter, i.e. client-supplied input.
 *
 * The bug this guards: the callback page called `await requireUser()` and
 * discarded the result, never comparing the session user to the
 * transaction's owner. Any signed-in user holding another user's reference
 * could act on their transaction. The damaging case isn't credit theft —
 * credits go to transaction.user_id either way — it's that a failed Paystack
 * verify writes status "failed" permanently, so a stranger could burn
 * someone's pending transaction into a terminal state and the owner's later
 * real payment would land on a non-pending row and grant nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { fulfillPayment } from "@/lib/billing/fulfill";
import type { Database } from "@/lib/supabase/types";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`fulfillPayment scoping test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let ownerId: string;
let strangerId: string;
let reference: string;
let transactionId: string;

async function makeUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `fulfill-${label}-${randomUUID()}@talentrah.test`,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user.id;
}

beforeAll(async () => {
  ownerId = await makeUser("owner");
  strangerId = await makeUser("stranger");

  const { data: pack } = await admin.from("credit_packs").select("id, price_ngn").limit(1).single();
  reference = `credit_pack_${randomUUID()}`;

  const { data: txn, error } = await admin
    .from("payment_transactions")
    .insert({
      user_id: ownerId,
      rail: "paystack",
      amount: pack!.price_ngn,
      currency: "NGN",
      product_type: "credit_pack",
      product_id: pack!.id,
      paystack_reference: reference,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) throw error;
  transactionId = txn!.id;
}, 60_000);

afterAll(async () => {
  for (const id of [ownerId, strangerId]) {
    if (id) await admin.auth.admin.deleteUser(id);
  }
}, 60_000);

describe("fulfillPayment is scoped to the session user", () => {
  it("a stranger passing the owner's reference gets not_found", async () => {
    const result = await fulfillPayment(reference, strangerId);
    expect(
      result.status,
      "LEAK: a signed-in user acted on another user's payment transaction",
    ).toBe("not_found");
  });

  it("and the owner's transaction is left completely untouched", async () => {
    // The real damage would be a permanent status change, so assert on the
    // row itself rather than on the returned status alone.
    const { data } = await admin
      .from("payment_transactions")
      .select("status, user_id")
      .eq("id", transactionId)
      .single();
    expect(data?.status, "LEAK: a stranger's call mutated the owner's transaction").toBe("pending");
    expect(data?.user_id).toBe(ownerId);
  });

  it("a stranger cannot use it to probe whether a reference exists", async () => {
    // A reference that definitely doesn't exist must be indistinguishable
    // from one owned by someone else, or this becomes an oracle.
    const absent = await fulfillPayment(`credit_pack_${randomUUID()}`, strangerId);
    const someoneElses = await fulfillPayment(reference, strangerId);
    expect(absent.status).toBe("not_found");
    expect(someoneElses.status).toBe(absent.status);
  });

  it("positive control: the owner gets PAST the ownership gate", async () => {
    // Without a positive control, "stranger gets not_found" would also pass
    // if the gate rejected everyone. The owner's call should reach the
    // Paystack verify step, which throws on this fabricated reference —
    // reaching it at all is the proof.
    await expect(fulfillPayment(reference, ownerId)).rejects.toThrow();
  });

  it("positive control: the webhook path (no expectedUserId) still gets past the gate", async () => {
    await expect(fulfillPayment(reference)).rejects.toThrow();
  });
});
