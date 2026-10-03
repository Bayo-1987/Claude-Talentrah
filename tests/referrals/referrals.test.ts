/**
 * Refer & Earn — the reward rules, tested against the live database.
 *
 * This feature pays real credits for actions a user can take entirely by
 * themselves, so almost every test here is an anti-abuse test. The rules live
 * in Postgres (handle_new_user, check_and_activate_referral,
 * grant_referral_reward), so they are exercised through real signups and real
 * triggers rather than a reimplementation — a hand-rolled unit test of the
 * logic would pass while the trigger stayed wrong, which is the failure mode
 * migration 0024's test notes call out.
 *
 * SINCE 0215 (decided 2026-10-02): a friend's SIGNUP pays nothing, ACTIVATION pays the whole reward (REFERRAL_REWARD_CREDITS = 50), and a
 * referral that signed up before 0215 (already paid its 10-credit signup half) gets the remainder at activation: no double payment and no
 * clawback. The cap (10 referrals in a rolling 30 days) and self-referral detection are unchanged.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { listUsersWithPrefix, RUN_TAG } from "../support/list-users";
import {
  REFERRAL_REWARD_CREDITS,
  REFERRAL_SIGNUP_BONUS_CREDITS,
  LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS,
} from "@/lib/referrals/rewards";
import { referralRowStatus, referralRewardWorth } from "@/lib/referrals/copy";

for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const) {
  if (!process.env[key]) throw new Error(`Referrals test cannot run: ${key} is not set.`);
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
type DB = SupabaseClient<Database>;

const admin: DB = createClient<Database>(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Every account this file creates, torn down in afterEach. */
let created: string[] = [];

/**
 * Creates an account at an EXACT address — these tests are about email shape,
 * so the address cannot be randomised away.
 *
 * Retries a rate-limit failure, because Supabase throttles admin account
 * creation and the whole suite shares that budget. The failure mode without
 * this is nasty: the account silently is not created and an assertion in some
 * other file fails instead, on a fixture user that never existed.
 */
async function makeUser(email: string, meta?: Record<string, unknown>): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: meta,
    });
    if (!error) {
      created.push(data.user!.id);
      return data.user!.id;
    }
    if (!/rate limit/i.test(error.message) || attempt >= 3) throw error;
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
}

/** A unique-but-gmail-shaped address, so dot rules apply without colliding. */
function gmail(tag: string): string {
  return `reftest-${RUN_TAG}-${tag}-${randomUUID().slice(0, 8)}@gmail.com`;
}

async function referralCodeOf(userId: string): Promise<string> {
  const { data } = await admin.from("profiles").select("referral_code").eq("id", userId).single();
  return data!.referral_code;
}

async function ledgerFor(userId: string) {
  /*
   * Throws rather than `data ?? []`.
   *
   * The swallowing version turned a transient query failure into "this user
   * has no ledger rows", which reads as a genuine assertion failure. It caused
   * exactly one: a full-suite run reported
   *
   *   × leaves the referrer's credits intact but drops the referral row
   *     AssertionError: the ledger entry survives, which is why the derived
   *     figure under-reports: expected +0 to be 1
   *
   * while the same test passed 3/3 in isolation and the assertion two lines
   * earlier had just read the referrer's balance as 5 — which is the signup
   * bonus, so the ledger row provably existed a moment before. There is no FK
   * from credit_ledger to referrals (checked against the live schema), so
   * nothing could have deleted it. The query simply failed and said "empty".
   *
   * A test helper that cannot distinguish "no rows" from "the question was
   * never answered" will eventually blame the code for the network.
   */
  const { data, error } = await admin
    .from("credit_ledger")
    .select("reason, delta, related_entity_id, created_at")
    .eq("user_id", userId);
  if (error) throw new Error(`ledgerFor(${userId}) failed: ${error.message}`);
  return data ?? [];
}

async function balanceOf(userId: string): Promise<number> {
  const { data } = await admin.from("profiles").select("credits_balance").eq("id", userId).single();
  return data?.credits_balance ?? -1;
}

async function referralRowFor(referredId: string) {
  const { data } = await admin
    .from("referrals")
    .select("id, status, reward_credits_referrer, reward_withheld_reason, activated_at")
    .eq("referred_user_id", referredId)
    .maybeSingle();
  return data;
}

/** An authenticated client for a user, the way a real session has one. */
async function sessionFor(userId: string, email: string): Promise<DB> {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const client = createClient<Database>(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: otpErr } = await client.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (otpErr) throw otpErr;
  return client;
}

/** Activates a referred user the way a real one does: a base resume. Waits for the trigger, as every test in this file does. */
async function activate(referredId: string) {
  const { error } = await admin.from("resumes").insert({
    user_id: referredId,
    title: "Base",
    is_base: true,
    source: "uploaded",
    structured_content: {},
  });
  if (error) throw error;
  await new Promise((r) => setTimeout(r, 1200));
}

beforeEach(() => {
  created = [];
});

afterEach(async () => {
  // Parallel, with a raised budget: the farming test creates 16 accounts and
  // serial deletion blew the default 10s hook timeout.
  await Promise.all(created.map((id) => admin.auth.admin.deleteUser(id).catch(() => {})));
  created = [];
}, 60_000);

afterAll(async () => {
  /*
   * Belt-and-braces: anything this file leaked despite afterEach.
   *
   * Parallel, with an explicit hook timeout — the third instance of the shape
   * PR #38 fixed in spend-race and rate-limit, missed there only because this
   * file arrived on a different branch. Serially it is one round-trip per
   * leaked account inside vitest's default 10s budget, and it blew that here:
   * all 267 tests passed while the FILE was reported failed. The timeout
   * aborts the loop partway, so the hook leaks exactly the accounts it exists
   * to remove, into the shared project — there is no staging database.
   */
  const mine = await listUsersWithPrefix(admin, `reftest-${RUN_TAG}-`);
  await Promise.all(mine.map((u) => admin.auth.admin.deleteUser(u.id).catch(() => {})));
}, 60_000);

/* ========================================================================== *
 * §-1 — the repricing connection (0092)
 * ========================================================================== */

