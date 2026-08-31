import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "../../src/lib/supabase/types";

/**
 * 0082's lease, proved to actually exclude.
 *
 * A mutex nobody tested is a mutex that might be a no-op, and a no-op here is
 * invisible: every suite passes, exactly as they mostly do today, and the
 * intermittent failure it was built to remove just keeps happening.
 *
 * TWO SEPARATE CLIENTS, for the same reason admin-permissions uses two: on one
 * client the driver keeps both calls on a single connection and the second
 * cannot race the first.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const mk = () =>
  createClient<Database>(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const a = mk();
const b = mk();

const LOCK = `ci-lock-selftest-${randomUUID().slice(0, 8)}`;

// Typed loosely on purpose: src/lib/supabase/types.ts is generated from the
// database, and regenerating it here would drag in the types of every
// migration applied to that project but not yet merged. The shape asserted
// below is the contract; the cast is only about typegen ordering.
type LockRpc = {
  rpc(fn: "ci_test_lock_acquire", args: { p_name: string; p_holder: string; p_ttl_seconds?: number }):
    Promise<{ data: boolean | null; error: { message: string } | null }>;
  rpc(fn: "ci_test_lock_release", args: { p_name: string; p_holder: string }):
    Promise<{ data: boolean | null; error: { message: string } | null }>;
};
const A = a as unknown as LockRpc;
const B = b as unknown as LockRpc;

const holderA = randomUUID();
const holderB = randomUUID();

afterAll(async () => {
  await A.rpc("ci_test_lock_release", { p_name: LOCK, p_holder: holderA });
  await B.rpc("ci_test_lock_release", { p_name: LOCK, p_holder: holderB });
  // The stale-lease case deliberately abandons a lease held by a "dead"
  // holder, so no release call can clear it — delete by name instead, or the
  // row lingers in a shared project as confusing debris.
  // `as never`: the table is new in 0082 and types.ts is generated from a
  // project that also carries unmerged migrations, so it is not regenerated here.
  const { error } = await a.from("ci_test_locks" as never).delete().like("name", `${LOCK}%`);
  if (error) console.error("[ci-lock cleanup]", error.message);
});

describe("0082: the lease actually excludes", () => {
  it("the second holder is refused while the first holds it", async () => {
    const first = await A.rpc("ci_test_lock_acquire", { p_name: LOCK, p_holder: holderA, p_ttl_seconds: 300 });
    expect(first.error, first.error?.message).toBeNull();
    expect(first.data, "the first acquire must succeed").toBe(true);

    const second = await B.rpc("ci_test_lock_acquire", { p_name: LOCK, p_holder: holderB, p_ttl_seconds: 300 });
    expect(second.error, second.error?.message).toBeNull();
    expect(second.data, "LOCK IS A NO-OP: two holders at once").toBe(false);
  });

  it("the holder can renew its own lease without losing it", async () => {
    const renew = await A.rpc("ci_test_lock_acquire", { p_name: LOCK, p_holder: holderA, p_ttl_seconds: 300 });
    expect(renew.data, "a holder must be able to extend its own lease").toBe(true);
    // …and renewing did not quietly hand it to anyone else.
    const other = await B.rpc("ci_test_lock_acquire", { p_name: LOCK, p_holder: holderB, p_ttl_seconds: 300 });
    expect(other.data).toBe(false);
  });

  it("a release by a NON-holder does nothing — it cannot free someone else's lock", async () => {
    const stolenRelease = await B.rpc("ci_test_lock_release", { p_name: LOCK, p_holder: holderB });
    expect(stolenRelease.data, "releasing a lease you do not hold must be a no-op").toBe(false);
    // Still locked against B.
    const still = await B.rpc("ci_test_lock_acquire", { p_name: LOCK, p_holder: holderB, p_ttl_seconds: 300 });
    expect(still.data, "a non-holder's release must not have freed the lock").toBe(false);
  });

  it("the holder's release hands it over", async () => {
    const released = await A.rpc("ci_test_lock_release", { p_name: LOCK, p_holder: holderA });
    expect(released.data).toBe(true);
    const next = await B.rpc("ci_test_lock_acquire", { p_name: LOCK, p_holder: holderB, p_ttl_seconds: 300 });
    expect(next.data, "after release the next waiter must get it").toBe(true);
    await B.rpc("ci_test_lock_release", { p_name: LOCK, p_holder: holderB });
  });

  it("a STALE lease is stealable, so a died-holding run cannot wedge CI forever", async () => {
    const short = `${LOCK}-stale`;
    const dead = randomUUID();
    const live = randomUUID();
    // One second, then simulate the holder dying by simply never releasing.
    expect((await A.rpc("ci_test_lock_acquire", { p_name: short, p_holder: dead, p_ttl_seconds: 1 })).data).toBe(true);
    // Immediately, it is still held.
    expect((await B.rpc("ci_test_lock_acquire", { p_name: short, p_holder: live, p_ttl_seconds: 1 })).data).toBe(false);
    await new Promise((r) => setTimeout(r, 1500));
    expect(
      (await B.rpc("ci_test_lock_acquire", { p_name: short, p_holder: live, p_ttl_seconds: 60 })).data,
      "an expired lease must be stealable",
    ).toBe(true);
    await B.rpc("ci_test_lock_release", { p_name: short, p_holder: live });
  });

  it("no client role can reach the lock table or its functions", async () => {
    const anon = createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { data, error } = await anon.from("ci_test_locks" as never).select("*");
    expect(error, "LEAK: anon read ci_test_locks without error").not.toBeNull();
    expect(data ?? [], "LEAK: anon got rows from ci_test_locks").toHaveLength(0);

    const rpc = await (anon as unknown as LockRpc).rpc("ci_test_lock_acquire", {
      p_name: LOCK, p_holder: randomUUID(),
    });
    expect(rpc.error, "LEAK: anon could call ci_test_lock_acquire").not.toBeNull();
  });
});
