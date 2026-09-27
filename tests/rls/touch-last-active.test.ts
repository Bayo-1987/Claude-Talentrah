/**
 * send-467 — `touch_last_active()`'s own one-hour throttle (0197).
 *
 * The throttle lives entirely inside the RPC's own SQL (`WHERE last_active_at
 * IS NULL OR last_active_at < now() - interval '1 hour'`), not in the caller
 * (src/proxy.ts fires it unconditionally on every request with a session —
 * see that file's own header on `touchLastActive`). So this is what actually
 * proves the throttle exists: without it, this suite would prove nothing
 * more than "the column is writable via the RPC", which
 * tests/rls/column-privileges.test.ts's own POSITIVE CONTROL already covers.
 *
 * Simulating "an hour has passed" without a real wait: the admin (service
 * role) client backdates `last_active_at` directly, the same way
 * column-privileges.test.ts's own tests use `admin` to set up state a user
 * session could not — this is fixture setup, not a channel `authenticated`
 * has access to (confirmed by that file's own negative control).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createAuthedTestUser, deleteTestUsers, type TestUser, type DB } from "../support/auth";

let user: TestUser & { client: DB };

beforeAll(async () => {
  user = await createAuthedTestUser("touch-last-active");
});

afterAll(async () => {
  await deleteTestUsers([user.id]);
});

async function readLastActiveAt(): Promise<string | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("last_active_at")
    .eq("id", user.id)
    .single();
  if (error) throw error;
  return data.last_active_at;
}

describe("touch_last_active() throttling (0197)", () => {
  it("stamps last_active_at on the first call, from null", async () => {
    await admin.from("profiles").update({ last_active_at: null }).eq("id", user.id);

    const { error } = await user.client.rpc("touch_last_active");
    expect(error).toBeNull();

    const lastActiveAt = await readLastActiveAt();
    expect(lastActiveAt, "first call should stamp a null last_active_at").not.toBeNull();
  });

  it("does NOT move last_active_at on a second call inside the same hour", async () => {
    const { error: firstError } = await user.client.rpc("touch_last_active");
    expect(firstError).toBeNull();
    const first = await readLastActiveAt();
    expect(first).not.toBeNull();

    // Immediately again — well inside the one-hour throttle window.
    const { error: secondError } = await user.client.rpc("touch_last_active");
    expect(secondError).toBeNull();
    const second = await readLastActiveAt();

    expect(
      second,
      "a repeated call within the throttle window must not move the timestamp",
    ).toBe(first);
  });

  it("DOES move last_active_at once the throttle window has elapsed", async () => {
    // Simulate "an hour and one minute ago" — a real wait is not something a
    // unit test should do, and the admin client is the only path that can
    // write this column at all (the negative control in
    // column-privileges.test.ts proves authenticated cannot).
    const staleTimestamp = new Date(Date.now() - 61 * 60 * 1000).toISOString();
    await admin.from("profiles").update({ last_active_at: staleTimestamp }).eq("id", user.id);

    const { error } = await user.client.rpc("touch_last_active");
    expect(error).toBeNull();

    const after = await readLastActiveAt();
    expect(after, "a stale last_active_at should have been refreshed").not.toBe(staleTimestamp);
    expect(
      new Date(after!).getTime(),
      "the refreshed timestamp should be recent, not still the backdated one",
    ).toBeGreaterThan(Date.now() - 60_000);
  });

  it("is a no-op for a caller with no session (auth.uid() resolves to nothing)", async () => {
    // Sanity check on the design itself, not just the happy path: an anon
    // client has no EXECUTE grant on this function at all (0197), so this
    // must be refused outright rather than silently updating some row.
    const { createClient } = await import("@supabase/supabase-js");
    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { error } = await anonClient.rpc("touch_last_active");
    expect(error, "anon must not be able to call touch_last_active at all (0197)").not.toBeNull();
  });
});