describe("referral reward amounts stay connected to CREDIT_COSTS (0092)", () => {
  /**
   * THE IMPORTANT ONE. 0089's pricing rebase moved CREDIT_COSTS.tailoringRun
   * 5 -> 20 and rebased every other action price with it, but the two
   * referral rewards are granted from inside Postgres triggers with no
   * TypeScript call site — see 0092's migration comment and
   * src/lib/referrals/rewards.ts for the full story — so nothing caught that
   * the programme silently lost 75% of its value. This test is the fix for
   * THAT class of bug: it reads the REAL amount the live triggers grant and
   * compares it against the value computed from CREDIT_COSTS.tailoringRun,
   * not a bare literal. A future repricing that bumps tailoringRun without
   * also updating migration 0092's hardcoded amounts changes what this test
   * EXPECTS without changing what the database actually grants — and fails,
   * on this exact line, rather than shipping silently.
   */
  it(
    "SABOTAGE-PROOF TARGET: the reward actually granted at activation equals REFERRAL_REWARD_CREDITS, " +
      "and a fresh referral is paid all of it in ONE grant",
    async () => {
      const referrer = await makeUser(gmail("reprice-r"));
      const code = await referralCodeOf(referrer);
      const referred = await makeUser(gmail("reprice-b"), { referred_by_code: code });
      await activate(referred);

      const rows = (await ledgerFor(referrer)).filter(
        (l) => l.reason === "referral_activation_bonus" || l.reason === "referral_signup_bonus",
      );
      expect(rows, "the reward was never granted, or was split").toHaveLength(1);
      expect(rows[0].reason).toBe("referral_activation_bonus");
      expect(rows[0].delta).toBe(REFERRAL_REWARD_CREDITS);
      expect((await referralRowFor(referred))?.reward_credits_referrer).toBe(REFERRAL_REWARD_CREDITS);
      // PARITY: what the SQL function actually paid is what the page and the email say it pays (their numbers come from the same constant).
      expect(referralRewardWorth(), "the copy promises a different amount than the database paid").toContain(`${rows[0].delta} credits`);
    },
  );

  it("A FRIEND SIGNING UP GIVES THE REFERRER 0 CREDITS (REFERRAL_SIGNUP_BONUS_CREDITS is 0): the referral is recorded and nothing is paid", async () => {
    const referrer = await makeUser(gmail("reprice-signup-r"));
    const code = await referralCodeOf(referrer);
    const referred = await makeUser(gmail("reprice-signup-b"), { referred_by_code: code });

    expect(REFERRAL_SIGNUP_BONUS_CREDITS).toBe(0);
    expect(await ledgerFor(referrer), "a signup alone must not touch the ledger").toHaveLength(0);
    expect(await balanceOf(referrer)).toBe(0);
    const row = await referralRowFor(referred);
    expect(row?.status, "the referral is still recorded").toBe("signed_up");
    expect(row?.reward_credits_referrer).toBe(0);
  });
});

/* ========================================================================== *
 * §0 — self-referral detection
 * ========================================================================== */

describe("email normalisation for self-referral (0036)", () => {
  async function normalise(email: string): Promise<string> {
    const { data, error } = await admin.rpc("normalize_email_for_self_referral", {
      p_email: email,
    });
    if (error) throw error;
    return data as unknown as string;
  }

  it("treats a Gmail dotted alias as the same inbox", async () => {
    // The bug. Gmail ignores dots, so these are one mailbox — and before 0036
    // they normalised to two different strings and the referral paid out.
    expect(await normalise("j.doe@gmail.com")).toBe(await normalise("jdoe@gmail.com"));
    expect(await normalise("j.o.h.n.doe@gmail.com")).toBe(await normalise("johndoe@gmail.com"));
  });

  it("folds googlemail.com into gmail.com", async () => {
    expect(await normalise("jdoe@googlemail.com")).toBe(await normalise("jdoe@gmail.com"));
  });

  it("still strips +suffix, and still lowercases", async () => {
    // Pinned as regressions: both already worked, and the dot fix must not
    // have disturbed them.
    expect(await normalise("jdoe+jobs@gmail.com")).toBe(await normalise("jdoe@gmail.com"));
    expect(await normalise("JDoe@GMAIL.com")).toBe(await normalise("jdoe@gmail.com"));
    expect(await normalise("JDoe+X@GoogleMail.COM")).toBe(await normalise("jdoe@gmail.com"));
  });

  it("does NOT strip dots at non-Gmail domains", async () => {
    /*
     * Deliberate, and the more important half of the rule. At a corporate
     * domain `j.doe@` and `jdoe@` are routinely two different people. Stripping
     * dots everywhere would block a genuine referral between colleagues and
     * deny both of them a reward with no explanation — a worse failure than the
     * farming it would prevent.
     */
    expect(await normalise("j.doe@acme.com")).not.toBe(await normalise("jdoe@acme.com"));
    expect(await normalise("j.doe@outlook.com")).not.toBe(await normalise("jdoe@outlook.com"));
    expect(await normalise("j.doe@yahoo.com")).not.toBe(await normalise("jdoe@yahoo.com"));
  });
});

