/**
 * Farah chat's entitlement gate (0123) — 3 free messages/30-day rolling
 * window, then checkPassCoverage, then spendCredits. The chain is only as
 * real as its weakest link, so each link is sabotage-tested directly against
 * the real database rather than trusted from reading the code.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import {
  checkFarahChatAllowance,
  commitFarahChatAllowance,
  farahChatFreeMessagesRemaining,
  FARAH_CHAT_FREE_ALLOWANCE,
  InsufficientCreditsError,
} from "@/lib/farah/chat-gate";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { PASS_DAILY_ACTION_CAP } from "@/lib/passes/entitlement";

const DAY_MS = 24 * 60 * 60 * 1000;

let userId: string;
let passId: string;

beforeAll(async () => {
  const user = await createTestUser("farahgate");
  userId = user.id;
  const { data: pass, error } = await admin.from("passes").select("id").limit(1).single();
  if (error || !pass) throw new Error("No passes seeded — run `npm run seed`.");
  passId = pass.id;
}, 60_000);

afterAll(async () => {
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

const createdPassRows: string[] = [];

async function insertPass(expiresInMs: number, status: "active" | "canceled" = "active"): Promise<void> {
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
}

/** A raw fixture event, bypassing checkFarahChatAllowance/commit entirely — for controlling exactly what the rolling-window query sees. */
async function insertGateEvent(outcome: "covered_by_free_allowance" | "covered_by_pass", ageMs: number): Promise<void> {
  const { error } = await admin.from("credit_gate_events").insert({
    user_id: userId,
    reason: "farah_chat_message",
    credits_required: 0,
    credits_available: 0,
    outcome,
    created_at: new Date(Date.now() - ageMs).toISOString(),
  });
  if (error) throw new Error(`fixture gate event: ${error.message}`);
}

async function setBalance(amount: number): Promise<void> {
  const { error } = await admin.from("profiles").update({ credits_balance: amount }).eq("id", userId);
  if (error) throw new Error(`fixture balance: ${error.message}`);
}

/** The real end-to-end path a successful message takes: check, then commit — exactly what the route does after askFarahChat succeeds. */
async function sendOneMessage() {
  const allowance = await checkFarahChatAllowance(userId);
  await commitFarahChatAllowance(userId, allowance);
  return allowance;
}

afterEach(async () => {
  if (createdPassRows.length) {
    await admin.from("user_passes").delete().in("id", createdPassRows);
    createdPassRows.length = 0;
  }
  /*
   * ALL of this user's gate events, not just ones this file explicitly
   * tracked — sendOneMessage() below calls the REAL checkFarahChatAllowance/
   * commitFarahChatAllowance path, which writes real, untracked
   * credit_gate_events rows (and, on the credit path, a real credit_ledger
   * row) exactly the way the route itself does. This test user exists for
   * nothing else, so sweeping everything tied to it between tests is
   * simpler and safer than tracking every insertion path individually —
   * the alternative is exactly the leak that made this necessary in the
   * first place: an earlier test's real free-allowance use silently
   * surviving into a later test's "how many are left" assertion.
   */
  await admin.from("credit_gate_events").delete().eq("user_id", userId);
  await admin.from("credit_ledger").delete().eq("user_id", userId);
  await setBalance(0);
});

