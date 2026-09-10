/**
 * 0130 — `referral_leaderboard()`, the one deliberate cross-user read this
 * migration adds. Everything here proves the boundary directly rather than
 * asserting it: an opted-out user's real, larger activated count must never
 * surface, ranking must come from `activated_at` (not a raw invite count),
 * and the display-name fallback must behave as documented.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";

type AuthedTestUser = Awaited<ReturnType<typeof createAuthedTestUser>>;

let referrerA: AuthedTestUser; // opted IN, 2 activated referrals
let referrerB: AuthedTestUser; // opted OUT (default), 3 activated referrals — must be absent
let referredA1: AuthedTestUser;
let referredA2: AuthedTestUser;
let referredB1: AuthedTestUser;
let referredB2: AuthedTestUser;
let referredB3: AuthedTestUser;
let referralRowIds: string[] = [];

const allUserIds = () => [
  referrerA.id,
  referrerB.id,
  referredA1.id,
  referredA2.id,
  referredB1.id,
  referredB2.id,
  referredB3.id,
];

/** This calendar month, in the exact [start, end) shape the function expects. */
function thisMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

beforeAll(async () => {
  [referrerA, referrerB, referredA1, referredA2, referredB1, referredB2, referredB3] = await Promise.all([
    createAuthedTestUser("rlb-referrer-a"),
    createAuthedTestUser("rlb-referrer-b", { first_name: "RLB Referrer B" }),
    createAuthedTestUser("rlb-referred-a1"),
    createAuthedTestUser("rlb-referred-a2"),
    createAuthedTestUser("rlb-referred-b1"),
    createAuthedTestUser("rlb-referred-b2"),
    createAuthedTestUser("rlb-referred-b3"),
  ]);

  // A opts in with a chosen display name; B stays at the default (opted out).
  const { error: profErr } = await admin
    .from("profiles")
    .update({ referral_leaderboard_opt_in: true, referral_leaderboard_display_name: "RLB-Ada-The-Referrer" })
    .eq("id", referrerA.id);
  if (profErr) throw new Error(`opt-in fixture A: ${profErr.message}`);

  const now = new Date().toISOString();
  const rows: {
    referrer_id: string;
    referred_user_id: string | null;
    status: "invited" | "activated";
    activated_at?: string;
  }[] = [
    // A: two ACTIVATED this month.
    { referrer_id: referrerA.id, referred_user_id: referredA1.id, status: "activated", activated_at: now },
    { referrer_id: referrerA.id, referred_user_id: referredA2.id, status: "activated", activated_at: now },
    // A: one merely INVITED — must not count toward activated_count.
    { referrer_id: referrerA.id, referred_user_id: null, status: "invited" },
    // B: three ACTIVATED this month — a real, LARGER count than A's, and B
    // is opted out. This is the actual leak this migration must not have.
    { referrer_id: referrerB.id, referred_user_id: referredB1.id, status: "activated", activated_at: now },
    { referrer_id: referrerB.id, referred_user_id: referredB2.id, status: "activated", activated_at: now },
    { referrer_id: referrerB.id, referred_user_id: referredB3.id, status: "activated", activated_at: now },
  ];
  const { data: inserted, error: insertErr } = await admin.from("referrals").insert(rows).select("id");
  if (insertErr) throw new Error(`fixture referrals: ${insertErr.message}`);
  referralRowIds = (inserted ?? []).map((r) => r.id);
});

afterAll(async () => {
  const { error: delErr } = await admin.from("referrals").delete().in("id", referralRowIds);
  if (delErr) throw new Error(`cleanup referrals: ${delErr.message}`);
  await deleteTestUsers(allUserIds());
});

describe("referral_leaderboard — the opt-out boundary, checked directly", () => {
  it("an opted-out user with a LARGER real activated count never appears, under the real query", async () => {
    const { start, end } = thisMonthRange();
    const { data, error } = await admin.rpc("referral_leaderboard", {
      p_period_start: start,
      p_period_end: end,
    });
    expect(error).toBeNull();

    const names = (data ?? []).map((r) => r.display_name);
    expect(names, "referrer B (opted out, 3 activated referrals) leaked onto the board").not.toContain(
      "RLB Referrer B",
    );
    // Decisive, not just "B is absent": confirm the opted-IN referrer is
    // present with the RIGHT count, so an empty/broken query can't pass this
    // test by accident.
    const rowA = (data ?? []).find((r) => r.display_name === "RLB-Ada-The-Referrer");
    expect(rowA?.activated_count).toBe(2);
  });

  it("ranks by ACTIVATED count, not a raw invite count — A's invited-only referral does not inflate the total", async () => {
    const { start, end } = thisMonthRange();
    const { data } = await admin.rpc("referral_leaderboard", { p_period_start: start, p_period_end: end });
    const rowA = (data ?? []).find((r) => r.display_name === "RLB-Ada-The-Referrer");
    // 2 activated + 1 invited exist for A; the count must reflect only the 2.
    expect(rowA?.activated_count).toBe(2);
  });

  it("opting B in surfaces their real, larger count and re-ranks above A", async () => {
    const { error: optInErr } = await admin
      .from("profiles")
      .update({ referral_leaderboard_opt_in: true })
      .eq("id", referrerB.id);
    expect(optInErr).toBeNull();

    try {
      const { start, end } = thisMonthRange();
      const { data } = await admin.rpc("referral_leaderboard", { p_period_start: start, p_period_end: end });
      const rowB = (data ?? []).find((r) => r.activated_count === 3);
      expect(rowB, "B did not appear after opting in").toBeDefined();
      expect(rowB!.rank).toBe(1);
      const rowA = (data ?? []).find((r) => r.display_name === "RLB-Ada-The-Referrer");
      expect(rowA!.rank).toBe(2);
      // B never set a custom display name — falls back to first_name,
      // exactly (not the "A Talentrah member" no-name-at-all fallback,
      // which is a different case).
      expect(rowB!.display_name).toBe("RLB Referrer B");
    } finally {
      // Restore B to opted-out so it doesn't leak into a later test's count
      // of "how many rows come back" in this same describe block.
      await admin.from("profiles").update({ referral_leaderboard_opt_in: false }).eq("id", referrerB.id);
    }
  });

  it("a referral activated in a DIFFERENT period does not count toward this one", async () => {
    // Query a period that could not possibly contain "now" (the fixture's
    // own activated_at) — a full year in the past.
    const farPast = new Date();
    farPast.setUTCFullYear(farPast.getUTCFullYear() - 1);
    const start = new Date(Date.UTC(farPast.getUTCFullYear(), farPast.getUTCMonth(), 1)).toISOString();
    const end = new Date(Date.UTC(farPast.getUTCFullYear(), farPast.getUTCMonth() + 1, 1)).toISOString();

    const { data } = await admin.rpc("referral_leaderboard", { p_period_start: start, p_period_end: end });
    const names = (data ?? []).map((r) => r.display_name);
    expect(names).not.toContain("RLB-Ada-The-Referrer");
  });
});