describe("self-referral is blocked end to end", () => {
  async function attemptReferral(referrerEmail: string, referredEmail: string) {
    const referrer = await makeUser(referrerEmail);
    const code = await referralCodeOf(referrer);
    const referred = await makeUser(referredEmail, { referred_by_code: code, first_name: "Ref" });
    const row = await referralRowFor(referred);
    // Since 0215 only ACTIVATION pays, so the attempt includes activating the referred user: a self-referral must earn nothing even then.
    await activate(referred);
    return {
      referrer,
      referred,
      row,
      paid: (await ledgerFor(referrer)).some(
        (l) => l.reason === "referral_activation_bonus" || l.reason === "referral_signup_bonus",
      ),
      balance: await balanceOf(referrer),
    };
  }

  it("a Gmail dotted alias earns nothing", async () => {
    // Measured paying out before 0036: referral_row=CREATED, signup_bonus=PAID, balance=5.
    const tag = randomUUID().slice(0, 8);
    const result = await attemptReferral(
      `reftest-dot-${tag}.x@gmail.com`,
      `reftest-dot-${tag}x@gmail.com`,
    );
    expect(result.row, "FARMING: a dotted alias of the same inbox created a referral").toBeNull();
    expect(result.paid, "FARMING: a dotted alias of the same inbox was paid").toBe(false);
    expect(result.balance).toBe(0);
  });

  it("a +suffix alias earns nothing", async () => {
    const tag = randomUUID().slice(0, 8);
    const result = await attemptReferral(
      `reftest-plus-${tag}@gmail.com`,
      `reftest-plus-${tag}+jobs@gmail.com`,
    );
    expect(result.row).toBeNull();
    expect(result.paid).toBe(false);
  });

  it("a googlemail/gmail pair earns nothing", async () => {
    const tag = randomUUID().slice(0, 8);
    const result = await attemptReferral(
      `reftest-gm-${tag}@googlemail.com`,
      `reftest-gm-${tag}@gmail.com`,
    );
    expect(result.row).toBeNull();
    expect(result.paid).toBe(false);
  });

  it("a case variant cannot even be registered", async () => {
    /*
     * Worth recording where this defence actually lives: Supabase Auth itself
     * refuses a second account differing only in case, so the pair can never
     * exist. The trigger's lower() is belt-and-braces, not the primary guard —
     * measured, because the obvious assumption is that the trigger does it.
     */
    const tag = randomUUID().slice(0, 8);
    const email = `reftest-case-${tag}@gmail.com`;
    await makeUser(email);
    await expect(
      admin.auth.admin.createUser({ email: email.toUpperCase(), email_confirm: true }),
    ).resolves.toMatchObject({ error: expect.objectContaining({ code: "email_exists" }) });
  });

  it("POSITIVE CONTROL: two genuinely different people are paid", async () => {
    // Without this, every assertion above is satisfied by a referral system
    // that never pays anyone.
    const result = await attemptReferral(gmail("real-a"), gmail("real-b"));
    expect(result.row?.status, "a legitimate referral must be recorded").toBe("signed_up");
    expect(result.paid, "a legitimate referral must be paid when its friend activates").toBe(true);
    expect(result.balance).toBe(REFERRAL_REWARD_CREDITS);
  });

  it("POSITIVE CONTROL: dotted addresses at a company domain still refer each other", async () => {
    const tag = randomUUID().slice(0, 8);
    const result = await attemptReferral(
      `reftest-corp-${tag}.a@acme-test.example`,
      `reftest-corp-${tag}a@acme-test.example`,
    );
    expect(
      result.paid,
      "two colleagues at a company domain must not be mistaken for one person",
    ).toBe(true);
  });
});

/* ========================================================================== *
 * §1 — the 30-day reward cap
 * ========================================================================== */

describe("the 10-per-30-days reward cap", () => {
  /**
   * Seeds N already-rewarded referrals for a referrer by writing the ledger
   * directly, which is what `count_rewarded_referrals_last_30d` actually reads.
   * Far faster than creating N real signups, and it exercises the same counter.
   */
  async function seedRewardedReferrals(referrerId: string, n: number, daysAgo = 0) {
    const rows = Array.from({ length: n }, () => ({
      user_id: referrerId,
      delta: REFERRAL_REWARD_CREDITS,
      reason: "referral_activation_bonus" as const,
      related_entity_id: randomUUID(),
      balance_after: 0,
      created_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    }));
    const { error } = await admin.from("credit_ledger").insert(rows);
    if (error) throw error;
  }

  it("pays the 10th referral and blocks the 11th", async () => {
    const referrer = await makeUser(gmail("cap-r"));
    const code = await referralCodeOf(referrer);
    const rewards = async () => (await ledgerFor(referrer)).filter((l) => l.reason === "referral_activation_bonus");

    // 9 already rewarded → the next one is the 10th and must pay (at activation: a signup alone pays nothing).
    await seedRewardedReferrals(referrer, 9);
    await activate(await makeUser(gmail("cap-10"), { referred_by_code: code }));
    expect((await rewards()).length, "the 10th referral should still be rewarded").toBe(10);

    // Now 10 are rewarded → the 11th must be blocked.
    await activate(await makeUser(gmail("cap-11"), { referred_by_code: code }));
    expect((await rewards()).length, "CAP BREACH: an 11th referral was rewarded inside the window").toBe(10);
  });

  it("the window is ROLLING, not a calendar month", async () => {
    /*
     * Pinned deliberately. A later reimplementation anchored to the calendar
     * month would silently change real payout economics — 10 rewards resetting
     * on the 1st is a very different product from 10 in any trailing 30 days.
     */
    const referrer = await makeUser(gmail("roll-r"));
    const code = await referralCodeOf(referrer);

    // 10 rewards, but all 31 days old — outside the window, so they must not count.
    await seedRewardedReferrals(referrer, 10, 31);
    await activate(await makeUser(gmail("roll-new"), { referred_by_code: code }));

    const fresh = (await ledgerFor(referrer)).filter(
      (l) => l.reason === "referral_activation_bonus" && Date.now() - new Date(l.created_at).getTime() < 86_400_000,
    );
    expect(
      fresh.length,
      "rewards older than 30 days must age out of the cap window",
    ).toBe(1);
  });

  it("a capped-out referral is marked activated, paid nothing, and the row SAYS why (derived: no longer silent)", async () => {
    /*
     * The decision in docs/referrals-open-questions.md #1: the cap stays, and nothing is silently unpaid. grant_referral_reward still
     * returns without paying when the cap is hit, and check_and_activate_referral still marks the referral 'activated' (the friend DID
     * activate: the leaderboard counts it). What changed is visibility: since 0215 grant_referral_reward RECORDS the reason on the
     * referral (reward_withheld_reason = 'cap'), and /refer reads that column; it is no longer inferred from the amount.
     */
    const referrer = await makeUser(gmail("capped-r"));
    const code = await referralCodeOf(referrer);
    const referred = await makeUser(gmail("capped-b"), { referred_by_code: code });

    // Fill the window before activation, so activation is the capped step.
    await seedRewardedReferrals(referrer, 10);
    await activate(referred);

    const row = await referralRowFor(referred);
    const forThisReferral = (await ledgerFor(referrer)).filter((l) => l.related_entity_id === row?.id);

    expect(row?.status, "the referral is marked activated regardless of the cap (the friend did activate)").toBe("activated");
    expect(forThisReferral.length, "nothing is paid for it").toBe(0);
    expect(row?.reward_credits_referrer).toBe(0);
    expect(row?.reward_withheld_reason, "the function RECORDS why it paid nothing").toBe("cap");
    expect(
      referralRowStatus({
        status: row!.status,
        reward_credits_referrer: row!.reward_credits_referrer,
        reward_withheld_reason: row!.reward_withheld_reason,
      }),
    ).toMatchObject({ tone: "withheld" });
  });

  it("excludes the referral being rewarded from its own cap count, and pays a PRE-0215 referral only the REMAINDER", async () => {
    /*
     * The subtle one, and now the second money rule too. grant_referral_reward passes p_exclude_referral_id so a referral's own earlier
     * payment doesn't count against its later one: get that backwards and every referral caps itself out at activation after 9 others.
     *
     * A referral that signed up BEFORE 0215 was already paid its 10-credit signup half (a ledger row AND reward_credits_referrer = 10).
     * It is stood in for here by writing exactly that, since a real signup no longer pays. At activation it must receive only the
     * remainder (50 - 10 = 40), not another 50 (no double payment), and not be capped out by its own signup row.
     */
    const referrer = await makeUser(gmail("excl-r"));
    const code = await referralCodeOf(referrer);
    const referred = await makeUser(gmail("excl-b"), { referred_by_code: code });
    const referral = await referralRowFor(referred);

    const { error: ledgerErr } = await admin.from("credit_ledger").insert({
      user_id: referrer,
      delta: LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS,
      reason: "referral_signup_bonus" as const,
      related_entity_id: referral!.id,
      balance_after: 0,
    });
    if (ledgerErr) throw ledgerErr;
    const { error: rowErr } = await admin
      .from("referrals")
      .update({ reward_credits_referrer: LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS })
      .eq("id", referral!.id);
    if (rowErr) throw rowErr;

    // 8 unrelated rewards + this referral's own signup payment = 9 distinct referrals in the window.
    await seedRewardedReferrals(referrer, 8);
    await activate(referred);

    const activation = (await ledgerFor(referrer)).filter(
      (l) => l.reason === "referral_activation_bonus" && l.related_entity_id === referral!.id,
    );
    expect(activation, "the referral's own signup payment must not count against its activation").toHaveLength(1);
    expect(activation[0].delta, "a pre-0215 referral gets the REMAINDER, not the whole reward again").toBe(
      REFERRAL_REWARD_CREDITS - LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS,
    );
    expect((await referralRowFor(referred))?.reward_credits_referrer, "it ends at the same total as any other referral").toBe(
      REFERRAL_REWARD_CREDITS,
    );
  });
});

