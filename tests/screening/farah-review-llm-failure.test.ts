/**
 * runFarahScreeningReview (src/lib/screening/farah-review.ts, 0176/send-345
 * Part B) — the LLM-failure path specifically. The LLM is mocked, same
 * pattern as tests/employer/job-import/extract.test.ts: this is about a
 * contract (a thrown or unparsable LLM response must never reach the
 * candidate, never block anything, and — most importantly — must never
 * charge the employer for a review that didn't happen) that has to hold
 * regardless of real model behaviour, with no API budget or provider
 * dependency in CI.
 *
 * Everything downstream of the LLM call is real: a genuine fixture
 * (organisation, funded ad wallet, farah-mode question, application,
 * answer), against the actual dev database, so "the wallet was never
 * touched" is a real assertion, not a mocked one.
 */
import { afterEach, afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type TestUser } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";

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

const { runFarahScreeningReview } = await import("@/lib/screening/farah-review");

let orgOwner: Awaited<ReturnType<typeof createAuthedTestUser>>;
let seeker: TestUser;
let orgId: string;
let jobId: string;
let questionId: string;
let applicationId: string;
const resumeIds: string[] = [];

beforeAll(async () => {
  orgOwner = await createAuthedTestUser("farah-llm-failure-owner");
  seeker = await createAuthedTestUser("farah-llm-failure-seeker");

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `Farah LLM Failure Org ${randomUUID().slice(0, 8)}`, created_by: orgOwner.id, verified: true })
    .select("id")
    .single();
  if (orgErr || !org) throw new Error(`fixture org: ${orgErr?.message}`);
  orgId = org.id;

  await admin.from("organization_members").insert({ organization_id: orgId, user_id: orgOwner.id, role: "owner" });
  // Funded — if the LLM-failure path somehow charged anyway, a zero balance
  // would hide that bug behind a coincidental "insufficient balance" outcome.
  await admin.from("ad_wallets").insert({ organization_id: orgId, balance_ngn: 5000 });

  const { data: job, error: jobErr } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: orgId,
      company_name: "Farah LLM Failure Co",
      title: `Farah LLM Failure Role ${randomUUID().slice(0, 8)}`,
      description: "Fixture posting for the LLM-failure path.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
    })
    .select("id")
    .single();
  if (jobErr || !job) throw new Error(`fixture job: ${jobErr?.message}`);
  jobId = job.id;

  const { data: question, error: questionErr } = await admin
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
  if (questionErr || !question) throw new Error(`fixture question: ${questionErr?.message}`);
  questionId = question.id;

  const { data: resume, error: resumeErr } = await admin
    .from("resumes")
    .insert({
      user_id: seeker.id,
      structured_content: {
        contact: { name: "LLM Failure Seeker" },
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
}, 60_000);

afterEach(() => {
  generateText.mockReset();
});

afterAll(async () => {
  await admin.from("applications").delete().eq("id", applicationId);
  for (const id of resumeIds) await admin.from("resumes").delete().eq("id", id);
  await deleteOrgsCascade(admin, [orgId].filter(Boolean));
  await deleteTestUsers([orgOwner.id, seeker.id].filter(Boolean));
});

async function insertAnswer() {
  const { error } = await admin
    .from("application_screening_answers")
    .insert({ application_id: applicationId, question_id: questionId, answer_text: "Because I love it.", passed: true });
  if (error) throw new Error(`fixture answer: ${error.message}`);
}

async function deleteAnswer() {
  await admin.from("application_screening_answers").delete().eq("application_id", applicationId).eq("question_id", questionId);
}

describe("runFarahScreeningReview — the LLM-failure path", () => {
  it("a thrown LLM call writes skipped_error via a plain UPDATE — never charges, never calls record_farah_screening_review", async () => {
    await insertAnswer();
    generateText.mockRejectedValue(new Error("Groq is down"));

    await expect(
      runFarahScreeningReview({
        applicationId,
        questionId,
        questionText: "Why does this role interest you?",
        answerText: "Because I love it.",
      }),
    ).resolves.toBeUndefined();

    const { data: answer } = await admin
      .from("application_screening_answers")
      .select("farah_review_status, farah_tier, farah_summary")
      .eq("application_id", applicationId)
      .eq("question_id", questionId)
      .single();
    expect(answer?.farah_review_status).toBe("skipped_error");
    expect(answer?.farah_tier).toBeNull();
    expect(answer?.farah_summary).toBeNull();

    // The strongest proof record_farah_screening_review was never reached:
    // the wallet is completely untouched. A bug that called it anyway with
    // some placeholder tier/summary would show up here as a debited balance.
    const { data: wallet } = await admin.from("ad_wallets").select("balance_ngn").eq("organization_id", orgId).single();
    expect(wallet?.balance_ngn).toBe(5000);

    await deleteAnswer();
  });

  it("an unparsable LLM response (bad tier, empty summary) is treated the same as a thrown error", async () => {
    await insertAnswer();
    generateText.mockResolvedValue(JSON.stringify({ tier: "excellent", summary: "" }));

    await runFarahScreeningReview({
      applicationId,
      questionId,
      questionText: "Why does this role interest you?",
      answerText: "Because I love it.",
    });

    const { data: answer } = await admin
      .from("application_screening_answers")
      .select("farah_review_status")
      .eq("application_id", applicationId)
      .eq("question_id", questionId)
      .single();
    expect(answer?.farah_review_status).toBe("skipped_error");

    const { data: wallet } = await admin.from("ad_wallets").select("balance_ngn").eq("organization_id", orgId).single();
    expect(wallet?.balance_ngn).toBe(5000);

    await deleteAnswer();
  });

  it("a genuinely valid response completes normally — the mock isn't just always failing", async () => {
    await insertAnswer();
    generateText.mockResolvedValue(JSON.stringify({ tier: "strong", summary: "Specific and on point." }));

    await runFarahScreeningReview({
      applicationId,
      questionId,
      questionText: "Why does this role interest you?",
      answerText: "Because I love it.",
    });

    const { data: answer } = await admin
      .from("application_screening_answers")
      .select("farah_review_status, farah_tier, farah_summary")
      .eq("application_id", applicationId)
      .eq("question_id", questionId)
      .single();
    expect(answer?.farah_review_status).toBe("completed");
    expect(answer?.farah_tier).toBe("strong");
    expect(answer?.farah_summary).toBe("Specific and on point.");

    const { data: wallet } = await admin.from("ad_wallets").select("balance_ngn").eq("organization_id", orgId).single();
    expect(wallet?.balance_ngn).toBe(4900);

    await deleteAnswer();
  });
});
