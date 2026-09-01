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
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { listUsersWithPrefix, RUN_TAG } from "../support/list-users";

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
    .select("id, status, reward_credits_referrer, activated_at")
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
    return {
      referrer,
      referred,
      row: await referralRowFor(referred),
      paid: (await ledgerFor(referrer)).some((l) => l.reason === "referral_signup_bonus"),
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
    expect(result.paid, "a legitimate referral must be paid its signup bonus").toBe(true);
    expect(result.balance).toBe(5);
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
      delta: 5,
      reason: "referral_signup_bonus" as const,
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

    // 9 already rewarded → the next one is the 10th and must pay.
    await seedRewardedReferrals(referrer, 9);
    await makeUser(gmail("cap-10"), { referred_by_code: code });

    let bonuses = (await ledgerFor(referrer)).filter((l) => l.reason === "referral_signup_bonus");
    expect(bonuses.length, "the 10th referral should still be rewarded").toBe(10);

    // Now 10 are rewarded → the 11th must be blocked.
    await makeUser(gmail("cap-11"), { referred_by_code: code });
    bonuses = (await ledgerFor(referrer)).filter((l) => l.reason === "referral_signup_bonus");
    expect(bonuses.length, "CAP BREACH: an 11th referral was rewarded inside the window").toBe(10);
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
    await makeUser(gmail("roll-new"), { referred_by_code: code });

    const fresh = (await ledgerFor(referrer)).filter(
      (l) => l.reason === "referral_signup_bonus" && Date.now() - new Date(l.created_at).getTime() < 86_400_000,
    );
    expect(
      fresh.length,
      "rewards older than 30 days must age out of the cap window",
    ).toBe(1);
  });

  it("a capped-out referral is still marked activated, with a zero reward and no signal", async () => {
    /*
     * DOCUMENTING CURRENT BEHAVIOUR, NOT ENDORSING IT — flagged to the founder
     * in docs/referrals-open-questions.md.
     *
     * grant_referral_reward returns silently when the cap is hit, but
     * check_and_activate_referral marks the referral 'activated' BEFORE calling
     * it. So the row ends up "Activated" while the activation bonus was never
     * paid, and nothing ever retries it once the window clears, because the
     * status is no longer 'signed_up'.
     *
     * CORRECTION TO THE ORIGINAL BRIEF, measured here: the row does not show a
     * reward of 0. It shows 5 — the signup bonus, which was paid before the
     * window filled — and is simply missing the 20 it should have gained on
     * activation. That is arguably worse than a visible zero: the referral
     * looks partly paid, so nothing about the row suggests anything was
     * withheld. The founder-facing question is unchanged and is written up in
     * docs/referrals-open-questions.md.
     */
    const referrer = await makeUser(gmail("capped-r"));
    const code = await referralCodeOf(referrer);
    const referredEmail = gmail("capped-b");
    const referred = await makeUser(referredEmail, { referred_by_code: code });

    // Fill the window AFTER the signup bonus, so activation is the capped half.
    await seedRewardedReferrals(referrer, 10);

    // Activate by giving the referred user a base resume.
    await admin.from("resumes").insert({
      user_id: referred,
      title: "Base",
      is_base: true,
      source: "uploaded",
      structured_content: {},
    });
    await new Promise((r) => setTimeout(r, 1200));

    const row = await referralRowFor(referred);
    const activationBonuses = (await ledgerFor(referrer)).filter(
      (l) => l.reason === "referral_activation_bonus",
    );

    expect(row?.status, "the referral is marked activated regardless of the cap").toBe("activated");
    expect(activationBonuses.length, "the activation bonus is silently withheld").toBe(0);
    expect(
      row?.reward_credits_referrer,
      "the row keeps its signup bonus and silently lacks the activation bonus",
    ).toBe(5);
  });

  it("excludes the referral being rewarded from its own cap count", async () => {
    /*
     * The subtle one. grant_referral_reward passes p_exclude_referral_id so a
     * referral's own signup bonus doesn't count against its later activation
     * bonus. Get that backwards and every referral caps itself out at the
     * activation step after 9 others — a silent halving of the programme.
     */
    const referrer = await makeUser(gmail("excl-r"));
    const code = await referralCodeOf(referrer);
    const referred = await makeUser(gmail("excl-b"), { referred_by_code: code });

    // 8 unrelated rewards + this referral's own signup bonus = 9 distinct.
    await seedRewardedReferrals(referrer, 8);

    await admin.from("resumes").insert({
      user_id: referred,
      title: "Base",
      is_base: true,
      source: "uploaded",
      structured_content: {},
    });
    await new Promise((r) => setTimeout(r, 1200));

    const activation = (await ledgerFor(referrer)).filter(
      (l) => l.reason === "referral_activation_bonus",
    );
    expect(
      activation.length,
      "the referral's own signup bonus must not count against its activation bonus",
    ).toBe(1);
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
    expect(after?.reward_credits_referrer, "MONEY: a referrer inflated their own reward").toBe(5);
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

describe("signup farming is bounded by the cap, not by friction", () => {
  it("rapid signups against one code stop paying at the cap", async () => {
    /*
     * The signup bonus needs NO activation — 5 credits for any resolved,
     * non-self code — and there is no signup rate limit, so the cap is the only
     * thing standing between a throwaway-address farm and unlimited credits.
     * Worth proving the cap actually holds under the pattern an attacker would
     * actually use, rather than the one-at-a-time pattern the other tests use.
     */
    const referrer = await makeUser(gmail("farm-r"));
    const code = await referralCodeOf(referrer);

    /*
     * The window is pre-filled to 8 with ledger rows rather than 8 more real
     * signups. An earlier version created 15 accounts here; combined with the
     * other suites that tripped Supabase Auth's rate limit in CI, which then
     * surfaced as unrelated assertion failures in other files whose fixture
     * users had silently failed to exist.
     *
     * The property under test is unchanged — four REAL signups still cross the
     * boundary, so two pay and two are refused, and the count still comes from
     * what the trigger actually wrote.
     */
    await admin.from("credit_ledger").insert(
      Array.from({ length: 8 }, () => ({
        user_id: referrer,
        delta: 5,
        reason: "referral_signup_bonus" as const,
        related_entity_id: randomUUID(),
        balance_after: 0,
        created_at: new Date().toISOString(),
      })),
    );

    for (let i = 0; i < 4; i++) {
      await makeUser(gmail(`farm-${i}`), { referred_by_code: code });
    }

    const bonuses = (await ledgerFor(referrer)).filter(
      (l) => l.reason === "referral_signup_bonus",
    );
    expect(
      bonuses.length,
      `FARMING: ${bonuses.length} signup bonuses recorded — the cap is 10`,
    ).toBe(10);
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
  it("leaves the referrer's credits intact but drops the referral row", async () => {
    /*
     * The cascade is testable today even though no in-app account deletion
     * exists, and data deletion is a named non-functional requirement, so this
     * WILL become reachable.
     *
     * The credits are right — the ledger has no FK to the referred user, so
     * nothing is clawed back. What goes wrong is the refer page's "credits
     * earned" figure, which is derived by summing the surviving `referrals`
     * rows: after a deletion it under-reports against the referrer's real
     * balance. Recorded so that discrepancy is a known consequence rather than
     * a mystery support ticket.
     */
    const referrer = await makeUser(gmail("del-r"));
    const code = await referralCodeOf(referrer);
    const referred = await makeUser(gmail("del-b"), { referred_by_code: code });
    expect(await balanceOf(referrer)).toBe(5);

    await admin.auth.admin.deleteUser(referred);
    created = created.filter((id) => id !== referred);

    expect(await balanceOf(referrer), "credits must not be clawed back").toBe(5);
    const { data: rows } = await admin
      .from("referrals")
      .select("id")
      .eq("referrer_id", referrer);
    expect(rows ?? [], "the referral row cascades away with the account").toHaveLength(0);

    const ledger = await ledgerFor(referrer);
    expect(
      ledger.filter((l) => l.reason === "referral_signup_bonus").length,
      "the ledger entry survives, which is why the derived figure under-reports",
    ).toBe(1);
  });
});
