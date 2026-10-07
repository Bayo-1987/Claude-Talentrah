/**
 * The test-user pool's reset also clears pending free-message claims (migration 0236). A pooled test identity is REUSED: a claim left on it by a test that never settled it would count against the next claimer's
 * allowance for up to 120 seconds. This is the real function on the real database after the migration: give a pooled user (and another one) a pending claim, reset the first, and the first has no
 * farah_free_claims row while the other's claim is untouched. Database-backed: it runs in CI only, and its first run is CI's. Without the row 0236 adds to the reset's table list, the first expectation fails
 * (proved against the same function without that row in the local stand-in database, scratchpad proof 0236-reset-local-proof).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";

const db = admin as unknown as SupabaseClient;
let a: string;
let b: string;

beforeAll(async () => {
  a = (await createTestUser("claimreset-a")).id;
  b = (await createTestUser("claimreset-b")).id;
}, 60_000);
afterAll(async () => {
  for (const id of [a, b]) if (id) await db.from("farah_free_claims").delete().eq("user_id", id);
  await deleteTestUsers([a, b].filter(Boolean));
}, 60_000);

const claimsOf = async (id: string): Promise<number> => {
  const { count, error } = await db.from("farah_free_claims").select("id", { count: "exact", head: true }).eq("user_id", id);
  if (error) throw new Error(`read claims: ${error.message}`);
  return count ?? 0;
};

describe("reset_test_pool_user and farah_free_claims", () => {
  it("after a reset, the identity has no pending claim; another identity's claim is untouched", async () => {
    const soon = new Date(Date.now() + 120_000).toISOString();
    const ins = await db.from("farah_free_claims").insert([
      { user_id: a, expires_at: soon },
      { user_id: a, expires_at: soon },
      { user_id: b, expires_at: soon },
    ]);
    expect(ins.error, "fixture claims").toBeNull();
    expect(await claimsOf(a)).toBe(2);
    expect(await claimsOf(b)).toBe(1);

    const reset = await db.rpc("reset_test_pool_user", { p_user_id: a, p_new_email: `claimreset-${a}@example.test` });
    expect(reset.error, "the reset itself").toBeNull();

    expect(await claimsOf(a), "the reset identity keeps no claim").toBe(0);
    expect(await claimsOf(b), "another identity's claim is not touched").toBe(1);
  });
});