describe("the free allowance, exactly 3 in a rolling 30-day window", () => {
  it(
    "SABOTAGE-PROOF TARGET: the 1st, 2nd and 3rd messages are all free — the 3rd is correctly the last free one",
    async () => {
      for (let i = 1; i <= FARAH_CHAT_FREE_ALLOWANCE; i++) {
        const allowance = await sendOneMessage();
        expect(allowance.isFreeAllowance, `message ${i} should be free`).toBe(true);
        expect(allowance.isPassCovered).toBe(false);
        expect(allowance.creditsSpent).toBe(0);
      }
      // Exactly 0 left after the 3rd, not still available.
      expect(await farahChatFreeMessagesRemaining(userId)).toBe(0);
    },
  );

  it("SABOTAGE-PROOF TARGET: the 4th message, with no Pass and no credits, is correctly blocked", async () => {
    for (let i = 0; i < FARAH_CHAT_FREE_ALLOWANCE; i++) await insertGateEvent("covered_by_free_allowance", 1000);
    await setBalance(0);
    await expect(checkFarahChatAllowance(userId)).rejects.toBeInstanceOf(InsufficientCreditsError);
  });

  it("reports the correct remaining count at every step, not just 0/exhausted", async () => {
    expect(await farahChatFreeMessagesRemaining(userId)).toBe(3);
    await insertGateEvent("covered_by_free_allowance", 1000);
    expect(await farahChatFreeMessagesRemaining(userId)).toBe(2);
    await insertGateEvent("covered_by_free_allowance", 1000);
    expect(await farahChatFreeMessagesRemaining(userId)).toBe(1);
    await insertGateEvent("covered_by_free_allowance", 1000);
    expect(await farahChatFreeMessagesRemaining(userId)).toBe(0);
  });

  it(
    "SABOTAGE-PROOF TARGET: the window is genuinely ROLLING, not calendar-bucketed — an event " +
      "31 real days ago, in the SAME calendar month as `now`, does not count",
    async () => {
      // Fixed reference instant so this does not depend on which real day it
      // happens to run. 31 days before it is still well inside the same
      // month (the 3rd), which is exactly the case a naive
      // date_trunc('month', created_at) = date_trunc('month', now())
      // implementation would get WRONG in the other direction — counting an
      // event from days ago in the SAME month while a rolling window has
      // already dropped it. Proven from both sides by the next test too.
      const now = new Date("2026-09-03T12:00:00Z");
      await insertGateEvent("covered_by_free_allowance", 31 * DAY_MS);
      const allowance = await checkFarahChatAllowance(userId, now);
      expect(allowance.isFreeAllowance, "an event 31 days old must have rolled off").toBe(true);
    },
  );

  it(
    "SABOTAGE-PROOF TARGET: an event 29 real days ago, in a DIFFERENT calendar month than `now`, " +
      "still counts — proves this is NOT date_trunc('month', ...)",
    async () => {
      // now = Sept 3rd; 29 days before it is Aug 5th — a different calendar
      // month. A naive date_trunc('month') implementation would NOT count
      // this event (wrong month) and incorrectly grant 3 fresh free
      // messages in September despite one being sent 29 real days ago. The
      // real rolling-30-day window must still count it.
      const now = new Date("2026-09-03T12:00:00Z");
      for (let i = 0; i < FARAH_CHAT_FREE_ALLOWANCE; i++) {
        await insertGateEvent("covered_by_free_allowance", 29 * DAY_MS);
      }
      await setBalance(0);
      await expect(
        checkFarahChatAllowance(userId, now),
        "a naive calendar-month implementation would wrongly grant 3 more here",
      ).rejects.toBeInstanceOf(InsufficientCreditsError);
    },
  );
});

describe("Pass coverage — checked only once the free allowance is exhausted", () => {
  it(
    "SABOTAGE-PROOF TARGET: a Pass holder with UNUSED free messages still uses the free allowance " +
      "first — the founder's explicit order, not tailoring gate's pass-first default",
    async () => {
      await insertPass(60 * 60 * 1000);
      await setBalance(0);
      const allowance = await checkFarahChatAllowance(userId);
      expect(allowance.isFreeAllowance, "free allowance must be consumed before Pass coverage").toBe(true);
      expect(allowance.isPassCovered).toBe(false);
    },
  );

  it("SABOTAGE-PROOF TARGET: a Pass holder's 4th+ message succeeds without touching credits", async () => {
    for (let i = 0; i < FARAH_CHAT_FREE_ALLOWANCE; i++) await insertGateEvent("covered_by_free_allowance", 1000);
    await insertPass(60 * 60 * 1000);
    await setBalance(0); // proves credits are never the reason this succeeds
    const allowance = await checkFarahChatAllowance(userId);
    expect(allowance.isPassCovered).toBe(true);
    expect(allowance.isFreeAllowance).toBe(false);
    expect(allowance.creditsSpent).toBe(0);
    expect(allowance.freeMessagesRemaining, "a Pass-covered message has no free-counter relevance").toBeNull();
  });

  it(
    "SABOTAGE-PROOF TARGET: a Pass holder who has ALSO hit the 30/day fair-use ceiling correctly " +
      "falls through to credits, not a hard block",
    async () => {
      for (let i = 0; i < FARAH_CHAT_FREE_ALLOWANCE; i++) await insertGateEvent("covered_by_free_allowance", 1000);
      await insertPass(60 * 60 * 1000);
      for (let i = 0; i < PASS_DAILY_ACTION_CAP; i++) await insertGateEvent("covered_by_pass", 1000);
      await setBalance(CREDIT_COSTS.farahChatMessage);

      const allowance = await checkFarahChatAllowance(userId);
      expect(allowance.isPassCovered, "capped Pass must not read as covered").toBe(false);
      expect(allowance.isFreeAllowance).toBe(false);
      expect(allowance.creditsSpent).toBe(CREDIT_COSTS.farahChatMessage);
    },
  );

  it("a capped Pass holder with insufficient credits gets the fair-use message, not the generic one", async () => {
    for (let i = 0; i < FARAH_CHAT_FREE_ALLOWANCE; i++) await insertGateEvent("covered_by_free_allowance", 1000);
    await insertPass(60 * 60 * 1000);
    for (let i = 0; i < PASS_DAILY_ACTION_CAP; i++) await insertGateEvent("covered_by_pass", 1000);
    await setBalance(0);

    try {
      await checkFarahChatAllowance(userId);
      expect.unreachable("should have thrown InsufficientCreditsError");
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientCreditsError);
      expect((err as InsufficientCreditsError).capMessage).toBeDefined();
    }
  });
});

