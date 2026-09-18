/**
 * record_farah_screening_review (0176, send-345 Part B) — the atomic
 * money-and-record half of "Let Farah screen this for you." The LLM call
 * itself happens in the Server Action layer (tests/screening/
 * farah-review-llm-failure.test.ts covers that half); this file pins the
 * database function directly, the same "call the exact function the app
 * calls, don't reimplement it" discipline
 * tests/employer/applicant-filters-and-bulk-actions.test.ts's own bulk-
 * action suite uses.
 *
 * ── WHAT THIS FILE EXISTS TO PIN ──────────────────────────────────────────
 *
 *   1. A funded review debits the wallet, writes the ledger, and records
 *      farah_review_status='completed' + the given tier/summary — all in
 *      one call.
 *   2. An underfunded review takes NO money and records ONLY
 *      farah_review_status='skipped_insufficient_balance' — tier/summary
 *      stay null.
 *   3. Refused outright for a screening_mode='self' question — never
 *      charges, never writes anything.
 *   4. IDEMPOTENT: calling it a second time for the same
 *      (application_id, question_id) never re-charges and never overwrites
 *      what the first call already recorded — this is a REAL bug this
 *      function used to have (found empirically while building this
 *      feature, before this test existed): a naive second call would
 *      overwrite farah_review_status to 'skipped_insufficient_balance'
 *      while leaving the first call's farah_tier/farah_summary in place,
 *      a combination the table's own
 *      application_screening_answers_farah_tier_requires_completed_check
 *      constraint correctly refuses to let exist — so the naive version
 *      didn't silently corrupt data, it threw. Either way is wrong for a
 *      caller that retries; this test pins the actual fix (an
 *      existing-status guard) rather than just the constraint.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type TestUser } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";

const REVIEW_COST_NGN = 100;

type AuthedTestUser = Awaited<ReturnType<typeof createAuthedTestUser>>;

let orgOwner: AuthedTestUser;
let orgId: string;
let jobId: string;
let farahQuestionAId: string;
let farahQuestionBId: string;
let selfQuestionId: string;
let seeker: TestUser;
let applicationId: string;
const resumeIds: string[] = [];

async function setBalance(ngn: number) {
  const { error } = await admin.from("ad_wallets").update({ balance_ngn: ngn }).eq("organization_id", orgId);
  if (error) throw new Error(`fixture: set balance failed: ${error.message}`);
}

async function getAnswerRow(questionId: string) {
  const { data, error } = await admin
    .from("application_screening_answers")
    .select("farah_review_status, farah_tier, farah_summary")
    .eq("application_id", applicationId)
    .eq("question_id", questionId)
    .single();
  if (error) throw new Error(`fixture: read answer row failed: ${error.message}`);
  return data;
}

beforeAll(async () => {
  orgOwner = await createAuthedTestUser("farah-review-owner");
  seeker = await createAuthedTestUser("farah-review-seeker");

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `Farah Review Test Org ${randomUUID().slice(0, 8)}`, created_by: orgOwner.id, verified: true })
    .select("id")
    .single();
  if (orgErr || !org) throw new Error(`fixture org: ${orgErr?.message}`);
  orgId = org.id;

  const { error: memErr } = await admin
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: orgOwner.id, role: "owner" });
  if (memErr) throw new Error(`fixture membership: ${memErr.message}`);

  const { error: walletErr } = await admin.from("ad_wallets").insert({ organization_id: orgId, balance_ngn: 0 });
  if (walletErr) throw new Error(`fixture wallet: ${walletErr.message}`);

  const { data: job, error: jobErr } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: orgId,
      company_name: "Farah Review Test Co",
      title: `Farah Review Test Role ${randomUUID().slice(0, 8)}`,
      description: "Fixture posting for record_farah_screening_review.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
    })
    .select("id")
    .single();
  if (jobErr || !job) throw new Error(`fixture job: ${jobErr?.message}`);
  jobId = job.id;

  const { data: qA, error: qAErr } = await admin
    .from("job_posting_screening_questions")
    .insert({
      job_posting_id: jobId,
      question_text: "Why does this role interest you?",
      question_type: "free_text",
      required: false,
      sort_order: 0,
      screening_mode: "farah",
    })
    .select("id")
    .single();
  if (qAErr || !qA) throw new Error(`fixture question A: ${qAErr?.message}`);
  farahQuestionAId = qA.id;

  const { data: qB, error: qBErr } = await admin
    .from("job_posting_screening_questions")
    .insert({
      job_posting_id: jobId,
      question_text: "What would you bring to this team?",
      question_type: "free_text",
      required: false,
      sort_order: 1,
      screening_mode: "farah",
    })
    .select("id")
    .single();
  if (qBErr || !qB) throw new Error(`fixture question B: ${qBErr?.message}`);
  farahQuestionBId = qB.id;

  const { data: qSelf, error: qSelfErr } = await admin
    .from("job_posting_screening_questions")
    .insert({
      job_posting_id: jobId,
      question_text: "Years of experience?",
      question_type: "min_number",
      required: false,
      sort_order: 2,
      screening_mode: "self",
      min_value: 1,
    })
    .select("id")
    .single();
  if (qSelfErr || !qSelf) throw new Error(`fixture self-mode question: ${qSelfErr?.message}`);
  selfQuestionId = qSelf.id;

  const { data: resume, error: resumeErr } = await admin
    .from("resumes")
    .insert({
      user_id: seeker.id,
      structured_content: {
        contact: { name: "Farah Review Seeker" },
        summary: "Fixture resume.",
        experience: [],
        education: [],
        skills: [],
      },
    })
    .select("id")
    .single();
  if (resumeErr || !resume) throw new Error(`fixture resume: ${resumeErr?.message}`);
  resumeIds.push(resume.id);

  const { data: application, error: applicationErr } = await admin
    .from("applications")
    .insert({
      user_id: seeker.id,
      job_posting_id: jobId,
      resume_id: resume.id,
      stage: "applied",
      source: "internal_apply",
      applied_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (applicationErr || !application) throw new Error(`fixture application: ${applicationErr?.message}`);
  applicationId = application.id;

  const { error: answersErr } = await admin.from("application_screening_answers").insert([
    { application_id: applicationId, question_id: farahQuestionAId, answer_text: "Because I love it.", passed: true },
    { application_id: applicationId, question_id: farahQuestionBId, answer_text: "Deep expertise.", passed: true },
    { application_id: applicationId, question_id: selfQuestionId, answer_number: 3, passed: true },
  ]);
  if (answersErr) throw new Error(`fixture answers: ${answersErr.message}`);
}, 60_000);

afterAll(async () => {
  await admin.from("applications").delete().eq("id", applicationId);
  for (const id of resumeIds) await admin.from("resumes").delete().eq("id", id);
  await deleteOrgsCascade(admin, [orgId].filter(Boolean));
  await deleteTestUsers([orgOwner.id, seeker.id].filter(Boolean));
});

describe("record_farah_screening_review", () => {
  it("a funded review debits the wallet and records completed + tier + summary, atomically", async () => {
    await setBalance(250);

    const { data, error } = await admin.rpc("record_farah_screening_review", {
      p_application_id: applicationId,
      p_question_id: farahQuestionAId,
      p_tier: "strong",
      p_summary: "A specific, genuine answer.",
      p_amount_ngn: REVIEW_COST_NGN,
    });
    expect(error).toBeNull();
    const result = data?.[0];
    expect(result?.ok).toBe(true);
    expect(result?.status).toBe("completed");
    expect(result?.balance_after_ngn).toBe(150);

    const { data: wallet } = await admin.from("ad_wallets").select("balance_ngn").eq("organization_id", orgId).single();
    expect(wallet?.balance_ngn).toBe(150);

    const { data: ledgerRows } = await admin
      .from("ad_wallet_ledger")
      .select("delta_ngn, reason")
      .eq("organization_id", orgId)
      .eq("reason", "farah_screening_charge");
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows?.[0]?.delta_ngn).toBe(-REVIEW_COST_NGN);

    const answer = await getAnswerRow(farahQuestionAId);
    expect(answer.farah_review_status).toBe("completed");
    expect(answer.farah_tier).toBe("strong");
    expect(answer.farah_summary).toBe("A specific, genuine answer.");
  });

  it(
    "IDEMPOTENT: a second call for the same answer never re-charges and never overwrites the first result",
    async () => {
      // Balance is 150 from the previous test (this file runs its `it`s in
      // order); the second call below deliberately asks for a huge amount —
      // if the guard were missing, this would either fail the balance check
      // (a DIFFERENT bug than the one being pinned) or, worse, succeed and
      // silently overwrite a real result. Neither may happen: the existing
      // completed status must short-circuit before the debit is even
      // attempted.
      const before = await admin.from("ad_wallets").select("balance_ngn").eq("organization_id", orgId).single();

      const { data, error } = await admin.rpc("record_farah_screening_review", {
        p_application_id: applicationId,
        p_question_id: farahQuestionAId,
        p_tier: "weak",
        p_summary: "This must never overwrite the real result.",
        p_amount_ngn: 999_999,
      });
      expect(error).toBeNull();
      const result = data?.[0];
      // Reports the EXISTING result back, not a fresh attempt.
      expect(result?.ok).toBe(true);
      expect(result?.status).toBe("completed");

      const after = await admin.from("ad_wallets").select("balance_ngn").eq("organization_id", orgId).single();
      expect(after.data?.balance_ngn).toBe(before.data?.balance_ngn);

      const answer = await getAnswerRow(farahQuestionAId);
      expect(answer.farah_tier).toBe("strong");
      expect(answer.farah_summary).toBe("A specific, genuine answer.");
    },
  );

  it("insufficient balance takes NO money and records only the skipped status — tier/summary stay null", async () => {
    await setBalance(50);

    const { data, error } = await admin.rpc("record_farah_screening_review", {
      p_application_id: applicationId,
      p_question_id: farahQuestionBId,
      p_tier: "adequate",
      p_summary: "Should never be written.",
      p_amount_ngn: REVIEW_COST_NGN,
    });
    expect(error).toBeNull();
    const result = data?.[0];
    expect(result?.ok).toBe(false);
    expect(result?.status).toBe("skipped_insufficient_balance");
    expect(result?.balance_after_ngn).toBe(50);

    const { data: wallet } = await admin.from("ad_wallets").select("balance_ngn").eq("organization_id", orgId).single();
    expect(wallet?.balance_ngn, "an underfunded review must never take money").toBe(50);

    const answer = await getAnswerRow(farahQuestionBId);
    expect(answer.farah_review_status).toBe("skipped_insufficient_balance");
    expect(answer.farah_tier).toBeNull();
    expect(answer.farah_summary).toBeNull();
  });

  it("refuses outright for a screening_mode='self' question — no charge, no write", async () => {
    await setBalance(250);

    const { error } = await admin.rpc("record_farah_screening_review", {
      p_application_id: applicationId,
      p_question_id: selfQuestionId,
      p_tier: "strong",
      p_summary: "Should never be written either.",
      p_amount_ngn: REVIEW_COST_NGN,
    });
    expect(error, "a self-mode question must be refused, not silently reviewed").not.toBeNull();
    expect(error?.message).toMatch(/not in farah screening_mode/);

    const { data: wallet } = await admin.from("ad_wallets").select("balance_ngn").eq("organization_id", orgId).single();
    expect(wallet?.balance_ngn).toBe(250);
  });
});