/* ========================================================================== *
 * §2 — activation
 * ========================================================================== */

describe("what counts as activation", () => {
  async function referredPair(tag: string) {
    const referrer = await makeUser(gmail(`${tag}-r`));
    const code = await referralCodeOf(referrer);
    const referred = await makeUser(gmail(`${tag}-b`), { referred_by_code: code });
    return { referrer, referred };
  }

  async function activationBonusCount(referrerId: string) {
    return (await ledgerFor(referrerId)).filter((l) => l.reason === "referral_activation_bonus")
      .length;
  }

  it("a fabricated manual tracker entry marked applied DOES pay the activation bonus", async () => {
    /*
     * Intentional regression guard, not an endorsement. The plan doc defines
     * activation as "completed profile OR first application", and the trigger
     * fires on applied_at — so a manual entry for a company that does not exist
     * is enough. Pinned here on the CREDIT side; the Tracker side has its own
     * paired test. What bounds this is the 10-per-30-days cap, not any
     * verification of the job.
     */
    const { referrer, referred } = await referredPair("manual");
    await admin.from("applications").insert({
      user_id: referred,
      manual_job_snapshot: { companyName: "Entirely Invented Ltd", title: "Chief Nobody" },
      stage: "applied",
      source: "manual",
      applied_at: new Date().toISOString(),
    });
    await new Promise((r) => setTimeout(r, 1200));

    expect(await activationBonusCount(referrer)).toBe(1);
    expect((await referralRowFor(referred))?.status).toBe("activated");
  });

  it("a Resume Builder resume does NOT activate — only is_base does", async () => {
    /*
     * POSITIVE CONTROL for an "obviously true" assumption: only the upload path
     * sets is_base, so builder output never activates. This breaks silently the
     * day someone adds "make this my base resume" to the builder, which is a
     * very plausible feature.
     */
    const { referrer, referred } = await referredPair("builder");
    await admin.from("resumes").insert({
      user_id: referred,
      title: "Builder draft",
      is_base: false,
      source: "builder",
      structured_content: { summary: "x" },
    });
    await new Promise((r) => setTimeout(r, 1000));

    expect(await activationBonusCount(referrer)).toBe(0);
    expect((await referralRowFor(referred))?.status).toBe("signed_up");
  });

  it("re-uploading a resume does not pay a second activation bonus", async () => {
    const { referrer, referred } = await referredPair("reupload");
    const { data: resume } = await admin
      .from("resumes")
      .insert({
        user_id: referred,
        title: "Base",
        is_base: true,
        source: "uploaded",
        structured_content: {},
      })
      .select("id")
      .single();
    await new Promise((r) => setTimeout(r, 1200));
    expect(await activationBonusCount(referrer)).toBe(1);

    // The real re-upload path replaces content in place and never touches is_base.
    await admin
      .from("resumes")
      .update({ structured_content: { summary: "updated" }, title: "Base v2" })
      .eq("id", resume!.id);
    await new Promise((r) => setTimeout(r, 1000));

    expect(await activationBonusCount(referrer), "a re-upload double-paid").toBe(1);
  });

  it("deleting and re-inserting a base resume does not pay twice", async () => {
    /*
     * There is no app-level delete for a base resume today, but the owner-only
     * FOR ALL policy on `resumes` would allow one from a client, and the moment
     * any future feature exposes a delete button this becomes reachable. The
     * ONLY thing preventing a repeat payout is check_and_activate_referral's
     * `where status = 'signed_up'` guard — so it is worth an explicit test
     * while it is cheap.
     */
    const { referrer, referred } = await referredPair("recreate");
    const { data: resume } = await admin
      .from("resumes")
      .insert({
        user_id: referred,
        title: "Base",
        is_base: true,
        source: "uploaded",
        structured_content: {},
      })
      .select("id")
      .single();
    await new Promise((r) => setTimeout(r, 1200));
    expect(await activationBonusCount(referrer)).toBe(1);

    await admin.from("resumes").delete().eq("id", resume!.id);
    await admin.from("resumes").insert({
      user_id: referred,
      title: "Base again",
      is_base: true,
      source: "uploaded",
      structured_content: {},
    });
    await new Promise((r) => setTimeout(r, 1200));

    expect(
      await activationBonusCount(referrer),
      "MONEY: delete + re-insert of a base resume paid the activation bonus twice",
    ).toBe(1);
  });
});

