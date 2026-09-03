/**
 * hasActivePass / checkPassCoverage — the single source of truth every
 * pass-covered gate defers to. If this is wrong, every one of the six
 * covered actions is wrong the same way, so it gets tested directly rather
 * than only indirectly through each action.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { hasActivePass, checkPassCoverage, PASS_DAILY_ACTION_CAP } from "@/lib/passes/entitlement";

let userId: string;
let passId: string;

beforeAll(async () => {
  const user = await createTestUser("entitlement");
  userId = user.id;
  const { data: pass, error } = await admin.from("passes").select("id").limit(1).single();
  if (error || !pass) throw new Error("No passes seeded — run `npm run seed`.");
  passId = pass.id;
}, 60_000);

afterAll(async () => {
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

const createdPassRows: string[] = [];
const createdEventRows: string[] = [];

async function insertPass(expiresInMs: number, status: "active" | "canceled" = "active"): Promise<string> {
  const { data, error } = await admin
    .from("user_passes")
    .insert({
      user_id: userId,
      pass_id: passId,
      expires_at: new Date(Date.now() + expiresInMs).toISOString(),
      payment_method: "card",
      status,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture pass: ${error?.message}`);
  createdPassRows.push(data.id);
  return data.id;
}

async function insertCoveredEvent(ageMs: number): Promise<void> {
  const { data, error } = await admin
    .from("credit_gate_events")
    .insert({
      user_id: userId,
      reason: "bullet_rewrite",
      credits_required: 0,
      credits_available: 0,
      outcome: "covered_by_pass",
      created_at: new Date(Date.now() - ageMs).toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture gate event: ${error?.message}`);
  createdEventRows.push(data.id);
}

afterEach(async () => {
  if (createdPassRows.length) {
    await admin.from("user_passes").delete().in("id", createdPassRows);
    createdPassRows.length = 0;
  }
  if (createdEventRows.length) {
    await admin.from("credit_gate_events").delete().in("id", createdEventRows);
    createdEventRows.length = 0;
  }
});

describe("hasActivePass", () => {
  it("false with no pass at all", async () => {
    expect(await hasActivePass(userId)).toBe(false);
  });

  it("true with a pass that expires in the future", async () => {
    await insertPass(60 * 60 * 1000); // 1 hour from now
    expect(await hasActivePass(userId)).toBe(true);
  });

  it("false with a pass whose expires_at is already in the past, even though status is still 'active'", async () => {
    // The precise bug this function exists to close: nothing in this
    // codebase ever flips `status` away from 'active' on expiry, so a
    // check that only reads `status` would treat this as covered forever.
    await insertPass(-60 * 60 * 1000, "active"); // expired an hour ago, status untouched
    expect(
      await hasActivePass(userId),
      "STATUS-ONLY BUG: an expired pass with status still 'active' was treated as covering the user",
    ).toBe(false);
  });

  it("false when the pass was canceled, even if expires_at hasn't passed yet", async () => {
    await insertPass(60 * 60 * 1000, "canceled");
    expect(await hasActivePass(userId)).toBe(false);
  });

  it("true when the user holds more than one pass at once", async () => {
    // No unique constraint on user_passes.user_id, and fulfillPayment never
    // checks for an existing active pass before inserting a new one — this
    // must be an EXISTS check, not a single-row read that could pick the
    // wrong (e.g. expired) row.
    await insertPass(-1000, "active"); // expired
    await insertPass(60 * 60 * 1000, "active"); // active
    expect(await hasActivePass(userId)).toBe(true);
  });
});

describe("checkPassCoverage — combines hasActivePass with the daily fair-use cap", () => {
  it("no_active_pass when there is no pass", async () => {
    const result = await checkPassCoverage(userId);
    expect(result).toEqual({ covered: false, reason: "no_active_pass" });
  });

  it("covered when a pass is active and under the cap", async () => {
    await insertPass(60 * 60 * 1000);
    const result = await checkPassCoverage(userId);
    expect(result).toEqual({ covered: true });
  });

  it(`covered at exactly ${PASS_DAILY_ACTION_CAP - 1} prior covered actions today (one short of the cap)`, async () => {
    await insertPass(60 * 60 * 1000);
    for (let i = 0; i < PASS_DAILY_ACTION_CAP - 1; i++) await insertCoveredEvent(1000);
    expect(await checkPassCoverage(userId)).toEqual({ covered: true });
  });

  it(`daily_cap_reached at exactly ${PASS_DAILY_ACTION_CAP} prior covered actions today`, async () => {
    await insertPass(60 * 60 * 1000);
    for (let i = 0; i < PASS_DAILY_ACTION_CAP; i++) await insertCoveredEvent(1000);
    expect(await checkPassCoverage(userId)).toEqual({ covered: false, reason: "daily_cap_reached" });
  });

  it("does not count a covered action from more than 24 hours ago against today's cap", async () => {
    await insertPass(60 * 60 * 1000);
    for (let i = 0; i < PASS_DAILY_ACTION_CAP; i++) await insertCoveredEvent(25 * 60 * 60 * 1000);
    expect(
      await checkPassCoverage(userId),
      "a rolling 24h window must not count events from yesterday",
    ).toEqual({ covered: true });
  });

  it("no_active_pass, not daily_cap_reached, when the pass itself is expired regardless of event count", async () => {
    await insertPass(-1000); // expired
    for (let i = 0; i < PASS_DAILY_ACTION_CAP; i++) await insertCoveredEvent(1000);
    expect(await checkPassCoverage(userId)).toEqual({ covered: false, reason: "no_active_pass" });
  });
});

describe("the cap's exact boundary — not just 'below' and 'above' but the specific event that flips it", () => {
  it(`inserting exactly ${PASS_DAILY_ACTION_CAP} events (not ${PASS_DAILY_ACTION_CAP - 1}) is what flips the cap — proves the boundary is real, not off by one either direction`, async () => {
    await insertPass(60 * 60 * 1000);
    for (let i = 0; i < PASS_DAILY_ACTION_CAP - 1; i++) await insertCoveredEvent(1000);
    expect(
      (await checkPassCoverage(userId)).covered,
      `${PASS_DAILY_ACTION_CAP - 1} events must still be covered`,
    ).toBe(true);

    await insertCoveredEvent(1000); // the Nth event
    expect(
      (await checkPassCoverage(userId)).covered,
      `the ${PASS_DAILY_ACTION_CAP}th event must trip the cap`,
    ).toBe(false);
  });
});
