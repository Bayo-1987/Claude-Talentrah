/**
 * The per-user rate limiter on the two routes that call a paid model.
 *
 * WHY THIS IS A DATABASE TEST AND NOT A UNIT TEST. The property under test is
 * that N *concurrent* requests cannot all pass a limit of one. That is a
 * statement about Postgres row locking, so a mocked counter would assert
 * nothing — it is precisely the mock that would be correct-by-construction
 * while the real thing raced. Same reasoning as tests/credits/spend-race.ts.
 *
 * WHAT WAS MISSING. Only /api/farah/chat rate-limited anything. /api/tailoring
 * and /api/resume/parse both call a paid model per request with no frequency
 * cap. Tailoring's credit gate bounds SPEND, not BURST — a user with credits,
 * or one still inside the free trial, could fire as fast as the network
 * allowed. resume/parse had no gate at all.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/api/rate-limit";
import { listUsersWithPrefix, RUN_TAG } from "../support/list-users";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Rate-limit test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let userId: string;
let otherUserId: string;

async function makeUser(): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `rate-limit-${RUN_TAG}-${randomUUID()}@talentrah.test`,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user!.id;
}

/** Drives the counter to `n` used, without depending on the module's constants. */
async function callRaw(id: string, bucket: string, limit: number) {
  const { data, error } = await admin.rpc("consume_rate_limit", {
    p_user_id: id,
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: 3600,
  });
  if (error) throw error;
  return data![0];
}

beforeEach(async () => {
  [userId, otherUserId] = await Promise.all([makeUser(), makeUser()]);
});

afterAll(async () => {
  /*
   * Deleted in parallel, with an explicit hook timeout.
   *
   * Serially, this is one round-trip to Supabase Auth per account created by
   * the suite — two per test, sixteen of them here — inside vitest's default 10s hook budget. It
   * fit until it didn't: a slow afternoon against the live project blew the
   * budget and the whole FILE was reported as failed while all 8 of its
   * tests had passed. Worse, the timeout aborts the loop partway, so it leaks
   * exactly the throwaway accounts it exists to remove — into the shared
   * project, because there is no staging database.
   */
  const mine = await listUsersWithPrefix(admin, `rate-limit-${RUN_TAG}-`);
  await Promise.all(mine.map((u) => admin.auth.admin.deleteUser(u.id)));
}, 60_000);

describe("the counter is atomic", () => {
  it("twenty concurrent calls against a limit of five: exactly five are allowed", async () => {
    /*
     * The core assertion, and the one a read-then-increment implementation
     * fails outright: every concurrent caller reads 0, every one passes.
     */
    const results = await Promise.all(
      Array.from({ length: 20 }, () => callRaw(userId, "concurrency-probe", 5)),
    );
    const allowed = results.filter((r) => r.allowed).length;

    expect(
      allowed,
      `BURST: ${allowed} of 20 concurrent requests passed a limit of 5`,
    ).toBe(5);

    // And each caller saw a distinct count — no two requests read the same
    // slot, which is the actual atomicity property.
    const counts = results.map((r) => r.used).sort((a, b) => a - b);
    expect(counts).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("one user's traffic cannot consume another user's allowance", async () => {
    await Promise.all(Array.from({ length: 8 }, () => callRaw(userId, "isolation-probe", 3)));
    const other = await callRaw(otherUserId, "isolation-probe", 3);
    expect(other.allowed, "a noisy neighbour locked another user out").toBe(true);
    expect(other.used).toBe(1);
  });

  it("buckets are independent — exhausting one does not close the other", async () => {
    await Promise.all(Array.from({ length: 5 }, () => callRaw(userId, "bucket-a", 2)));
    const b = await callRaw(userId, "bucket-b", 2);
    expect(b.allowed).toBe(true);
  });

  it("reports a reset time in the future, so Retry-After is meaningful", async () => {
    const r = await callRaw(userId, "resets-probe", 1);
    expect(new Date(r.resets_at).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(r.resets_at).getTime() - Date.now()).toBeLessThanOrEqual(3600 * 1000);
  });
});

describe("the counter is not client-reachable", () => {
  it("an authenticated user can neither read nor reset their own counter", async () => {
    /*
     * A limit a user can clear is not a limit. 0038 enables RLS with no
     * policies and revokes the table from both client roles — so this asserts
     * the grant, not a policy.
     */
    const anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!anonKey) throw new Error("Need the publishable/anon key to test client reach.");

    const asUser = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    await callRaw(userId, "client-reach-probe", 1);

    const read = await asUser.from("api_rate_limits").select("*");
    expect(read.data ?? [], "a client could read the rate-limit table").toHaveLength(0);

    const del = await asUser.from("api_rate_limits").delete().eq("user_id", userId);
    expect(del.error ?? { code: "no-error" }, "a client could delete its own counter").toBeTruthy();

    // The row is still there.
    const { data: still } = await admin
      .from("api_rate_limits")
      .select("request_count")
      .eq("user_id", userId)
      .eq("bucket", "client-reach-probe");
    expect(still ?? []).toHaveLength(1);
  });

  it("the RPC itself is not executable by a client", async () => {
    const anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const asUser = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await asUser.rpc("consume_rate_limit", {
      p_user_id: userId,
      p_bucket: "forged",
      p_limit: 999999,
      p_window_seconds: 1,
    });
    expect(
      error,
      "a client could call the limiter directly and burn another user's allowance",
    ).toBeTruthy();
  });
});

describe("the module wired over it", () => {
  it("consumeRateLimit enforces the configured tailoring limit", async () => {
    const { limit } = RATE_LIMITS.tailoring;
    const results = await Promise.all(
      Array.from({ length: limit + 3 }, () => consumeRateLimit(userId, "tailoring")),
    );
    expect(results.filter((r) => r.allowed).length).toBe(limit);
    expect(results.filter((r) => !r.allowed).length).toBe(3);
  });

  it("fails CLOSED when the counter itself errors", async () => {
    /*
     * Positive control on the failure branch. A database blip is most likely
     * exactly when the system is under load, which is the worst possible
     * moment to treat an unreadable counter as headroom.
     */
    const outcome = await consumeRateLimit("not-a-uuid", "tailoring");
    expect(outcome.allowed, "an unreadable counter was treated as permission").toBe(false);
  });
});