/* ========================================================================== *
 * §3 — funnel, security, abuse
 * ========================================================================== */

describe("a referrer cannot inflate their own rewards", () => {
  it("cannot PATCH their own referrals row", async () => {
    /*
     * The realistic attack, and the one the existing RLS suite never covered:
     * it tests that an unrelated OUTSIDER cannot write someone else's referral
     * row, not that the referrer — who has motive and knows their own row's id
     * — cannot write their own. There is no INSERT/UPDATE policy on `referrals`
     * at all, so this should be blocked structurally; confirmed rather than
     * assumed.
     */
    const email = gmail("inflate-r");
    const referrer = await makeUser(email);
    const code = await referralCodeOf(referrer);
    const referred = await makeUser(gmail("inflate-b"), { referred_by_code: code });
    const row = await referralRowFor(referred);
    const client = await sessionFor(referrer, email);

    await client
      .from("referrals")
      .update({ reward_credits_referrer: 9999, status: "activated" })
      .eq("id", row!.id);

    const after = await referralRowFor(referred);
    expect(after?.reward_credits_referrer, "MONEY: a referrer inflated their own reward").toBe(
      REFERRAL_SIGNUP_BONUS_CREDITS,
    );
    expect(after?.status, "a referrer marked their own referral activated").toBe("signed_up");
  });

  it("cannot insert a referral row out of thin air", async () => {
    const email = gmail("insert-r");
    const referrer = await makeUser(email);
    const victim = await makeUser(gmail("insert-v"));
    const client = await sessionFor(referrer, email);

    await client
      .from("referrals")
      .insert({ referrer_id: referrer, referred_user_id: victim, status: "activated" });

    const { data } = await admin.from("referrals").select("id").eq("referrer_id", referrer);
    expect(data ?? [], "a referrer fabricated a referral").toHaveLength(0);
  });

  it("cannot write their own credit ledger", async () => {
    const email = gmail("ledger-r");
    const referrer = await makeUser(email);
    const client = await sessionFor(referrer, email);

    await client.from("credit_ledger").insert({
      user_id: referrer,
      delta: 500,
      reason: "referral_activation_bonus",
      balance_after: 500,
    });
    expect(await balanceOf(referrer)).toBe(0);
  });
});

describe("signup farming earns nothing, and activating throwaway accounts is bounded by the cap", () => {
  it("rapid signups against one code pay NOTHING; activating them stops paying at the cap", async () => {
    /*
     * Before 0215 the signup bonus needed NO activation, so the cap was the only thing between a throwaway-address farm and unlimited
     * credits. Now a signup pays nothing at all: farming costs the farmer an activation per account (a saved resume or an application)
     * and is STILL bounded by the cap. Proven under the pattern an attacker would actually use: many accounts against one code.
     *
     * The window is pre-filled to 8 with ledger rows rather than 8 more real accounts (an earlier version created 15 and, combined with
     * other suites, tripped Supabase Auth's rate limit in CI, surfacing as unrelated failures elsewhere). Four REAL signups against the
     * pre-filled window: all four pay nothing at signup; activating them, two pay and two are refused.
     */
    const referrer = await makeUser(gmail("farm-r"));
    const code = await referralCodeOf(referrer);
    await admin.from("credit_ledger").insert(
      Array.from({ length: 8 }, () => ({
        user_id: referrer,
        delta: REFERRAL_REWARD_CREDITS,
        reason: "referral_activation_bonus" as const,
        related_entity_id: randomUUID(),
        balance_after: 0,
        created_at: new Date().toISOString(),
      })),
    );

    const friends: string[] = [];
    for (let i = 0; i < 4; i++) friends.push(await makeUser(gmail(`farm-${i}`), { referred_by_code: code }));
    expect((await ledgerFor(referrer)).length, "signups alone pay nothing: only the 8 seeded rows exist before anyone activates").toBe(8);

    for (const friend of friends) await activate(friend);

    const rewards = (await ledgerFor(referrer)).filter((l) => l.reason === "referral_activation_bonus");
    expect(rewards.length, `FARMING: ${rewards.length} rewards recorded — the cap is 10`).toBe(10);
  }, 120_000);
});

describe("referral code lookup", () => {
  it("is case-SENSITIVE — a lowercased code silently attributes nothing", async () => {
    /*
     * generate_referral_code always emits uppercase, and the signup lookup does
     * no case folding. A lowercased copy of a link — plausible the moment any
     * share surface or client lowercases a URL — fails to attribute with no
     * error anywhere. Documented here rather than fixed, because whether to
     * normalise is a product call about link handling, not a security fix.
     */
    const referrer = await makeUser(gmail("code-r"));

    /*
     * The generated code is PINNED here rather than used as-issued, and that
     * is the difference between this test passing 100% of the time and 97.7%.
     *
     * `generate_referral_code` is `upper(substr(md5(...), 1, 8))`. md5 hex
     * draws from 0-9a-f, so ten of its sixteen characters are digits and an
     * all-digit code — one where `code.toLowerCase() === code` — is not rare:
     *
     *     50,000 sampled codes -> 1,162 all-digit  (2.324%)
     *     predicted (10/16)^8              2.328%   = 1 run in 43
     *
     * When that happens the lowercased code is the SAME string, the lookup
     * correctly attributes, and this test fails claiming case-insensitivity
     * that does not exist. It caught nothing; it just lost a coin toss. This
     * pin keeps the property under test (a genuinely case-DIFFERENT code must
     * not attribute) and removes the coin toss.
     */
    await admin
      .from("profiles")
      .update({ referral_code: `REF${randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase()}` })
      .eq("id", referrer);

    const code = await referralCodeOf(referrer);
    expect(code, "codes are expected to be uppercase").toBe(code.toUpperCase());
    expect(code, "the pin must make the code genuinely case-different").not.toBe(
      code.toLowerCase(),
    );

    const referred = await makeUser(gmail("code-b"), { referred_by_code: code.toLowerCase() });

    expect(await referralRowFor(referred), "lowercased code silently attributed nothing").toBeNull();
    expect(await balanceOf(referrer)).toBe(0);
  });

  it("an unknown code degrades silently rather than failing signup", async () => {
    // Confirmed as by-design rather than accidental: signup must not break
    // because someone typo'd a link.
    const referred = await makeUser(gmail("badcode-b"), { referred_by_code: "NOTACODE" });
    const { data: profile } = await admin
      .from("profiles")
      .select("id, referred_by")
      .eq("id", referred)
      .single();
    expect(profile?.id, "signup itself must still succeed").toBe(referred);
    expect(profile?.referred_by).toBeNull();
  });

  it("POSITIVE CONTROL: the exact uppercase code attributes correctly", async () => {
    const referrer = await makeUser(gmail("codeok-r"));
    const code = await referralCodeOf(referrer);
    const referred = await makeUser(gmail("codeok-b"), { referred_by_code: code });
    expect((await referralRowFor(referred))?.status).toBe("signed_up");
  });
});

