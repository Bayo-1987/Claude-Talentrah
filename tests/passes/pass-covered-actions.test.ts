/**
 * The six pass-covered actions actually proceed at zero credit spend when a
 * user holds an active pass, fall back to the normal credit gate once it
 * expires, and — the specific bug Part A rules out — never consume the
 * one-time free trial for a pass-covered tailoring or cover-letter run.
 *
 * LLM calls are mocked (rewriteBullet, checkEligibility,
 * draftPersonalStatement) — there is no way to make a real provider return
 * a controlled result, and this suite is about the credit gate, not model
 * output. Auto-Apply and tailoring/cover-letter are covered by their own
 * sibling files (auto-apply-pass-coverage.test.ts, tailoring gate is tested
 * directly here since checkTailoringAllowance/commitTailoringAllowance take
 * a userId parameter and need no session mock at all).
 *
 * The Server Actions here (rewriteBulletAction, runEligibilityCheckAction,
 * draftSopAction) call createClient() from "@/lib/supabase/server", which
 * needs next/headers' cookies() — mocked to return a REAL, RLS-honouring
 * session (tests/support/auth.ts's sessionFor(), the same JWT-minting
 * helper the RLS suites use to avoid verifyOtp's rate limit) rather than a
 * bare {auth: {getUser}} stub, because these actions also read
 * profiles.credits_balance through that same client and a stub client
 * would either fail outright or (worse) silently answer as `anon` under
 * RLS — see sessionFor()'s own header for why that specific failure mode
 * is the one to guard against.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { admin, createTestUser, deleteTestUsers, sessionFor, type DB } from "../support/auth";
import { checkTailoringAllowance, commitTailoringAllowance } from "@/lib/tailoring/gate";
import { PASS_DAILY_ACTION_CAP } from "@/lib/passes/entitlement";

const rewriteBullet = vi.hoisted(() => vi.fn(async () => "Rewritten bullet."));
const checkEligibility = vi.hoisted(() =>
  vi.fn(async () => ({ verdict: "eligible", summary: "ok", criteria: [], suggestedNextSteps: [] })),
);
const draftPersonalStatement = vi.hoisted(() => vi.fn(async () => "A drafted personal statement."));

vi.mock("@/lib/farah/rewrite-bullet", () => ({ rewriteBullet }));
vi.mock("@/lib/scholarships/farah", async () => {
  const actual = await vi.importActual<typeof import("@/lib/scholarships/farah")>("@/lib/scholarships/farah");
  return { ...actual, checkEligibility, draftPersonalStatement };
});

const testClientRef = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => testClientRef.current,
}));

// revalidatePath needs an active Next.js request/static-generation context
// ("Invariant: static generation store missing") that a plain vitest run
// never has — irrelevant to the credit gate under test, so stubbed out
// rather than worked around.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { rewriteBulletAction, unlockTemplateAction } = await import("@/lib/resume-builder/actions");
const { runEligibilityCheckAction, draftSopAction } = await import("@/lib/scholarships/actions");

let userId: string;
let userEmail: string;
let passId: string;
let scholarshipId: string;

beforeAll(async () => {
  const user = await createTestUser("passcovered");
  userId = user.id;
  userEmail = user.email;
  testClientRef.current = await sessionFor(userEmail, userId);

  const { data: pass, error: passErr } = await admin.from("passes").select("id").limit(1).single();
  if (passErr || !pass) throw new Error("No passes seeded — run `npm run seed`.");
  passId = pass.id;

  const { data: scholarship, error: schErr } = await admin
    .from("scholarships")
    .select("id")
    .eq("moderation_status", "verified")
    .limit(1)
    .single();
  if (schErr || !scholarship) throw new Error("No verified scholarships seeded — run `npm run seed`.");
  scholarshipId = scholarship.id;

  // A base resume — both scholarship actions load one, and its absence
  // would fail with an unrelated error before the gate under test even runs.
  await admin.from("resumes").insert({
    user_id: userId,
    is_base: true,
    title: "Base",
    structured_content: { experience: [] },
  });
}, 60_000);

afterAll(async () => {
  if (userId) {
    await admin.from("resumes").delete().eq("user_id", userId).eq("is_base", true);
    await deleteTestUsers([userId]);
  }
}, 60_000);

const createdPassRows: string[] = [];

async function givePass(expiresInMs: number) {
  const { data, error } = await admin
    .from("user_passes")
    .insert({
      user_id: userId,
      pass_id: passId,
      expires_at: new Date(Date.now() + expiresInMs).toISOString(),
      payment_method: "card",
      status: "active",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture pass: ${error?.message}`);
  createdPassRows.push(data.id);
}

async function setBalance(amount: number) {
  await admin.from("profiles").update({ credits_balance: amount }).eq("id", userId);
}

async function balance(): Promise<number> {
  const { data } = await admin.from("profiles").select("credits_balance").eq("id", userId).single();
  return data?.credits_balance ?? 0;
}

async function ledgerCountFor(reason: string): Promise<number> {
  const { count } = await admin
    .from("credit_ledger")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("reason", reason as never);
  return count ?? 0;
}

afterEach(async () => {
  if (createdPassRows.length) {
    await admin.from("user_passes").delete().in("id", createdPassRows);
    createdPassRows.length = 0;
  }
  await admin.from("credit_ledger").delete().eq("user_id", userId);
  // Every pass-covered test writes a credit_gate_events row, and the daily
  // cap (checkPassCoverage) counts exactly those — without clearing them
  // between tests, an EARLIER test's covered action stays in the rolling
  // 24h window and silently eats into a LATER test's cap budget.
  await admin.from("credit_gate_events").delete().eq("user_id", userId);
  await admin
    .from("profiles")
    .update({ free_trial_tailoring_used: false, free_trial_cover_letter_used: false })
    .eq("id", userId);
  vi.clearAllMocks();
});

describe("bullet rewrite", () => {
  it("an active pass proceeds at zero credit spend", async () => {
    await givePass(60 * 60 * 1000);
    await setBalance(0); // would fail on credits alone — proves the pass, not a spare balance, covered this
    const result = await rewriteBulletAction("Did some things.", "impact");
    expect(result.error).toBeUndefined();
    expect(result.text).toBe("Rewritten bullet.");
    expect(await balance()).toBe(0);
    expect(await ledgerCountFor("bullet_rewrite")).toBe(0);
  });

  it("an expired pass falls back to the normal credit gate", async () => {
    await givePass(-60 * 60 * 1000); // expired
    await setBalance(0);
    const result = await rewriteBulletAction("Did some things.", "impact");
    expect(result.error, "MONEY BUG: an expired pass still covered the action for free").toContain(
      "Not enough credits",
    );
  });

  it("with credits and no pass, spends normally (unaffected baseline)", async () => {
    await setBalance(10);
    const result = await rewriteBulletAction("Did some things.", "impact");
    expect(result.error).toBeUndefined();
    expect(await balance()).toBe(8); // 10 - CREDIT_COSTS.bulletRewrite (2)
  });
});

describe("scholarship eligibility check", () => {
  it("an active pass proceeds at zero credit spend", async () => {
    await givePass(60 * 60 * 1000);
    await setBalance(0);
    const result = await runEligibilityCheckAction(scholarshipId);
    expect(result.error).toBeUndefined();
    expect(result.result).toBeDefined();
    expect(await balance()).toBe(0);
    expect(await ledgerCountFor("scholarship_eligibility_check")).toBe(0);
  });

  it("an expired pass falls back to credits", async () => {
    await givePass(-1000);
    await setBalance(0);
    const result = await runEligibilityCheckAction(scholarshipId);
    expect(result.error).toContain("Not enough credits");
  });
});

describe("scholarship SOP draft", () => {
  it("an active pass proceeds at zero credit spend", async () => {
    await givePass(60 * 60 * 1000);
    await setBalance(0);
    const result = await draftSopAction(scholarshipId, "I want to study abroad.");
    expect(result.error).toBeUndefined();
    expect(result.statement).toBe("A drafted personal statement.");
    expect(await balance()).toBe(0);
    expect(await ledgerCountFor("scholarship_sop_draft")).toBe(0);
  });

  it("an expired pass falls back to credits", async () => {
    await givePass(-1000);
    await setBalance(0);
    const result = await draftSopAction(scholarshipId, "I want to study abroad.");
    expect(result.error).toContain("Not enough credits");
  });
});

describe("tailoring and cover letter — via the gate functions directly", () => {
  it("tailoring: an active pass proceeds at zero spend, free trial NOT consumed", async () => {
    await givePass(60 * 60 * 1000);
    await setBalance(0);
    const allowance = await checkTailoringAllowance(userId, "tailoring");
    expect(allowance.isPassCovered).toBe(true);
    expect(allowance.isFreeTrial).toBe(false);
    expect(allowance.creditsSpent).toBe(0);

    await commitTailoringAllowance(userId, "tailoring", allowance);

    expect(await balance()).toBe(0);
    const { data: profile } = await admin
      .from("profiles")
      .select("free_trial_tailoring_used")
      .eq("id", userId)
      .single();
    expect(
      profile?.free_trial_tailoring_used,
      "MONEY BUG: a pass-covered run consumed the one-time free trial",
    ).toBe(false);
  });

  it("cover letter: an active pass proceeds at zero spend, free trial NOT consumed", async () => {
    await givePass(60 * 60 * 1000);
    await setBalance(0);
    const allowance = await checkTailoringAllowance(userId, "cover_letter");
    expect(allowance.isPassCovered).toBe(true);
    await commitTailoringAllowance(userId, "cover_letter", allowance);

    const { data: profile } = await admin
      .from("profiles")
      .select("free_trial_cover_letter_used")
      .eq("id", userId)
      .single();
    expect(profile?.free_trial_cover_letter_used).toBe(false);
  });

  it("without a pass, the free trial still works exactly as before (unaffected baseline)", async () => {
    await setBalance(0);
    const allowance = await checkTailoringAllowance(userId, "tailoring");
    expect(allowance.isFreeTrial).toBe(true);
    expect(allowance.isPassCovered).toBe(false);
    await commitTailoringAllowance(userId, "tailoring", allowance);
    const { data: profile } = await admin
      .from("profiles")
      .select("free_trial_tailoring_used")
      .eq("id", userId)
      .single();
    expect(profile?.free_trial_tailoring_used).toBe(true);
  });

  it("an expired pass with the free trial already used falls back to credits", async () => {
    await givePass(-1000);
    await admin.from("profiles").update({ free_trial_tailoring_used: true }).eq("id", userId);
    await setBalance(0);
    await expect(checkTailoringAllowance(userId, "tailoring")).rejects.toThrow(/credits/i);
  });
});

describe("template unlock — deliberately NOT pass-covered (Part A)", () => {
  it("an active pass does not cover it — still needs credits", async () => {
    const { data: template, error } = await admin
      .from("resume_templates")
      .select("id, unlock_cost_credits")
      .eq("is_premium", true)
      .limit(1)
      .single();
    if (error || !template) throw new Error("No premium template seeded — run `npm run seed`.");

    await givePass(60 * 60 * 1000);
    await setBalance(0);
    await admin.from("user_template_unlocks").delete().eq("user_id", userId).eq("template_id", template.id);

    const result = await unlockTemplateAction(template.id);
    expect(
      result.ok,
      "MONEY BUG: an active pass covered a template unlock, which Part A explicitly excludes",
    ).toBe(false);
    expect(result.error).toContain("Not enough credits");

    await setBalance(template.unlock_cost_credits);
    const withCredits = await unlockTemplateAction(template.id);
    expect(withCredits.ok, "sanity: paying the real cost must still unlock it").toBe(true);
    expect(await balance()).toBe(0);

    await admin.from("user_template_unlocks").delete().eq("user_id", userId).eq("template_id", template.id);
  });
});

describe("the daily fair-use cap hitting mid-session falls back to credits, with the non-punitive message", () => {
  it(`the ${PASS_DAILY_ACTION_CAP + 1}th action of the day is not covered, and (with no credits) explains the cap without implying the pass is exhausted`, async () => {
    await givePass(60 * 60 * 1000);
    await setBalance(0);

    for (let i = 0; i < PASS_DAILY_ACTION_CAP; i++) {
      const result = await rewriteBulletAction("Did some things.", "impact");
      expect(result.error, `action ${i + 1} of ${PASS_DAILY_ACTION_CAP} should be covered`).toBeUndefined();
    }

    const capped = await rewriteBulletAction("Did some things.", "impact");
    expect(capped.error, "the cap must actually stop coverage").toBeDefined();
    expect(capped.error).toContain("fair-use limit");
    expect(
      capped.error?.toLowerCase(),
      "must NOT imply the pass itself is exhausted",
    ).not.toMatch(/pass (is )?(exhausted|expired|used up)/);
  }, 120_000);
});
