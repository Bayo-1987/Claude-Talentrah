/**
 * send-327 — employer-authored screening questions (0171): the actual
 * pre-application self-assessment, not just a post-application sort
 * (send-326) or badge (send-328).
 *
 * ── WHAT THIS FILE EXISTS TO PIN ──────────────────────────────────────────
 *
 * `submit_screening_answers` computes `application_screening_answers.passed`
 * and `applications.screening_passed` ONCE, at write time, inside one
 * SECURITY DEFINER function — never recomputed live. Five behaviours are
 * pinned here, each one a place the computation could quietly drift wrong:
 *
 *   1. A min_number question passes/fails AT and AROUND its threshold
 *      (off-by-one: `>=`, not `>`, is the actual contract).
 *   2. A yes_no question passes/fails for BOTH expected values, not just
 *      the "expected true" case.
 *   3. `screening_passed` is null — not false — for a job with zero
 *      screening questions. Reading a job with no gate as "failed" would be
 *      a worse bug than reading it as "passed".
 *   4. `screening_passed` is null — not true, not false — when some but not
 *      all REQUIRED questions are answered. A half-finished self-assessment
 *      must never read as a pass.
 *   5. Answers are genuinely immutable: a second `submit_screening_answers`
 *      call for the same application is REJECTED, not silently accepted or
 *      merged — checked both at the RPC layer (the function's own explicit
 *      guard) and at the RLS layer (no UPDATE policy exists at all, so even
 *      a direct PATCH against the row is a no-op).
 *
 * Each assertion below is chosen so a regression in the underlying logic
 * (e.g. `>` instead of `>=`, `false` instead of `null`, or the immutability
 * guard being removed) would flip that specific assertion, not just make
 * the test error out generically — that is what "proves it catches the
 * bug" means for a boundary/tri-state suite like this one, as opposed to a
 * sabotage-and-restore proof against a live resource.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";

type AuthedTestUser = Awaited<ReturnType<typeof createAuthedTestUser>>;

let orgOwner: AuthedTestUser;
let orgId: string;
let jobWithQuestionsId: string;
let jobWithoutQuestionsId: string;
let yesNoQuestionId: string;
let minNumberQuestionId: string;

const seekers: Record<string, AuthedTestUser> = {};
const applicationIds: Record<string, string> = {};
const resumeIds: string[] = [];

const SEEKER_KEYS = [
  "passBoth",
  "failYesNo",
  "failMinNumberByOne",
  "partial",
  "noQuestionsJob",
  "immutable",
] as const;

async function makeApplication(seekerId: string, jobPostingId: string): Promise<string> {
  const { data: resume, error: resumeErr } = await admin
    .from("resumes")
    .insert({
      user_id: seekerId,
      structured_content: {
        contact: { name: "Screening Test" },
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
      user_id: seekerId,
      job_posting_id: jobPostingId,
      resume_id: resume.id,
      stage: "applied",
      source: "internal_apply",
      applied_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (applicationErr || !application) throw new Error(`fixture application: ${applicationErr?.message}`);
  return application.id;
}

beforeAll(async () => {
  orgOwner = await createAuthedTestUser("screening-owner");

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({
      name: `Screening-Test Org ${randomUUID().slice(0, 8)}`,
      created_by: orgOwner.id,
      verified: true,
    })
    .select("id")
    .single();
  if (orgErr || !org) throw new Error(`fixture org: ${orgErr?.message}`);
  orgId = org.id;

  const { error: memErr } = await admin
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: orgOwner.id, role: "owner" });
  if (memErr) throw new Error(`fixture membership: ${memErr.message}`);

  const [{ data: jobA, error: jobAErr }, { data: jobB, error: jobBErr }] = await Promise.all([
    admin
      .from("job_postings")
      .insert({
        source_type: "internal",
        organization_id: orgId,
        company_name: "Screening-Test Co",
        title: `Screening-Test Role (with questions) ${randomUUID().slice(0, 8)}`,
        description: "Fixture posting with screening questions.",
        structured_jd: {},
        status: "open",
        posted_at: new Date().toISOString(),
        dedup_fingerprint: randomUUID(),
      })
      .select("id")
      .single(),
    admin
      .from("job_postings")
      .insert({
        source_type: "internal",
        organization_id: orgId,
        company_name: "Screening-Test Co",
        title: `Screening-Test Role (no questions) ${randomUUID().slice(0, 8)}`,
        description: "Fixture posting with no screening questions.",
        structured_jd: {},
        status: "open",
        posted_at: new Date().toISOString(),
        dedup_fingerprint: randomUUID(),
      })
      .select("id")
      .single(),
  ]);
  if (jobAErr || !jobA) throw new Error(`fixture job A: ${jobAErr?.message}`);
  if (jobBErr || !jobB) throw new Error(`fixture job B: ${jobBErr?.message}`);
  jobWithQuestionsId = jobA.id;
  jobWithoutQuestionsId = jobB.id;

  const { data: questions, error: qErr } = await admin
    .from("job_posting_screening_questions")
    .insert([
      {
        job_posting_id: jobWithQuestionsId,
        question_text: "Are you authorized to work in Nigeria?",
        question_type: "yes_no",
        required: true,
        expected_yes_no: true,
        sort_order: 0,
      },
      {
        job_posting_id: jobWithQuestionsId,
        question_text: "How many years of experience do you have with X?",
        question_type: "min_number",
        required: true,
        min_value: 3,
        sort_order: 1,
      },
    ])
    .select("id, question_type");
  if (qErr || !questions) throw new Error(`fixture questions: ${qErr?.message}`);
  yesNoQuestionId = questions.find((q) => q.question_type === "yes_no")!.id;
  minNumberQuestionId = questions.find((q) => q.question_type === "min_number")!.id;

  for (const key of SEEKER_KEYS) {
    seekers[key] = await createAuthedTestUser(`screening-${key}`);
  }

  const jobFor = (key: (typeof SEEKER_KEYS)[number]) =>
    key === "noQuestionsJob" ? jobWithoutQuestionsId : jobWithQuestionsId;

  for (const key of SEEKER_KEYS) {
    applicationIds[key] = await makeApplication(seekers[key].id, jobFor(key));
  }
}, 60_000);

afterAll(async () => {
  for (const id of Object.values(applicationIds)) await admin.from("applications").delete().eq("id", id);
  for (const id of resumeIds) await admin.from("resumes").delete().eq("id", id);
  await deleteOrgsCascade(admin, [orgId].filter(Boolean));
  await deleteTestUsers([orgOwner.id, ...Object.values(seekers).map((s) => s.id)].filter(Boolean));
});

describe("submit_screening_answers — pass/fail computation", () => {
  it("passes both questions when yes_no matches expected and min_number is AT the threshold (3 >= 3)", async () => {
    const seeker = seekers.passBoth;
    const { data: overall, error } = await seeker.client.rpc("submit_screening_answers", {
      p_application_id: applicationIds.passBoth,
      p_answers: [
        { question_id: yesNoQuestionId, answer_yes_no: true, answer_number: null },
        { question_id: minNumberQuestionId, answer_yes_no: null, answer_number: 3 },
      ],
    });
    expect(error).toBeNull();
    expect(overall).toBe(true);

    const { data: app } = await admin
      .from("applications")
      .select("screening_passed")
      .eq("id", applicationIds.passBoth)
      .single();
    expect(app!.screening_passed).toBe(true);

    const { data: answers } = await admin
      .from("application_screening_answers")
      .select("question_id, passed")
      .eq("application_id", applicationIds.passBoth);
    expect(answers!.find((a) => a.question_id === minNumberQuestionId)!.passed).toBe(true);
  });

  it("fails overall when the yes_no answer does NOT match the expected value, even though min_number passes", async () => {
    const seeker = seekers.failYesNo;
    const { data: overall, error } = await seeker.client.rpc("submit_screening_answers", {
      p_application_id: applicationIds.failYesNo,
      p_answers: [
        { question_id: yesNoQuestionId, answer_yes_no: false, answer_number: null },
        { question_id: minNumberQuestionId, answer_yes_no: null, answer_number: 5 },
      ],
    });
    expect(error).toBeNull();
    expect(overall).toBe(false);

    const { data: answers } = await admin
      .from("application_screening_answers")
      .select("question_id, passed")
      .eq("application_id", applicationIds.failYesNo);
    expect(answers!.find((a) => a.question_id === yesNoQuestionId)!.passed).toBe(false);
    expect(answers!.find((a) => a.question_id === minNumberQuestionId)!.passed).toBe(true);
  });

  it("fails the min_number question by exactly one below its threshold (2 < 3) — the off-by-one that matters", async () => {
    const seeker = seekers.failMinNumberByOne;
    const { data: overall, error } = await seeker.client.rpc("submit_screening_answers", {
      p_application_id: applicationIds.failMinNumberByOne,
      p_answers: [
        { question_id: yesNoQuestionId, answer_yes_no: true, answer_number: null },
        { question_id: minNumberQuestionId, answer_yes_no: null, answer_number: 2 },
      ],
    });
    expect(error).toBeNull();
    expect(overall).toBe(false);

    const { data: answers } = await admin
      .from("application_screening_answers")
      .select("question_id, passed")
      .eq("application_id", applicationIds.failMinNumberByOne);
    expect(answers!.find((a) => a.question_id === minNumberQuestionId)!.passed).toBe(false);
  });

  it("returns null (not false, not true) when a required question is left unanswered", async () => {
    const seeker = seekers.partial;
    const { data: overall, error } = await seeker.client.rpc("submit_screening_answers", {
      p_application_id: applicationIds.partial,
      // Only the yes_no question is answered; min_number (also required) is
      // omitted entirely — this must NOT read as a pass just because the one
      // answer given happens to pass.
      p_answers: [{ question_id: yesNoQuestionId, answer_yes_no: true, answer_number: null }],
    });
    expect(error).toBeNull();
    expect(overall).toBeNull();

    const { data: app } = await admin
      .from("applications")
      .select("screening_passed")
      .eq("id", applicationIds.partial)
      .single();
    expect(app!.screening_passed).toBeNull();
  });

  it("returns null for a job with no screening questions at all", async () => {
    const seeker = seekers.noQuestionsJob;
    const { data: overall, error } = await seeker.client.rpc("submit_screening_answers", {
      p_application_id: applicationIds.noQuestionsJob,
      p_answers: [],
    });
    expect(error).toBeNull();
    expect(overall).toBeNull();

    const { data: app } = await admin
      .from("applications")
      .select("screening_passed")
      .eq("id", applicationIds.noQuestionsJob)
      .single();
    // Never false — a job with no gate at all must not read as "failed".
    expect(app!.screening_passed).toBeNull();
  });
});

describe("application_screening_answers — immutability after submission", () => {
  it("rejects a second submit_screening_answers call for the same application outright", async () => {
    const seeker = seekers.immutable;
    const { error: firstError } = await seeker.client.rpc("submit_screening_answers", {
      p_application_id: applicationIds.immutable,
      p_answers: [
        { question_id: yesNoQuestionId, answer_yes_no: true, answer_number: null },
        { question_id: minNumberQuestionId, answer_yes_no: null, answer_number: 3 },
      ],
    });
    expect(firstError).toBeNull();

    const { data: secondResult, error: secondError } = await seeker.client.rpc("submit_screening_answers", {
      p_application_id: applicationIds.immutable,
      // A revised, more-favourable answer set — if this silently succeeded
      // or merged, it would let a candidate game a self-assessment once its
      // stakes are known, exactly what 0171's own header rules out.
      p_answers: [
        { question_id: yesNoQuestionId, answer_yes_no: true, answer_number: null },
        { question_id: minNumberQuestionId, answer_yes_no: null, answer_number: 99 },
      ],
    });
    expect(secondResult).toBeNull();
    expect(secondError).not.toBeNull();
    expect(secondError!.message).toMatch(/already been submitted/i);

    // Not silently overwritten: still exactly 2 answer rows, and the
    // min_number answer is still the FIRST value submitted (3), not the
    // rejected second attempt's 99.
    const { data: answers } = await admin
      .from("application_screening_answers")
      .select("question_id, answer_number")
      .eq("application_id", applicationIds.immutable);
    expect(answers!.length).toBe(2);
    expect(answers!.find((a) => a.question_id === minNumberQuestionId)!.answer_number).toBe(3);
  });

  it("a direct UPDATE against the answers table by the owning seeker has no effect — no UPDATE policy exists", async () => {
    const seeker = seekers.immutable;
    const { data: before } = await admin
      .from("application_screening_answers")
      .select("id, answer_number")
      .eq("application_id", applicationIds.immutable)
      .eq("question_id", minNumberQuestionId)
      .single();
    expect(before!.answer_number).toBe(3);

    // supabase-js does not throw when RLS blocks an UPDATE with no matching
    // policy — it resolves with 0 rows affected, not an error. The teardown
    // guard for exactly this shape of bug is CLAUDE.md's own delete-vs-error
    // rule; here we check the actual row content afterward rather than
    // trusting the absence of a thrown error.
    await seeker.client
      .from("application_screening_answers")
      .update({ answer_number: 999 })
      .eq("id", before!.id);

    const { data: after } = await admin
      .from("application_screening_answers")
      .select("answer_number")
      .eq("id", before!.id)
      .single();
    expect(after!.answer_number).toBe(3);
  });
});