describe("deleting a referred account", () => {
  it("leaves the referrer's credits AND the referral row intact; only the referred side is detached", async () => {
    /*
     * CHANGED DELIBERATELY (send-512, migration 0209). This test used to assert the opposite: "the referral row cascades away with the account".
     * Before 0209 `referrals.referred_user_id` was ON DELETE CASCADE, so deleting a referred account silently removed the referrer's history, and the
     * refer page's "credits earned" figure (the sum over the surviving `referrals` rows) then under-reported against the referrer's real balance. The
     * owner's decision for the account-deletion work is that referral rows decide SOMEONE ELSE'S reward and must outlive the account: the FK is now
     * ON DELETE SET NULL, so the row survives with `referred_user_id` null and the referrer's count, rewards and leaderboard position do not shrink.
     * (tests/rls/money-survives-user-deletion.test.ts covers the leaderboard and the other eight tables.)
     *
     * The credits were never clawed back: the ledger has no FK to the referred user.
     */
    const referrer = await makeUser(gmail("del-r"));
    const code = await referralCodeOf(referrer);
    const referred = await makeUser(gmail("del-b"), { referred_by_code: code });
    // A signup pays nothing since 0215, so activate first: otherwise "credits are not clawed back" would compare 0 with 0.
    await activate(referred);
    expect(await balanceOf(referrer)).toBe(REFERRAL_REWARD_CREDITS);

    await admin.auth.admin.deleteUser(referred);
    created = created.filter((id) => id !== referred);

    expect(await balanceOf(referrer), "credits must not be clawed back").toBe(REFERRAL_REWARD_CREDITS);
    const { data: rows } = await admin
      .from("referrals")
      .select("id, referrer_id, referred_user_id, status")
      .eq("referrer_id", referrer);
    expect(rows ?? [], "the referral row survives the account's deletion").toHaveLength(1);
    expect(rows![0].referred_user_id, "detached on the referred side").toBeNull();
    expect(rows![0].status).toBe("activated");

    const ledger = await ledgerFor(referrer);
    expect(
      ledger.filter((l) => l.reason === "referral_activation_bonus").length,
      "the ledger entry survives too",
    ).toBe(1);
  });
});

/* ========================================================================== *
 * §4 — 0215: the recorded reason, one count per referral, the atomic claim, a deleted referrer
 * ========================================================================== */

describe("0215 — what the cap counts, and that a referral never counts twice", () => {
  it("one referral never counts twice against the cap, even when it was paid at signup (legacy) AND at activation (two ledger rows, one referral)", async () => {
    /*
     * The cap counts DISTINCT referrals that have had any reward credited in the last 30 days (count_rewarded_referrals_last_30d groups ledger
     * rows by related_entity_id), so a pre-0215 referral paid 10 at signup and 40 at activation has two rows and ONE referral id.
     */
    const referrer = await makeUser(gmail("twice-r"));
    const code = await referralCodeOf(referrer);
    const referred = await makeUser(gmail("twice-b"), { referred_by_code: code });
    const referral = await referralRowFor(referred);

    // Stand in for the pre-0215 signup half: a ledger row AND the amount on the referral.
    await admin.from("credit_ledger").insert({
      user_id: referrer,
      delta: LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS,
      reason: "referral_signup_bonus" as const,
      related_entity_id: referral!.id,
      balance_after: 0,
    });
    await admin.from("referrals").update({ reward_credits_referrer: LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS }).eq("id", referral!.id);
    await activate(referred);

    const mine = (await ledgerFor(referrer)).filter((l) => l.related_entity_id === referral!.id);
    expect(mine.map((l) => l.reason).sort(), "the referral has BOTH rows").toEqual(["referral_activation_bonus", "referral_signup_bonus"]);

    const { data: counted, error } = await admin.rpc("count_rewarded_referrals_last_30d", { p_referrer_id: referrer });
    expect(error).toBeNull();
    expect(counted, "two ledger rows, one referral: it counts ONCE").toBe(1);
  });

  it("with 9 others and one such two-row referral the count is 10, so the 11th activation is blocked and recorded as 'cap'", async () => {
    const referrer = await makeUser(gmail("twice2-r"));
    const code = await referralCodeOf(referrer);
    await seedRewards(referrer, 9);
    const legacy = await makeUser(gmail("twice2-legacy"), { referred_by_code: code });
    const legacyRow = await referralRowFor(legacy);
    await admin.from("credit_ledger").insert({
      user_id: referrer,
      delta: LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS,
      reason: "referral_signup_bonus" as const,
      related_entity_id: legacyRow!.id,
      balance_after: 0,
    });
    await admin.from("referrals").update({ reward_credits_referrer: LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS }).eq("id", legacyRow!.id);
    await activate(legacy);
    expect((await admin.rpc("count_rewarded_referrals_last_30d", { p_referrer_id: referrer })).data).toBe(10);

    const eleventh = await makeUser(gmail("twice2-11"), { referred_by_code: code });
    await activate(eleventh);
    const row = await referralRowFor(eleventh);
    expect(row?.status).toBe("activated");
    expect(row?.reward_credits_referrer).toBe(0);
    expect(row?.reward_withheld_reason).toBe("cap");
  });

  async function seedRewards(referrerId: string, n: number) {
    const { error } = await admin.from("credit_ledger").insert(
      Array.from({ length: n }, () => ({
        user_id: referrerId,
        delta: REFERRAL_REWARD_CREDITS,
        reason: "referral_activation_bonus" as const,
        related_entity_id: randomUUID(),
        balance_after: 0,
      })),
    );
    if (error) throw error;
  }
});

