/**
 * send-327 — employer-authored screening questions (0171): the actual
 * pre-application self-assessment, not just a post-application sort
 * (send-326) or badge (send-328).
 *
 * send-344 (0175) added a third, ungraded question type — open-ended
 * written response — and a new on-demand read path for employers
 * (`employer_application_screening_answers`). Extended below as numbered
 * continuations of the same list, not a separate file.
 *
 * ── WHAT THIS FILE EXISTS TO PIN ──────────────────────────────────────────
 *
 * `submit_screening_answers` computes `application_screening_answers.passed`
 * and `applications.screening_passed` ONCE, at write time, inside one
 * SECURITY DEFINER function — never recomputed live. Behaviours pinned
 * here, each one a place the computation could quietly drift wrong:
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
 *   6. (0175) A required free_text question, answered with a non-empty
 *      string, contributes passed = true and its trimmed text lands in
 *      answer_text — free_text is never graded, but "answered" still has to
 *      actually register.
 *   7. (0175) A required free_text question answered with ONLY whitespace
 *      is treated as unanswered — screening_passed stays null when it's the
 *      only required question, the same as an omitted min_number answer.
 *      This is the one behaviour most likely to get quietly inverted (a
 *      required free_text question accidentally always "passing" the
 *      moment ANY string, including whitespace, is sent) — see this test's
 *      own comment for exactly why it would flip if that happened.
 *   8. (0175) An answer longer than 2000 characters is rejected by the DB
 *      constraint, not silently truncated or accepted.
 *   9. (0175) `employer_application_screening_answers` returns one row per
 *      question — including unanswered ones, all answer fields null — for
 *      the org that owns the posting, and returns nothing for a caller
 *      outside that org.
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
let jobWithFreeTextId: string;
let yesNoQuestionId: string;
let minNumberQuestionId: string;
let freeTextQuestionId: string;

let outsiderOrgOwner: AuthedTestUser;
let outsiderOrgId: string;

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
  "freeTextAnswered",
  "freeTextWhitespaceOnly",
  "freeTextTooLong",
  "employerReadUnanswered",
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

  const [{ data: jobA, error: jobAErr }, { data: jobB, error: jobBErr }, { data: jobC, error: jobCErr }] =
    await Promise.all([
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
      admin
        .from("job_postings")
        .insert({
          source_type: "internal",
          organization_id: orgId,
          company_name: "Screening-Test Co",
          title: `Screening-Test Role (free text only) ${randomUUID().slice(0, 8)}`,
          description: "Fixture posting with a single required free_text screening question.",
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
  if (jobCErr || !jobC) throw new Error(`fixture job C: ${jobCErr?.message}`);
  jobWithQuestionsId = jobA.id;
  jobWithoutQuestionsId = jobB.id;
  jobWithFreeTextId = jobC.id;

  // A second organisation, no relation to the first — proves
  // employer_application_screening_answers refuses (returns nothing for) a
  // caller outside the owning org, not just that a member can read it.
  outsiderOrgOwner = await createAuthedTestUser("screening-outsider-owner");
  const { data: outsiderOrg, error: outsiderOrgErr } = await admin
    .from("organizations")
    .insert({
      name: `Screening-Test Outsider Org ${randomUUID().slice(0, 8)}`,
      created_by: outsiderOrgOwner.id,
      verified: true,
    })
    .select("id")
    .single();
  if (outsiderOrgErr || !outsiderOrg) throw new Error(`fixture outsider org: ${outsiderOrgErr?.message}`);
  outsiderOrgId = outsiderOrg.id;
  const { error: outsiderMemErr } = await admin
    .from("organization_members")
    .insert({ organization_id: outsiderOrgId, user_id: outsiderOrgOwner.id, role: "owner" });
  if (outsiderMemErr) throw new Error(`fixture outsider membership: ${outsiderMemErr.message}`);

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

  const { data: freeTextQuestion, error: ftErr } = await admin
    .from("job_posting_screening_questions")
    .insert({
      job_posting_id: jobWithFreeTextId,
      question_text: "Why are you interested in this role?",
      question_type: "free_text",
      required: true,
      sort_order: 0,
    })
    .select("id")
    .single();
  if (ftErr || !freeTextQuestion) throw new Error(`fixture free_text question: ${ftErr?.message}`);
  freeTextQuestionId = freeTextQuestion.id;

  for (const key of SEEKER_KEYS) {
    seekers[key] = await createAuthedTestUser(`screening-${key}`);
  }

  const jobFor = (key: (typeof SEEKER_KEYS)[number]) => {
    if (key === "noQuestionsJob") return jobWithoutQuestionsId;
    if (
      key === "freeTextAnswered" ||
      key === "freeTextWhitespaceOnly" ||
      key === "freeTextTooLong" ||
      key === "employerReadUnanswered"
    ) {
      return jobWithFreeTextId;
    }
    return jobWithQuestionsId;
  };

  for (const key of SEEKER_KEYS) {
    applicationIds[key] = await makeApplication(seekers[key].id, jobFor(key));
  }
}, 60_000);

afterAll(async () => {
  for (const id of Object.values(applicationIds)) await admin.from("applications").delete().eq("id", id);
  for (const id of resumeIds) await admin.from("resumes").delete().eq("id", id);
  await deleteOrgsCascade(admin, [orgId, outsiderOrgId].filter(Boolean));
  await deleteTestUsers(
    [orgOwner.id, outsiderOrgOwner.id, ...Object.values(seekers).map((s) => s.id)].filter(Boolean),
  );
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

describe("free_text screening questions (0175/send-344)", () => {
  it("a required free_text question answered with a non-empty string contributes passed = true and lands trimmed in answer_text", async () => {
    const seeker = seekers.freeTextAnswered;
    const { data: overall, error } = await seeker.client.rpc("submit_screening_answers", {
      p_application_id: applicationIds.freeTextAnswered,
      p_answers: [
        {
          question_id: freeTextQuestionId,
          answer_yes_no: null,
          answer_number: null,
          answer_text: "  I've shipped three fintech products end to end.  ",
        },
      ],
    });
    expect(error).toBeNull();
    // free_text is never graded — answered is the whole bar (0175's own
    // header). This is the required-and-only question on this job, so
    // "answered" here means the overall result is true, not merely
    // non-null.
    expect(overall).toBe(true);

    const { data: app } = await admin
      .from("applications")
      .select("screening_passed")
      .eq("id", applicationIds.freeTextAnswered)
      .single();
    expect(app!.screening_passed).toBe(true);

    const { data: answers } = await admin
      .from("application_screening_answers")
      .select("passed, answer_text, answer_yes_no, answer_number")
      .eq("application_id", applicationIds.freeTextAnswered)
      .single();
    expect(answers!.passed).toBe(true);
    // Trimmed, not the raw padded string sent above.
    expect(answers!.answer_text).toBe("I've shipped three fintech products end to end.");
    expect(answers!.answer_yes_no).toBeNull();
    expect(answers!.answer_number).toBeNull();
  });

  /**
   * THE ONE BEHAVIOUR MOST LIKELY TO GET QUIETLY INVERTED. If
   * `submit_screening_answers` ever checked `answer_text is not null`
   * instead of "non-empty after trimming", an all-whitespace string sent
   * here would count as ANSWERED and — since free_text can never fail —
   * `overall` would read `true`. This job has exactly one required
   * question (this one), so any regression that treats whitespace as a
   * real answer flips this specific assertion from `null` to `true`, not
   * just "some test somewhere fails" — that specificity is what proves the
   * test would actually catch the bug, not just that it currently passes.
   */
  it("a required free_text question answered with ONLY whitespace is treated as unanswered — screening_passed stays null", async () => {
    const seeker = seekers.freeTextWhitespaceOnly;
    const { data: overall, error } = await seeker.client.rpc("submit_screening_answers", {
      p_application_id: applicationIds.freeTextWhitespaceOnly,
      p_answers: [
        {
          question_id: freeTextQuestionId,
          answer_yes_no: null,
          answer_number: null,
          answer_text: "   \t  \n  ",
        },
      ],
    });
    expect(error).toBeNull();
    expect(overall).toBeNull();

    const { data: app } = await admin
      .from("applications")
      .select("screening_passed")
      .eq("id", applicationIds.freeTextWhitespaceOnly)
      .single();
    expect(app!.screening_passed).toBeNull();

    // Not just "overall is null" — no answer row should exist at all for
    // this question, the same way an omitted min_number answer never
    // writes a row either (see the "partial" test above).
    const { data: answers } = await admin
      .from("application_screening_answers")
      .select("id")
      .eq("application_id", applicationIds.freeTextWhitespaceOnly);
    expect(answers).toEqual([]);
  });

  it("an answer longer than 2000 characters is rejected by the DB constraint, not truncated or accepted", async () => {
    const seeker = seekers.freeTextTooLong;
    const tooLong = "a".repeat(2001);
    const { data: overall, error } = await seeker.client.rpc("submit_screening_answers", {
      p_application_id: applicationIds.freeTextTooLong,
      p_answers: [
        { question_id: freeTextQuestionId, answer_yes_no: null, answer_number: null, answer_text: tooLong },
      ],
    });
    expect(overall).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/application_screening_answers_answer_text_length_check|char_length/i);

    // Nothing was written, and screening_passed was never touched by a
    // call that failed before reaching that UPDATE.
    const { data: answers } = await admin
      .from("application_screening_answers")
      .select("id")
      .eq("application_id", applicationIds.freeTextTooLong);
    expect(answers).toEqual([]);
    const { data: app } = await admin
      .from("applications")
      .select("screening_passed")
      .eq("id", applicationIds.freeTextTooLong)
      .single();
    expect(app!.screening_passed).toBeNull();
  });
});

