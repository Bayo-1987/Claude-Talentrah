/**
 * send-368 — "Draft with Farah", the Server Action layer
 * (src/lib/employer/draft-job-action.ts). Same recipe as
 * tests/employer/job-posting-skills.test.ts: `@/lib/supabase/server`'s
 * createClient() is mocked to a real, RLS-honouring session
 * (tests/support/auth.ts's sessionFor()), so requireEmployer() resolves a
 * genuine organisation through the real 0026/0027 policies — not a stub.
 * `@/lib/llm` is mocked the same way as tests/screening/farah-review-llm-
 * failure.test.ts and tests/employer/draft-job.test.ts, so no real model call
 * or API budget is needed to prove the money/reversal contract.
 *
 * ONE employer identity and ONE organisation for the whole file (the same
 * job-posting-skills.test.ts constraint — requireUser's cache() degrades to
 * an unscoped module-level memo outside a real request, so a second distinct
 * employer would silently resolve back to the first). The wallet balance is
 * reset directly via the admin client between tests instead.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, sessionFor, type DB } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";
import { inferSeniority, inferWorkType, extractStructuredJd } from "@/lib/jobs/extract-jd";
import { FARAH_JD_DRAFT_NGN } from "@/lib/billing/catalog";

const generateText = vi.fn();
const fakeProvider = { name: "test" as const, model: "test", generateText, generateWithUsage: vi.fn() };

vi.mock("@/lib/llm", () => ({
  getLLMProvider: () => fakeProvider,
  generateWithFailover: (call: (p: typeof fakeProvider) => Promise<string>) => call(fakeProvider),
  LLMProviderError: class LLMProviderError extends Error {
    constructor(
      public provider: string,
      public kind: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

const testClientRef = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => testClientRef.current,
}));

const { draftJobWithFarahAction } = await import("@/lib/employer/draft-job-action");

const VALID_DRAFT_JSON = JSON.stringify({
  roleSummary: "We're hiring a Backend Engineer to own our payments API.",
  responsibilities: ["Design REST endpoints", "Own on-call rotation"],
  requirements: ["3+ years Node.js", "Postgres experience"],
  preferred: ["AWS experience"],
  suggestedEmploymentType: "full_time",
  suggestedYearsExperienceMin: 3,
});

let userId: string;
let userEmail: string;
let orgId: string;

async function setWalletBalance(balanceNgn: number | null) {
  if (balanceNgn === null) {
    // Simulates a genuinely fresh org that has never had a wallet row at
    // all — debit_ad_wallet's own "no row updated" branch is what a
    // zero-balance org actually hits, not a row with balance_ngn = 0.
    await admin.from("ad_wallets").delete().eq("organization_id", orgId);
    return;
  }
  const { error } = await admin
    .from("ad_wallets")
    .upsert({ organization_id: orgId, balance_ngn: balanceNgn }, { onConflict: "organization_id" });
  if (error) throw new Error(`fixture wallet: ${error.message}`);
}

async function currentBalance(): Promise<number> {
  const { data } = await admin.from("ad_wallets").select("balance_ngn").eq("organization_id", orgId).maybeSingle();
  return data?.balance_ngn ?? 0;
}

async function ledgerReasons(): Promise<string[]> {
  const { data } = await admin
    .from("ad_wallet_ledger")
    .select("reason, delta_ngn")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });
  return (data ?? []).map((row) => `${row.reason}:${row.delta_ngn}`);
}

async function clearLedger() {
  await admin.from("ad_wallet_ledger").delete().eq("organization_id", orgId);
}

beforeAll(async () => {
  const user = await createTestUser("draftjob");
  userId = user.id;
  userEmail = user.email;
  testClientRef.current = await sessionFor(userEmail, userId);

  const orgName = `DRAFTJOB-TEST-${randomUUID()}`;
  const { data: org, error: orgError } = await testClientRef.current
    .from("organizations")
    .insert({ name: orgName, domain: "draftjob-test.example", created_by: userId })
    .select("id")
    .single();
  if (orgError || !org) throw new Error(`fixture org: ${orgError?.message}`);
  orgId = org.id;

  const { error: memberError } = await testClientRef.current
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: userId, role: "owner" });
  if (memberError) throw new Error(`fixture membership: ${memberError.message}`);
}, 60_000);

afterEach(async () => {
  generateText.mockReset();
  await clearLedger();
});

afterAll(async () => {
  if (orgId) {
    await admin.from("ad_wallet_ledger").delete().eq("organization_id", orgId);
    await admin.from("ad_wallets").delete().eq("organization_id", orgId);
    await admin.from("organization_members").delete().eq("organization_id", orgId);
    await deleteTestOrgs([orgId]);
  }
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

describe("draftJobWithFarahAction — insufficient balance refuses BEFORE any LLM call", () => {
  it("a genuinely fresh org with no ad_wallets row at all is refused, and the provider is never invoked", async () => {
    await setWalletBalance(null);

    const result = await draftJobWithFarahAction({ title: "Backend Engineer", location: "Lagos, Nigeria" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("insufficient_balance");
      // send-437 — the discriminant alone doesn't pin the copy: this must
      // actually state the real, current cost, not a silent "top up and
      // find out." Pulled from FARAH_JD_DRAFT_NGN itself, not hardcoded, so
      // this keeps passing (correctly) if that price ever changes and only
      // fails if the message stops including whatever it currently is.
      expect(result.error).toContain(`₦${FARAH_JD_DRAFT_NGN.toLocaleString("en-NG")}`);
    }
    expect(generateText).not.toHaveBeenCalled();
  });

  it("an org with an existing wallet row but a balance below the charge is refused the same way", async () => {
    await setWalletBalance(FARAH_JD_DRAFT_NGN - 1);

    const result = await draftJobWithFarahAction({ title: "Backend Engineer", location: "Lagos, Nigeria" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("insufficient_balance");
    expect(generateText).not.toHaveBeenCalled();
    // Refused, not partially debited.
    expect(await currentBalance()).toBe(FARAH_JD_DRAFT_NGN - 1);
  });
});

describe("draftJobWithFarahAction — a funded org's real debit/credit calls", () => {
  it("a successful draft debits the wallet by exactly FARAH_JD_DRAFT_NGN, via a real ledger row", async () => {
    await setWalletBalance(1000);
    generateText.mockResolvedValue(VALID_DRAFT_JSON);

    const result = await draftJobWithFarahAction({ title: "Backend Engineer", location: "Lagos, Nigeria" });

    expect(result.ok).toBe(true);
    expect(await currentBalance()).toBe(1000 - FARAH_JD_DRAFT_NGN);
    expect(await ledgerReasons()).toEqual([`farah_jd_draft_charge:-${FARAH_JD_DRAFT_NGN}`]);
  });

  it("a simulated LLM throw reverses the charge end-to-end — the wallet balance ends exactly where it started", async () => {
    await setWalletBalance(1000);
    generateText.mockRejectedValue(new Error("Groq is down"));

    const result = await draftJobWithFarahAction({ title: "Backend Engineer", location: "Lagos, Nigeria" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("generation_error");

    // The real proof: not just "an error was returned" but that the debit
    // AND its reversal both actually happened and net to zero.
    expect(await currentBalance()).toBe(1000);
    expect(await ledgerReasons()).toEqual([
      `farah_jd_draft_charge:-${FARAH_JD_DRAFT_NGN}`,
      `reversal:${FARAH_JD_DRAFT_NGN}`,
    ]);
  });

  it("an unparsable LLM response is treated the same as a throw — reversed, two distinct failure messages exist", async () => {
    await setWalletBalance(1000);
    generateText.mockResolvedValue(JSON.stringify({ responsibilities: [], requirements: [] }));

    const generationResult = await draftJobWithFarahAction({ title: "Backend Engineer", location: "Lagos, Nigeria" });
    expect(generationResult.ok).toBe(false);
    if (!generationResult.ok) expect(generationResult.kind).toBe("generation_error");
    expect(await currentBalance()).toBe(1000);

    await clearLedger();
    await setWalletBalance(0);
    const balanceResult = await draftJobWithFarahAction({ title: "Backend Engineer", location: "Lagos, Nigeria" });
    expect(balanceResult.ok).toBe(false);
    if (!balanceResult.ok) {
      expect(balanceResult.kind).toBe("insufficient_balance");
      // The two failure kinds carry genuinely different copy, not one
      // generic message reused for both.
      if (!generationResult.ok) expect(balanceResult.error).not.toBe(generationResult.error);
    }
  });
});

describe("draftJobWithFarahAction — real, imported inference functions, never reimplemented", () => {
  it("seniority/workType/skills exactly match calling inferSeniority/inferWorkType/extractStructuredJd directly on the same output", async () => {
    await setWalletBalance(1000);
    generateText.mockResolvedValue(VALID_DRAFT_JSON);

    const title = "Senior Backend Engineer";
    const location = "Remote, Nigeria";
    const result = await draftJobWithFarahAction({ title, location });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // These are computed from the SAME title/location/description the
    // action itself used — if the action reimplemented this logic instead
    // of calling the real functions, a divergence would show up here.
    expect(result.seniority).toBe(inferSeniority(title) ?? null);
    expect(result.workType).toBe(inferWorkType(title, location) ?? null);
    expect(result.skills).toEqual(extractStructuredJd(result.description).skills);
  });

  it("never reads, writes, or returns anything salary-related, under any input", async () => {
    await setWalletBalance(1000);
    generateText.mockResolvedValue(VALID_DRAFT_JSON);

    const result = await draftJobWithFarahAction({ title: "Backend Engineer", location: "Lagos, Nigeria" });

    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty("salaryMin");
    expect(result).not.toHaveProperty("salaryMax");
    expect(result).not.toHaveProperty("salaryCurrency");
    expect(JSON.stringify(result)).not.toMatch(/salary/i);
  });

  it("a blank title is refused locally, before requireEmployer or any wallet call", async () => {
    await setWalletBalance(1000);
    const result = await draftJobWithFarahAction({ title: "   ", location: "" });
    expect(result.ok).toBe(false);
    expect(generateText).not.toHaveBeenCalled();
    // Wallet untouched — this is a pure input-validation refusal.
    expect(await currentBalance()).toBe(1000);
  });
});
