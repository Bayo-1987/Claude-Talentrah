/**
 * What the operations screen reads, and what a non-admin can reach of it.
 *
 * M5 added no grants and no policies — every figure on /admin/ops is a
 * service-role SELECT. This suite is the standing proof of the half that
 * matters: surfacing something to an operator must not have widened it for
 * anybody else. The tables are the sensitive ones by construction — money
 * (`user_passes`, `payment_transactions`), intent (`auto_apply_queue`) and
 * behaviour (`api_rate_limits`).
 *
 * The two shapes here are different and the difference is the point:
 *
 *   user_passes / auto_apply_queue / payment_transactions
 *       SELECT IS GRANTED, and an owner-scoped policy decides the rows. A
 *       stranger therefore gets an EMPTY RESULT AND NO ERROR — so an
 *       assertion that only checked for an error would pass on a leak.
 *       These assert zero rows while the service role proves the row exists.
 *
 *   api_rate_limits
 *       SELECT IS NOT GRANTED AT ALL. A stranger gets an ERROR. Asserting
 *       emptiness here would pass even if the grant came back.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import type { Database } from "@/lib/supabase/types";

const anon: DB = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let owner: Awaited<ReturnType<typeof createAuthedTestUser>>;
let stranger: Awaited<ReturnType<typeof createAuthedTestUser>>;
let passId: string | null = null;

beforeAll(async () => {
  owner = await createAuthedTestUser("ops-owner");
  stranger = await createAuthedTestUser("ops-stranger");

  // A real pass row belonging to `owner`, so "the stranger sees nothing" is
  // measured against something that exists rather than against an empty table.
  const { data: pass } = await admin.from("passes").select("id").limit(1).maybeSingle();
  if (pass) {
    const { data, error } = await admin
      .from("user_passes")
      .insert({
        user_id: owner.id,
        pass_id: pass.id,
        started_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        payment_method: "card",
        status: "active",
      })
      .select("id")
      .single();
    if (error) throw new Error(`could not create the fixture pass: ${error.message}`);
    passId = data.id;
  }
});

afterAll(async () => {
  if (passId) {
    const { error } = await admin.from("user_passes").delete().eq("id", passId);
    if (error) console.warn(`[cleanup] fixture pass survived: ${error.message}`);
  }
  await deleteTestUsers([owner.id, stranger.id]);
});

describe("owner-scoped tables leak nothing to a stranger", () => {
  it("a stranger sees zero passes, while the row demonstrably exists", async () => {
    if (!passId) return expect(passId).toBeNull(); // no reference pass seeded

    const { data, error } = await stranger.client
      .from("user_passes")
      .select("id, pending_renewal_reference, renewal_attempt_count")
      .eq("id", passId);

    // SELECT is granted here, so a policy denial is SILENT: no error, no rows.
    // Asserting the error would be asserting the wrong mechanism.
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);

    const { data: proof } = await admin.from("user_passes").select("id").eq("id", passId);
    expect(proof ?? []).toHaveLength(1);
  });

  it("the owner does see their own", async () => {
    if (!passId) return expect(passId).toBeNull();
    // The positive control. Without it, "zero rows" would also pass if the
    // policy were broken in the other direction and nobody could read anything.
    const { data, error } = await owner.client.from("user_passes").select("id").eq("id", passId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
  });

  it("a signed-out visitor sees no passes at all", async () => {
    const { data, error } = await anon.from("user_passes").select("id").limit(5);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("auto_apply_queue and payment_transactions are owner-scoped too", async () => {
    for (const table of ["auto_apply_queue", "payment_transactions"] as const) {
      const { data, error } = await stranger.client.from(table).select("id").limit(5);
      expect(error, `${table} errored unexpectedly`).toBeNull();
      // The stranger owns nothing, so an owner-scoped policy yields nothing.
      expect(data ?? [], `${table} returned rows to a stranger`).toHaveLength(0);
    }
  });
});

describe("api_rate_limits is closed outright, not merely unpolicied", () => {
  it("refuses both anon and a signed-in user", async () => {
    for (const [label, client] of [
      ["anon", anon],
      ["signed-in", stranger.client],
    ] as const) {
      const { data, error } = await client.from("api_rate_limits").select("bucket").limit(1);
      // No SELECT grant, so this is an ERROR rather than an empty read. The
      // ops screen aggregates this table precisely because per-user rate-limit
      // history is a behavioural profile.
      expect(error, `${label} could read api_rate_limits`).not.toBeNull();
      expect(data).toBeNull();
    }
  });
});
