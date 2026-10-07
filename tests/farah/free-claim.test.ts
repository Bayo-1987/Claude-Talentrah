/**
 * The free-message claim (migration 0236) — DATABASE-BACKED, CI ONLY. These run against the ephemeral per-job database CI builds from supabase/migrations; they never run against a hosted project,
 * and they have not been seen run on the authoring machine (there is no database there). The concurrency assertion is shared with tests/farah/free-claim-race-detection.test.ts, which shows it can fail.
 *
 * ISOLATION. Each test makes its own account (createTestUser), so nothing here depends on, or disturbs, another account's claims or free messages. Accounts are removed at the end; their claims and
 * events go with them (both tables cascade from profiles).
 *
 *   (a) parallel claims hand out only the free slots;  (b) pending claims count, a release gives the slot back;  (c) expiry (time-controlled by writing the rows' own times);
 *   (d) commit makes exactly one event, once;  (e) commit and release belong to the account that claimed;  (f) the 30-day window;  (g) bad input;  (h) accounts are independent;
 *   (i) the app's own count agrees with what the claim wrote.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin as typedAdmin, createTestUser, deleteTestUsers } from "../support/auth";
import { farahChatFreeMessagesRemaining } from "@/lib/farah/chat-gate";
import { assertOnlyTheFreeSlotsAreGranted, type ClaimResult } from "./support/free-claim-assertions";

// The generated Database types do not know the new table or functions until they are regenerated after 0236, and CI typechecks before it tests.
const admin = typedAdmin as unknown as SupabaseClient;
const DAY = 86_400_000;
const users: string[] = [];

beforeAll(() => undefined);
afterAll(async () => {
  if (users.length) await deleteTestUsers(users);
}, 60_000);

async function newUser(prefix: string): Promise<string> {
  const id = (await createTestUser(prefix)).id;
  users.push(id);
  return id;
}
async function claimRaw(userId: unknown, allowance: unknown = 3, windowDays: unknown = 30, hold: unknown = 120) {
  return admin.rpc("claim_farah_free_message", { p_user_id: userId as string, p_allowance: allowance as number, p_window_days: windowDays as number, p_hold_seconds: hold as number });
}
async function claim(userId: string): Promise<ClaimResult> {
  const { data, error } = await claimRaw(userId);
  if (error) throw error;
  const r = (data as Array<{ ok: boolean; claim_id: string | null; used: number }>)[0];
  return { ok: r.ok, claimId: r.claim_id, used: r.used };
}
async function commit(claimId: unknown, userId: unknown, available: unknown = 5) {
  return admin.rpc("commit_farah_free_claim", { p_claim_id: claimId as string, p_user_id: userId as string, p_credits_available: available as number });
}
async function release(claimId: unknown, userId: unknown) {
  return admin.rpc("release_farah_free_claim", { p_claim_id: claimId as string, p_user_id: userId as string });
}
async function insertEvents(userId: string, n: number, ageMs = 1000) {
  const rows = Array.from({ length: n }, () => ({ user_id: userId, reason: "farah_chat_message", credits_required: 0, credits_available: 0, outcome: "covered_by_free_allowance", created_at: new Date(Date.now() - ageMs).toISOString() }));
  const { error } = await admin.from("credit_gate_events").insert(rows);
  if (error) throw new Error(`fixture: ${error.message}`);
}
async function eventCount(userId: string): Promise<number> {
  const { count, error } = await admin.from("credit_gate_events").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("reason", "farah_chat_message").eq("outcome", "covered_by_free_allowance");
  if (error) throw error;
  return count ?? 0;
}
async function pendingCount(userId: string): Promise<number> {
  const { count, error } = await admin.from("farah_free_claims").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (error) throw error;
  return count ?? 0;
}
/** A claim row written directly, with its own times: how a test makes a claim that is already expired, or one that expires at a chosen moment. */
async function insertClaim(userId: string, claimedAgoMs: number, expiresInMs: number): Promise<string> {
  const { data, error } = await admin.from("farah_free_claims").insert({ user_id: userId, claimed_at: new Date(Date.now() - claimedAgoMs).toISOString(), expires_at: new Date(Date.now() + expiresInMs).toISOString() }).select("id").single();
  if (error || !data) throw new Error(`fixture claim: ${error?.message}`);
  return (data as { id: string }).id;
}