describe("0215 — the reason is recorded when, and only when, a reward is withheld", () => {
  it("a normal activation records NO reason (NULL)", async () => {
    const referrer = await makeUser(gmail("noreason-r"));
    const code = await referralCodeOf(referrer);
    const referred = await makeUser(gmail("noreason-b"), { referred_by_code: code });
    await activate(referred);
    const row = await referralRowFor(referred);
    expect(row?.status).toBe("activated");
    expect(row?.reward_withheld_reason).toBeNull();
  });

  it("a signed-up referral that has not activated has no reason either", async () => {
    const referrer = await makeUser(gmail("noreason2-r"));
    const code = await referralCodeOf(referrer);
    const referred = await makeUser(gmail("noreason2-b"), { referred_by_code: code });
    expect((await referralRowFor(referred))?.reward_withheld_reason).toBeNull();
  });

  it("a DELETED REFERRER no longer makes the friend's own action fail: the referral is claimed, marked 'referrer_deleted', and pays nothing", async () => {
    /*
     * Found while listing the ways an activated referral can be underpaid. 0209 made referrals.referrer_id ON DELETE SET NULL, and the activation
     * used to call grant_referral_reward(null, ...), which RAISED inside the friend's own resumes trigger, so SAVING A RESUME FAILED for a friend whose
     * referrer had deleted their account.
     */
    const referrer = await makeUser(gmail("gone-r"));
    const code = await referralCodeOf(referrer);
    const referred = await makeUser(gmail("gone-b"), { referred_by_code: code });
    const before = await referralRowFor(referred);

    /*
     * profiles.referred_by (the friend's own profile row) is a plain FK to the referrer's profile with NO ON DELETE action (0000), so a
     * referrer who has referred a real signup CANNOT be deleted today: auth.admin.deleteUser fails with 23503 until that is changed (reported to
     * the account-deletion work, S3-21; not this migration's to change). The path this test is about only exists once it is, so the friend's
     * pointer is cleared first, which is what that change will do.
     */
    await admin.from("profiles").update({ referred_by: null }).eq("id", referred);
    const { error: deleteError } = await admin.auth.admin.deleteUser(referrer);
    if (deleteError) throw deleteError;
    created = created.filter((id) => id !== referrer);
    const orphan = await referralRowFor(referred);
    expect(orphan?.id, "the referral row outlives its referrer (0209)").toBe(before?.id);

    await expect(activate(referred), "the friend's save must not fail").resolves.toBeUndefined();

    const row = await referralRowFor(referred);
    expect(row?.status).toBe("activated");
    expect(row?.reward_credits_referrer).toBe(0);
    expect(row?.reward_withheld_reason).toBe("referrer_deleted");
  });
});

describe("0215 — the activation claim is atomic", () => {
  it("MECHANISM: the UPDATE ... WHERE status = 'signed_up' is the claim, so concurrent activations of one referral pay EXACTLY ONCE", async () => {
    const referrer = await makeUser(gmail("race-r"));
    const code = await referralCodeOf(referrer);
    const referred = await makeUser(gmail("race-b"), { referred_by_code: code });
    await activate(referred); // a real activation, so the friend genuinely qualifies
    const referral = await referralRowFor(referred);

    // Put the referral back to "signed up, nothing paid" so several callers can race for the same activation.
    await admin.from("credit_ledger").delete().eq("user_id", referrer).eq("related_entity_id", referral!.id);
    await admin.from("referral_reward_events").delete().eq("referral_id", referral!.id);
    await admin.from("profiles").update({ credits_balance: 0 }).eq("id", referrer);
    await admin
      .from("referrals")
      .update({ status: "signed_up", activated_at: null, reward_credits_referrer: 0, reward_withheld_reason: null })
      .eq("id", referral!.id);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => admin.rpc("check_and_activate_referral", { p_user_id: referred })),
    );
    for (const r of results) expect(r.error, "a racing caller must not error").toBeNull();

    const paid = (await ledgerFor(referrer)).filter((l) => l.related_entity_id === referral!.id);
    expect(paid, "RACE: the reward was paid more than once (or not at all)").toHaveLength(1);
    expect(paid[0].delta).toBe(REFERRAL_REWARD_CREDITS);
    expect(await balanceOf(referrer)).toBe(REFERRAL_REWARD_CREDITS);
    expect((await referralRowFor(referred))?.reward_credits_referrer).toBe(REFERRAL_REWARD_CREDITS);
  }, 60_000);
});