describe("credits — the final fallback", () => {
  it("proceeds and spends the correct amount when the free allowance and Pass are both unavailable", async () => {
    for (let i = 0; i < FARAH_CHAT_FREE_ALLOWANCE; i++) await insertGateEvent("covered_by_free_allowance", 1000);
    await setBalance(CREDIT_COSTS.farahChatMessage);

    const allowance = await checkFarahChatAllowance(userId);
    expect(allowance.isFreeAllowance).toBe(false);
    expect(allowance.isPassCovered).toBe(false);
    expect(allowance.creditsSpent).toBe(CREDIT_COSTS.farahChatMessage);

    await commitFarahChatAllowance(userId, allowance);
    const { data: profile } = await admin.from("profiles").select("credits_balance").eq("id", userId).single();
    expect(profile?.credits_balance).toBe(0);
  });

  it("SABOTAGE-PROOF TARGET: insufficient credits, no Pass, allowance exhausted — genuinely blocked", async () => {
    for (let i = 0; i < FARAH_CHAT_FREE_ALLOWANCE; i++) await insertGateEvent("covered_by_free_allowance", 1000);
    await setBalance(CREDIT_COSTS.farahChatMessage - 1);
    await expect(checkFarahChatAllowance(userId)).rejects.toMatchObject({
      required: CREDIT_COSTS.farahChatMessage,
      available: CREDIT_COSTS.farahChatMessage - 1,
    });
  });
});

describe("someone who buys credits after exhausting the free allowance", () => {
  it("is unblocked the moment their balance covers the cost, no other state needs to change", async () => {
    for (let i = 0; i < FARAH_CHAT_FREE_ALLOWANCE; i++) await insertGateEvent("covered_by_free_allowance", 1000);
    await setBalance(0);
    await expect(checkFarahChatAllowance(userId)).rejects.toBeInstanceOf(InsufficientCreditsError);

    await setBalance(CREDIT_COSTS.farahChatMessage);
    const allowance = await checkFarahChatAllowance(userId);
    expect(allowance.creditsSpent).toBe(CREDIT_COSTS.farahChatMessage);
  });
});

describe("a Pass holder who later loses their Pass mid-window", () => {
  it("falls back to credits once the Pass is canceled, without the free allowance coming back", async () => {
    for (let i = 0; i < FARAH_CHAT_FREE_ALLOWANCE; i++) await insertGateEvent("covered_by_free_allowance", 1000);
    await insertPass(60 * 60 * 1000);
    const stillPassCovered = await checkFarahChatAllowance(userId);
    expect(stillPassCovered.isPassCovered).toBe(true);

    // Cancel it (mirrors a real cancellation, not just letting it expire).
    await admin.from("user_passes").update({ status: "canceled" }).eq("user_id", userId);
    await setBalance(CREDIT_COSTS.farahChatMessage);

    const afterCancel = await checkFarahChatAllowance(userId);
    expect(afterCancel.isPassCovered, "a canceled Pass must not still cover messages").toBe(false);
    expect(afterCancel.isFreeAllowance, "the free allowance must not reappear just because the Pass is gone").toBe(
      false,
    );
    expect(afterCancel.creditsSpent).toBe(CREDIT_COSTS.farahChatMessage);
  });
});