describe("(a) parallel claims hand out only the free slots", () => {
  it("10 parallel claims with 2 of 3 used: exactly 1 succeeds; committed plus pending never goes above 3", async () => {
    const userId = await newUser("fclaima1");
    await insertEvents(userId, 2);
    await assertOnlyTheFreeSlotsAreGranted(claim, userId, 2);
    expect((await pendingCount(userId)) + (await eventCount(userId))).toBe(3);
  });

  it("10 parallel claims from a fresh account: exactly 3 succeed, each with its own id, and the answers' counts are 1, 2 and 3", async () => {
    const userId = await newUser("fclaima2");
    const results = await assertOnlyTheFreeSlotsAreGranted(claim, userId, 0);
    expect(results.filter((r) => r.ok).map((r) => r.used).sort()).toEqual([1, 2, 3]);
    expect(await pendingCount(userId)).toBe(3);
  });

  it("a refused claim writes nothing and reports how many are in use", async () => {
    const userId = await newUser("fclaima3");
    await insertEvents(userId, 3);
    expect(await claim(userId)).toEqual({ ok: false, claimId: null, used: 3 });
    expect(await pendingCount(userId)).toBe(0);
  });
});

describe("(b) pending claims count, and a release gives the slot back", () => {
  it("with 2 used and 1 pending, the next claim is refused; after the release it is granted; a second release says it was already gone", async () => {
    const userId = await newUser("fclaimb1");
    await insertEvents(userId, 2);
    const first = await claim(userId);
    expect(first.ok).toBe(true);
    expect((await claim(userId)).ok).toBe(false);
    expect((await release(first.claimId, userId)).data).toBe(true);
    expect((await claim(userId)).ok).toBe(true);
    expect((await release(first.claimId, userId)).data).toBe(false);
  });
});

describe("(c) a claim nobody settles expires (time-controlled by the rows' own times)", () => {
  it("an expired claim no longer counts and is swept by the next claim; an unexpired one still counts", async () => {
    const userId = await newUser("fclaimc1");
    await insertEvents(userId, 2);
    await insertClaim(userId, 300_000, -180_000); // claimed 300 s ago, expired 180 s ago
    expect((await claim(userId)).ok, "the expired claim does not hold the slot").toBe(true);
    expect(await pendingCount(userId), "the expired row was swept, leaving only the new claim").toBe(1);
    expect((await claim(userId)).ok, "the new claim holds the last slot").toBe(false);
  });

  it("a claim that is still inside its hold keeps the slot", async () => {
    const userId = await newUser("fclaimc2");
    await insertEvents(userId, 2);
    await insertClaim(userId, 100_000, 20_000); // 20 s left
    expect((await claim(userId)).ok).toBe(false);
  });

  it("the release failing is not a problem the database has to know about: a claim nobody released simply expires, after which the slot is granted again", async () => {
    const userId = await newUser("fclaimc3");
    await insertEvents(userId, 2);
    const held = await claim(userId); // the request whose release never reached the database
    expect(held.ok).toBe(true);
    expect((await claim(userId)).ok, "held while it lasts").toBe(false);
    await admin.from("farah_free_claims").delete().eq("id", held.claimId); // stands for the passing of the hold: the row is gone as the sweep would remove it
    await insertClaim(userId, 300_000, -180_000);
    expect((await claim(userId)).ok, "after expiry it is granted again").toBe(true);
  });
});

describe("(d) commit makes exactly one free-allowance event, once", () => {
  it("claim, commit: one event with the balance as of the check; the claim is gone; a second commit says false and adds nothing", async () => {
    const userId = await newUser("fclaimd1");
    await insertEvents(userId, 2);
    const c = await claim(userId);
    expect((await commit(c.claimId, userId, 7)).data).toBe(true);
    const { data } = await admin.from("credit_gate_events").select("credits_required, credits_available, reason, outcome").eq("user_id", userId).order("created_at", { ascending: false }).limit(1);
    expect(data).toEqual([{ credits_required: 0, credits_available: 7, reason: "farah_chat_message", outcome: "covered_by_free_allowance" }]);
    expect(await eventCount(userId)).toBe(3);
    expect(await pendingCount(userId)).toBe(0);
    expect((await commit(c.claimId, userId, 7)).data).toBe(false);
    expect(await eventCount(userId)).toBe(3);
  });

  it("committing a claim that had already expired says false, records nothing and removes the claim (the slot may be someone else's)", async () => {
    const userId = await newUser("fclaimd2");
    const id = await insertClaim(userId, 300_000, -180_000);
    expect((await commit(id, userId)).data).toBe(false);
    expect(await eventCount(userId)).toBe(0);
    expect(await pendingCount(userId)).toBe(0);
  });

  it("claim, commit, claim, commit, claim, commit, then a 4th claim: refused (the count is 3 committed)", async () => {
    const userId = await newUser("fclaimd3");
    for (let i = 0; i < 3; i += 1) {
      const c = await claim(userId);
      expect(c.ok, `claim ${i + 1}`).toBe(true);
      expect((await commit(c.claimId, userId)).data).toBe(true);
    }
    expect((await claim(userId)).ok).toBe(false);
    expect(await eventCount(userId)).toBe(3);
  });
});