describe("employer_application_screening_answers (0175/send-344)", () => {
  it("returns one row per question on the posting, for the org that owns it — including an unanswered question with all-null answer fields", async () => {
    const { data, error } = await orgOwner.client.rpc("employer_application_screening_answers", {
      p_application_id: applicationIds.employerReadUnanswered,
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    const row = data![0]!;
    expect(row.question_text).toBe("Why are you interested in this role?");
    expect(row.question_type).toBe("free_text");
    expect(row.required).toBe(true);
    // Never answered — the LEFT JOIN still surfaces the question rather
    // than silently dropping it, with every answer field null.
    expect(row.answer_yes_no).toBeNull();
    expect(row.answer_number).toBeNull();
    expect(row.answer_text).toBeNull();
    expect(row.passed).toBeNull();
  });

  it("surfaces the real written answer once one exists, for the owning org", async () => {
    const { data, error } = await orgOwner.client.rpc("employer_application_screening_answers", {
      p_application_id: applicationIds.freeTextAnswered,
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    const row = data![0]!;
    expect(row.answer_text).toBe("I've shipped three fintech products end to end.");
    expect(row.passed).toBe(true);
  });

  it("returns nothing for a caller outside the owning organisation", async () => {
    const { data, error } = await outsiderOrgOwner.client.rpc("employer_application_screening_answers", {
      p_application_id: applicationIds.freeTextAnswered,
    });
    // is_org_member filters the row out of the WHERE clause entirely —
    // this refuses by returning nothing, not by throwing, same shape as
    // employer_job_applicants' own ownership gate.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
