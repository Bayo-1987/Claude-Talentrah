/**
 * send-456 — regression coverage for the two migrations that lock down
 * `public.test_user_pool` (send-453's own test-harness table): 0188 revokes
 * every privilege from `authenticated`/`anon`, and 0191 additionally enables
 * row level security on it (Supabase's own advisor flagged the gap between
 * the two — see 0191's own header). Nothing in `tests/rls/` named this table
 * before this file; every other file in this directory covers a real
 * app-domain table.
 *
 * Two things this proves together, not just one: that the lockdown actually
 * holds for `anon` AND a real signed-in `authenticated` user (0188's own
 * revoke covers both roles), and that it did NOT also lock out the service
 * role — `claim_test_pool_user`/`release_test_pool_user` (0188) run as
 * `security definer`, but the harness's own direct `admin.from("test_user_pool")`
 * calls in tests/support/auth.ts (poolSize, deleteTestUsers' pooled-id lookup)
 * go through the service-role client directly, not through those functions.
 * A revoke that reached too far would silently break the pool itself.
 *
 * This test creates its own disposable auth user for the write assertions,
 * deliberately NOT through createTestUser/the pool's claim machinery — it
 * inserts/updates/deletes a test_user_pool row directly as the service role
 * to prove raw table privileges, and doing that through the real pool's own
 * claim/release functions would race against every other concurrently
 * running suite that also uses the pool.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";

const anon: DB = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let authedUser: Awaited<ReturnType<typeof createAuthedTestUser>>;

/** A real auth user, created directly (not via the pool), solely so the
 *  admin-privilege assertions below have a genuine row to insert/select/
 *  update without ever touching the shared pool's own claim/release state. */
let rawUserId: string;

beforeAll(async () => {
  authedUser = await createAuthedTestUser("pool-privileges-authed");

  const email = `pool-privileges-raw-${randomUUID()}@talentrah.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  rawUserId = data.user!.id;
});

afterAll(async () => {
  // Guarded, not assumed: a beforeAll failure (e.g. no live connection)
  // leaves these unset, and cleanup reaching for `.id` on undefined would
  // mask the real error with a second, confusing one.
  if (authedUser) await deleteTestUsers([authedUser.id]);
  // Deletes the test_user_pool row too (0188: user_id references auth.users
  // on delete cascade) — no separate cleanup of that row needed.
  if (rawUserId) await admin.auth.admin.deleteUser(rawUserId);
});

describe("test_user_pool: authenticated/anon have no privileges (0188), RLS is on (0191)", () => {
  it("anon cannot select from test_user_pool", async () => {
    const { error } = await anon.from("test_user_pool").select("user_id").limit(1);
    expect(error, "anon select must be refused, not silently empty").not.toBeNull();
  });

  it("anon cannot insert into test_user_pool", async () => {
    const { error } = await anon.from("test_user_pool").insert({ user_id: randomUUID() });
    expect(error).not.toBeNull();
  });

  it("anon cannot update test_user_pool", async () => {
    const { error } = await anon
      .from("test_user_pool")
      .update({ prefix: "anon-should-not-write-this" })
      .eq("user_id", rawUserId);
    expect(error).not.toBeNull();
  });

  it("a real signed-in (non-service-role) user cannot select from test_user_pool", async () => {
    const { error } = await authedUser.client.from("test_user_pool").select("user_id").limit(1);
    expect(error, "authenticated select must be refused, not silently empty").not.toBeNull();
  });

  it("a real signed-in (non-service-role) user cannot insert into test_user_pool", async () => {
    const { error } = await authedUser.client.from("test_user_pool").insert({ user_id: randomUUID() });
    expect(error).not.toBeNull();
  });

  it("a real signed-in (non-service-role) user cannot update test_user_pool", async () => {
    const { error } = await authedUser.client
      .from("test_user_pool")
      .update({ prefix: "authenticated-should-not-write-this" })
      .eq("user_id", rawUserId);
    expect(error).not.toBeNull();
  });

  it("the service role — what claim_test_pool_user/release_test_pool_user actually run as — can still select, insert and update", async () => {
    const { error: insertErr } = await admin
      .from("test_user_pool")
      .insert({ user_id: rawUserId, prefix: "pool-privileges-check" });
    expect(insertErr, "the lockdown must not also lock out the service role").toBeNull();

    const { data: selected, error: selectErr } = await admin
      .from("test_user_pool")
      .select("user_id, prefix")
      .eq("user_id", rawUserId)
      .single();
    expect(selectErr).toBeNull();
    expect(selected?.prefix).toBe("pool-privileges-check");

    const { error: updateErr } = await admin
      .from("test_user_pool")
      .update({ prefix: "pool-privileges-check-updated" })
      .eq("user_id", rawUserId);
    expect(updateErr).toBeNull();

    const { data: reread, error: rereadErr } = await admin
      .from("test_user_pool")
      .select("prefix")
      .eq("user_id", rawUserId)
      .single();
    expect(rereadErr).toBeNull();
    expect(reread?.prefix).toBe("pool-privileges-check-updated");
  });
});