describe("0215 — a referrer's payout failure never fails the friend's action; the next qualifying event retries it, and the referrer is paid exactly once", () => {
  /*
   * WHAT RETRIES. Nothing schedules a retry. check_and_activate_referral is called by exactly two triggers, resumes_check_activation (AFTER INSERT OR UPDATE
   * OF is_base) and applications_check_activation (AFTER INSERT OR UPDATE OF applied_at), so the NEXT base-resume save or application re-runs it. Before the
   * owner's decision (2026-10-03) a failing grant raised inside the friend's own statement and FAILED THE FRIEND'S SAVE OR APPLICATION, so a seeker could be
   * unable to apply because of something on the referrer's side. Now the claim-and-grant step runs in its own subtransaction: on any error it rolls back (the
   * referral stays 'signed_up', nothing is paid), a WARNING names the referral and the SQLSTATE, and the friend's statement succeeds.
   *
   * The failure is produced with real data, no test hook: a balance at the integer ceiling makes `credits_balance + 50` overflow (22003) in grant_credits_atomic.
   */
  const CEILING = 2147483647;

  async function referredPair(tag: string) {
    const referrer = await makeUser(gmail(`${tag}-r`));
    const code = await referralCodeOf(referrer);
    const referred = await makeUser(gmail(`${tag}-b`), { referred_by_code: code });
    return { referrer, referred };
  }

  it("resume: the friend's save SUCCEEDS while the grant fails (0 paid, still signed_up), the next save pays exactly once, and a later event pays nothing more", async () => {
    const { referrer, referred } = await referredPair("retry-resume");
    const referral = await referralRowFor(referred);
    await admin.from("profiles").update({ credits_balance: CEILING }).eq("id", referrer);

    const saved = await admin.from("resumes").insert({ user_id: referred, title: "Base", is_base: true, source: "uploaded", structured_content: {} });
    expect(saved.error, "the friend's resume save must not fail because the referrer's payout failed").toBeNull();
    const kept = await admin.from("resumes").select("id").eq("user_id", referred);
    expect(kept.data, "the friend's resume was saved").toHaveLength(1);

    const after = await referralRowFor(referred);
    expect(after?.status, "the claim rolled back with the failed grant").toBe("signed_up");
    expect(after?.reward_credits_referrer).toBe(0);
    expect(after?.reward_withheld_reason, "a failed grant is not a withheld reward").toBeNull();
    expect((await ledgerFor(referrer)).filter((l) => l.related_entity_id === referral!.id)).toHaveLength(0);

    // The cause goes away; the friend's NEXT save (the trigger fires on any update of is_base) retries.
    await admin.from("profiles").update({ credits_balance: 0 }).eq("id", referrer);
    const resave = await admin.from("resumes").update({ is_base: true }).eq("user_id", referred);
    expect(resave.error).toBeNull();
    const paid = (await ledgerFor(referrer)).filter((l) => l.related_entity_id === referral!.id);
    expect(paid, "paid exactly once by the retry").toHaveLength(1);
    expect(paid[0].delta).toBe(REFERRAL_REWARD_CREDITS);
    expect((await referralRowFor(referred))?.status).toBe("activated");

    await admin.from("resumes").update({ is_base: false }).eq("user_id", referred);
    await admin.from("resumes").update({ is_base: true }).eq("user_id", referred);
    expect((await ledgerFor(referrer)).filter((l) => l.related_entity_id === referral!.id), "a later event pays nothing more").toHaveLength(1);
    expect(await balanceOf(referrer)).toBe(REFERRAL_REWARD_CREDITS);
  }, 60_000);

  it("application: the friend's application SUCCEEDS while the grant fails, the next application save pays exactly once, and a later event pays nothing more", async () => {
    const { referrer, referred } = await referredPair("retry-apply");
    const referral = await referralRowFor(referred);
    await admin.from("profiles").update({ credits_balance: CEILING }).eq("id", referrer);

    const applied = await admin
      .from("applications")
      .insert({
        user_id: referred,
        manual_job_snapshot: { companyName: "Retry Test Ltd", title: "Analyst" },
        stage: "applied",
        source: "manual",
        applied_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    expect(applied.error, "the friend's application must not fail because the referrer's payout failed").toBeNull();

    const after = await referralRowFor(referred);
    expect(after?.status).toBe("signed_up");
    expect(after?.reward_credits_referrer).toBe(0);
    expect((await ledgerFor(referrer)).filter((l) => l.related_entity_id === referral!.id)).toHaveLength(0);

    await admin.from("profiles").update({ credits_balance: 0 }).eq("id", referrer);
    const again = await admin.from("applications").update({ applied_at: new Date().toISOString() }).eq("id", applied.data!.id);
    expect(again.error).toBeNull();
    expect((await ledgerFor(referrer)).filter((l) => l.related_entity_id === referral!.id), "paid exactly once").toHaveLength(1);
    expect((await referralRowFor(referred))?.status).toBe("activated");

    await admin.from("applications").update({ applied_at: new Date().toISOString() }).eq("id", applied.data!.id);
    expect((await ledgerFor(referrer)).filter((l) => l.related_entity_id === referral!.id), "a later event pays nothing more").toHaveLength(1);
    expect(await balanceOf(referrer)).toBe(REFERRAL_REWARD_CREDITS);
  }, 60_000);
});

/** Probed at collection time (a describe callback cannot await): is `profiles.deletion_requested_at` there yet? See the test that uses it. */
const probe = await admin.from("profiles").select("deletion_requested_at").limit(1);
const pendingFlagExists = probe.error?.code !== "42703";

describe("0215 — 'referrer_deleted' means the referrer is actually gone, not pending deletion", () => {
  it("a referrer who still has a profile (referrer_id set) is paid normally, whatever else is true of their account", async () => {
    // The rule (owner, 2026-10-03): only a null referrer_id (hard-deleted) is 'referrer_deleted'. Today the only way a referrer differs is by having a profile or
    // not, so this pins the half that is testable now: with referrer_id set the referral is paid in full and records no reason.
    const referrer = await makeUser(gmail("pending-r"));
    const code = await referralCodeOf(referrer);
    const referred = await makeUser(gmail("pending-b"), { referred_by_code: code });
    await activate(referred);
    const row = await referralRowFor(referred);
    const { data: owner } = await admin.from("referrals").select("referrer_id").eq("referred_user_id", referred).single();
    expect(owner?.referrer_id).toBe(referrer);
    expect(row?.reward_credits_referrer).toBe(REFERRAL_REWARD_CREDITS);
    expect(row?.reward_withheld_reason).toBeNull();
  });

  /*
   * Runs ONLY once `profiles.deletion_requested_at` exists (account deletion, ACCT-1 PR 1, migration 0212, branch feat/acct-1-delete-request; set only inside
   * account_deletion_confirm(), cleared only inside account_deletion_restore()). Until then the column is not there to set, so the test skips itself, and it starts
   * running with no edit the day 0212 is on main. PostgREST cannot read information_schema, so the column's existence is probed with a select: an undefined column
   * answers 42703, anything else means it is there. S3-21 confirmed neither their purge nor their restore keys a referral on the flag.
   */
  it.skipIf(!pendingFlagExists)(
    "a referrer who is PENDING deletion (profiles.deletion_requested_at set, still able to restore) is paid normally",
    async () => {
      const referrer = await makeUser(gmail("pending-flag-r"));
      const code = await referralCodeOf(referrer);
      const referred = await makeUser(gmail("pending-flag-b"), { referred_by_code: code });
      const marked = await admin.from("profiles").update({ deletion_requested_at: new Date().toISOString() } as never).eq("id", referrer);
      expect(marked.error, "the flag could not be set: 0212 changed how it is written, update this test").toBeNull();

      await activate(referred);

      const row = await referralRowFor(referred);
      expect(row?.status).toBe("activated");
      expect(row?.reward_credits_referrer).toBe(REFERRAL_REWARD_CREDITS);
      expect(row?.reward_withheld_reason, "pending deletion is not 'referrer_deleted'").toBeNull();
      expect(await balanceOf(referrer)).toBe(REFERRAL_REWARD_CREDITS);
    },
    60_000,
  );
});