describe("(e) commit and release belong to the account that claimed", () => {
  it("another account's id changes nothing: commit and release both say false, and the claim is still there", async () => {
    const owner = await newUser("fclaime1");
    const other = await newUser("fclaime2");
    const c = await claim(owner);
    expect((await commit(c.claimId, other)).data).toBe(false);
    expect((await release(c.claimId, other)).data).toBe(false);
    expect(await pendingCount(owner)).toBe(1);
    expect(await eventCount(other)).toBe(0);
  });
});

describe("(f) the 30-day window", () => {
  it("a free message 29 days 23 hours old still counts; one 30 days 1 hour old does not", async () => {
    const userId = await newUser("fclaimf1");
    await insertEvents(userId, 2, 30 * DAY + 3_600_000); // outside
    await insertEvents(userId, 1, 29 * DAY + 23 * 3_600_000); // inside
    expect(await claim(userId)).toMatchObject({ ok: true, used: 2 });
  });
});

describe("(g) bad input is refused with SQLSTATE 22023 and changes nothing", () => {
  it("a missing account, and an allowance, window or hold outside the allowed range; and missing ids on commit and release", async () => {
    const userId = await newUser("fclaimg1");
    const bad: Array<[unknown, unknown, unknown, unknown]> = [
      [null, 3, 30, 120],
      [userId, 0, 30, 120],
      [userId, 11, 30, 120],
      [userId, null, 30, 120],
      [userId, 3, 0, 120],
      [userId, 3, 401, 120],
      [userId, 3, null, 120],
      [userId, 3, 30, 9],
      [userId, 3, 30, 601],
      [userId, 3, 30, null],
    ];
    for (const [u, a, w, h] of bad) expect((await claimRaw(u, a, w, h)).error?.code, JSON.stringify([a, w, h])).toBe("22023");
    expect((await commit(null, userId)).error?.code).toBe("22023");
    expect((await commit("00000000-0000-0000-0000-000000000000", null)).error?.code).toBe("22023");
    expect((await commit("00000000-0000-0000-0000-000000000000", userId, -1)).error?.code).toBe("22023");
    expect((await release(null, userId)).error?.code).toBe("22023");
    expect(await pendingCount(userId)).toBe(0);
    expect(await eventCount(userId)).toBe(0);
  });
});

describe("(h) accounts are independent", () => {
  it("two accounts claiming at once each get their own slots", async () => {
    const a = await newUser("fclaimh1");
    const b = await newUser("fclaimh2");
    const [ra, rb] = await Promise.all([Promise.all(Array.from({ length: 6 }, () => claim(a))), Promise.all(Array.from({ length: 6 }, () => claim(b)))]);
    expect(ra.filter((r) => r.ok)).toHaveLength(3);
    expect(rb.filter((r) => r.ok)).toHaveLength(3);
  });
});

describe("(i) the app's own count agrees with what the claim wrote", () => {
  it("after three claim-and-commit cycles, farahChatFreeMessagesRemaining says 0, and after two it says 1", async () => {
    const userId = await newUser("fclaimi1");
    for (let i = 0; i < 2; i += 1) {
      const c = await claim(userId);
      await commit(c.claimId, userId);
    }
    expect(await farahChatFreeMessagesRemaining(userId)).toBe(1);
    const c = await claim(userId);
    await commit(c.claimId, userId);
    expect(await farahChatFreeMessagesRemaining(userId)).toBe(0);
  });
});
