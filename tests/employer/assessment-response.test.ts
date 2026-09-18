/**
 * send-346 v2 (migration 0177) — submit_assessment_response, the
 * application_assessment_submissions table RLS, and the pure
 * parse/reconcile helpers around the employer's own assessment form.
 *
 * The storage-bucket half of this feature (the two-party file-read policy)
 * is pinned separately in tests/employer/assessment-storage-rls.test.ts —
 * this file is the DATABASE ROW half: the RPC's own guards, and
 * reconcileJobPostingAssessment's "clear inline error, not a silent
 * removal" stance when a candidate has already responded.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";
import { parseJobPostingAssessmentForm } from "@/lib/employer/job-posting-assessment";
import { reconcileJobPostingAssessment } from "@/lib/employer/job-posting-assessment";

describe("parseJobPostingAssessmentForm", () => {
  function formWith(value: string | null): FormData {
    const form = new FormData();
    if (value !== null) form.set("jobPostingAssessment", value);
    return form;
  }

  it("a missing or empty field means no assessment", () => {
    expect(parseJobPostingAssessmentForm(formWith(null))).toEqual({ ok: true, value: null });
    expect(parseJobPostingAssessmentForm(formWith(""))).toEqual({ ok: true, value: null });
    expect(parseJobPostingAssessmentForm(formWith("null"))).toEqual({ ok: true, value: null });
  });

  it("parses a valid object", () => {
    const result = parseJobPostingAssessmentForm(
      formWith(JSON.stringify({ title: "Take-home", instructions: "Do X.", exerciseLink: null, required: true })),
    );
    expect(result).toEqual({
      ok: true,
      value: { title: "Take-home", instructions: "Do X.", exerciseLink: null, required: true },
    });
  });

  it("requires a title and instructions", () => {
    expect(
      parseJobPostingAssessmentForm(formWith(JSON.stringify({ title: "", instructions: "Do X.", required: true }))),
    ).toEqual({ ok: false, error: "The assessment needs a title." });
    expect(
      parseJobPostingAssessmentForm(formWith(JSON.stringify({ title: "T", instructions: "", required: true }))),
    ).toEqual({ ok: false, error: "The assessment needs instructions." });
  });

  it("rejects an exercise link that isn't a real URL", () => {
    const result = parseJobPostingAssessmentForm(
      formWith(JSON.stringify({ title: "T", instructions: "I", exerciseLink: "not a url", required: true })),
    );
    expect(result).toEqual({ ok: false, error: "The assessment's link isn't a valid web address." });
  });

  it("defaults required to true when omitted, honors an explicit false", () => {
    const omitted = parseJobPostingAssessmentForm(formWith(JSON.stringify({ title: "T", instructions: "I" })));
    expect(omitted).toEqual({ ok: true, value: { title: "T", instructions: "I", exerciseLink: null, required: true } });

    const explicit = parseJobPostingAssessmentForm(
      formWith(JSON.stringify({ title: "T", instructions: "I", required: false })),
    );
    expect(explicit).toEqual({ ok: true, value: { title: "T", instructions: "I", exerciseLink: null, required: false } });
  });
});

type AuthedTestUser = Awaited<ReturnType<typeof createAuthedTestUser>>;

describe("submit_assessment_response + application_assessment_submissions RLS", () => {
  let orgOwner: AuthedTestUser;
  let outsiderOwner: AuthedTestUser;
  let seeker: AuthedTestUser;
  let orgId: string;
  let outsiderOrgId: string;
  let jobId: string;
  let applicationId: string;
  const resumeIds: string[] = [];

  beforeAll(async () => {
    orgOwner = await createAuthedTestUser("assess-response-owner");
    outsiderOwner = await createAuthedTestUser("assess-response-outsider");
    seeker = await createAuthedTestUser("assess-response-seeker");

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({ name: `Assess Response Org ${randomUUID().slice(0, 8)}`, created_by: orgOwner.id, verified: true })
      .select("id")
      .single();
    if (orgErr || !org) throw new Error(`fixture org: ${orgErr?.message}`);
    orgId = org.id;

    const { data: outsiderOrg, error: outsiderErr } = await admin
      .from("organizations")
      .insert({ name: `Assess Response Outsider Org ${randomUUID().slice(0, 8)}`, created_by: outsiderOwner.id, verified: true })
      .select("id")
      .single();
    if (outsiderErr || !outsiderOrg) throw new Error(`fixture outsider org: ${outsiderErr?.message}`);
    outsiderOrgId = outsiderOrg.id;

    await admin.from("organization_members").insert([
      { organization_id: orgId, user_id: orgOwner.id, role: "owner" },
      { organization_id: outsiderOrgId, user_id: outsiderOwner.id, role: "owner" },
    ]);

    const { data: job, error: jobErr } = await admin
      .from("job_postings")
      .insert({
        source_type: "internal",
        organization_id: orgId,
        company_name: "Assess Response Test Co",
        title: `Assess Response Test Role ${randomUUID().slice(0, 8)}`,
        description: "Fixture posting for submit_assessment_response.",
        structured_jd: {},
        status: "open",
        posted_at: new Date().toISOString(),
        dedup_fingerprint: randomUUID(),
      })
      .select("id")
      .single();
    if (jobErr || !job) throw new Error(`fixture job: ${jobErr?.message}`);
    jobId = job.id;

    const { data: resume, error: resumeErr } = await admin
      .from("resumes")
      .insert({
        user_id: seeker.id,
        structured_content: { contact: {}, summary: "", experience: [], education: [], skills: [] },
      })
      .select("id")
      .single();
    if (resumeErr || !resume) throw new Error(`fixture resume: ${resumeErr?.message}`);
    resumeIds.push(resume.id);

    const { data: application, error: appErr } = await admin
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
    if (appErr || !application) throw new Error(`fixture application: ${appErr?.message}`);
    applicationId = application.id;
  }, 60_000);

  afterAll(async () => {
    await admin.from("applications").delete().eq("id", applicationId);
    for (const id of resumeIds) await admin.from("resumes").delete().eq("id", id);
    await deleteOrgsCascade(admin, [orgId, outsiderOrgId].filter(Boolean));
    await deleteTestUsers([orgOwner.id, outsiderOwner.id, seeker.id].filter(Boolean));
  });

  it("refuses when the posting has no assessment at all", async () => {
    const { error } = await seeker.client.rpc("submit_assessment_response", {
      p_application_id: applicationId,
      p_response_text: "An answer.",
      p_response_file_path: null,
      p_response_link: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/no assessment/i);
  });

  it("refuses a response with both a file path and a link", async () => {
    // Add the assessment now, so this and later tests have one to respond to.
    const { error: assessErr } = await admin.from("job_posting_assessments").insert({
      job_posting_id: jobId,
      organization_id: orgId,
      title: "Test assessment",
      instructions: "Do the thing.",
      required: false,
    });
    if (assessErr) throw new Error(`fixture assessment: ${assessErr.message}`);

    const { error } = await seeker.client.rpc("submit_assessment_response", {
      p_application_id: applicationId,
      p_response_text: null,
      p_response_file_path: `${seeker.id}/${jobId}.txt`,
      p_response_link: "https://example.com/answer",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/not both/i);
  });

  it("refuses a file path that isn't the caller's own folder", async () => {
    const { error } = await seeker.client.rpc("submit_assessment_response", {
      p_application_id: applicationId,
      p_response_text: null,
      p_response_file_path: `${randomUUID()}/${jobId}.txt`,
      p_response_link: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/not uploaded by you/i);
  });

  it("succeeds with just text, and the row is readable by the candidate and the owning org", async () => {
    const { data, error } = await seeker.client.rpc("submit_assessment_response", {
      p_application_id: applicationId,
      p_response_text: "  A real written answer.  ",
      p_response_file_path: null,
      p_response_link: null,
    });
    expect(error).toBeNull();
    expect(data).toBe(true);

    const { data: ownRow } = await seeker.client
      .from("application_assessment_submissions")
      .select("response_text")
      .eq("application_id", applicationId)
      .maybeSingle();
    // Trimmed, same discipline submit_screening_answers already applies.
    expect(ownRow?.response_text).toBe("A real written answer.");

    const orgRow = await orgOwner.client
      .from("application_assessment_submissions")
      .select("response_text")
      .eq("application_id", applicationId)
      .maybeSingle();
    expect(orgRow.data?.response_text).toBe("A real written answer.");
  });

  it("a DIFFERENT organisation's member cannot read the row", async () => {
    const { data, error } = await outsiderOwner.client
      .from("application_assessment_submissions")
      .select("response_text")
      .eq("application_id", applicationId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("IMMUTABLE: a second submission for the same application is refused", async () => {
    const { error } = await seeker.client.rpc("submit_assessment_response", {
      p_application_id: applicationId,
      p_response_text: "A different answer, trying to overwrite.",
      p_response_file_path: null,
      p_response_link: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/already been submitted/i);
  });
});

describe("reconcileJobPostingAssessment", () => {
  let orgOwner: AuthedTestUser;
  let orgId: string;
  let jobId: string;
  let seeker: AuthedTestUser;
  let applicationId: string;
  const resumeIds: string[] = [];

  beforeAll(async () => {
    orgOwner = await createAuthedTestUser("assess-reconcile-owner");
    seeker = await createAuthedTestUser("assess-reconcile-seeker");

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({ name: `Assess Reconcile Org ${randomUUID().slice(0, 8)}`, created_by: orgOwner.id, verified: true })
      .select("id")
      .single();
    if (orgErr || !org) throw new Error(`fixture org: ${orgErr?.message}`);
    orgId = org.id;
    await admin.from("organization_members").insert({ organization_id: orgId, user_id: orgOwner.id, role: "owner" });

    const { data: job, error: jobErr } = await admin
      .from("job_postings")
      .insert({
        source_type: "internal",
        organization_id: orgId,
        company_name: "Assess Reconcile Test Co",
        title: `Assess Reconcile Test Role ${randomUUID().slice(0, 8)}`,
        description: "Fixture posting for reconcileJobPostingAssessment.",
        structured_jd: {},
        status: "open",
        posted_at: new Date().toISOString(),
        dedup_fingerprint: randomUUID(),
      })
      .select("id")
      .single();
    if (jobErr || !job) throw new Error(`fixture job: ${jobErr?.message}`);
    jobId = job.id;

    const { data: resume, error: resumeErr } = await admin
      .from("resumes")
      .insert({
        user_id: seeker.id,
        structured_content: { contact: {}, summary: "", experience: [], education: [], skills: [] },
      })
      .select("id")
      .single();
    if (resumeErr || !resume) throw new Error(`fixture resume: ${resumeErr?.message}`);
    resumeIds.push(resume.id);

    const { data: application, error: appErr } = await admin
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
    if (appErr || !application) throw new Error(`fixture application: ${appErr?.message}`);
    applicationId = application.id;
  }, 60_000);

  afterAll(async () => {
    await admin.from("applications").delete().eq("id", applicationId);
    for (const id of resumeIds) await admin.from("resumes").delete().eq("id", id);
    await deleteOrgsCascade(admin, [orgId].filter(Boolean));
    await deleteTestUsers([orgOwner.id, seeker.id].filter(Boolean));
  });

  it("inserts a new assessment", async () => {
    const result = await reconcileJobPostingAssessment(orgOwner.client, jobId, orgId, orgOwner.id, {
      title: "Take-home exercise",
      instructions: "Build a small API.",
      exerciseLink: null,
      required: true,
    });
    expect(result).toEqual({ ok: true });

    const { data } = await admin.from("job_posting_assessments").select("title, required").eq("job_posting_id", jobId).single();
    expect(data?.title).toBe("Take-home exercise");
    expect(data?.required).toBe(true);
  });

  it("updates the existing assessment in place rather than duplicating it", async () => {
    const result = await reconcileJobPostingAssessment(orgOwner.client, jobId, orgId, orgOwner.id, {
      title: "Take-home exercise (revised)",
      instructions: "Build a small API, v2.",
      exerciseLink: "https://example.com/exercise",
      required: false,
    });
    expect(result).toEqual({ ok: true });

    const { data, count } = await admin
      .from("job_posting_assessments")
      .select("title, required, exercise_link", { count: "exact" })
      .eq("job_posting_id", jobId);
    expect(count).toBe(1);
    expect(data?.[0]?.title).toBe("Take-home exercise (revised)");
    expect(data?.[0]?.required).toBe(false);
    expect(data?.[0]?.exercise_link).toBe("https://example.com/exercise");
  });

  it("REFUSES removal once a candidate has responded — the same protective instinct reconcileScreeningQuestions already has", async () => {
    const { error: submitErr } = await admin.from("application_assessment_submissions").insert({
      application_id: applicationId,
      job_posting_id: jobId,
      organization_id: orgId,
      response_text: "An answer already on file.",
    });
    if (submitErr) throw new Error(`fixture submission: ${submitErr.message}`);

    const result = await reconcileJobPostingAssessment(orgOwner.client, jobId, orgId, orgOwner.id, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already responded/i);

    // Still there, unchanged — the refusal must be a genuine no-op.
    const { data } = await admin.from("job_posting_assessments").select("id").eq("job_posting_id", jobId).maybeSingle();
    expect(data).not.toBeNull();
  });
});
