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
import { reconcileJobPostingAssessment, clearAssessmentExerciseLink } from "@/lib/employer/job-posting-assessment";

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
      p_response_files: [],
      p_response_link: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/no assessment/i);
  });

  it("refuses a response with both files and a link", async () => {
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
      p_response_files: [
        { path: `${seeker.id}/${jobId}/${randomUUID()}.txt`, originalFilename: "answer.txt", byteSize: 10 },
      ],
      p_response_link: "https://example.com/answer",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/not both/i);
  });

  it("refuses a file path that isn't the caller's own folder", async () => {
    const { error } = await seeker.client.rpc("submit_assessment_response", {
      p_application_id: applicationId,
      p_response_text: null,
      p_response_files: [
        { path: `${randomUUID()}/${jobId}/${randomUUID()}.txt`, originalFilename: "answer.txt", byteSize: 10 },
      ],
      p_response_link: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/not uploaded by you/i);
  });

  it("refuses more than 5 files in one submission", async () => {
    const files = Array.from({ length: 6 }, (_, i) => ({
      path: `${seeker.id}/${jobId}/${randomUUID()}.txt`,
      originalFilename: `file-${i}.txt`,
      byteSize: 10,
    }));
    const { error } = await seeker.client.rpc("submit_assessment_response", {
      p_application_id: applicationId,
      p_response_text: null,
      p_response_files: files,
      p_response_link: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/at most 5/i);
  });

  it("succeeds with just text, and the row is readable by the candidate and the owning org", async () => {
    const { data, error } = await seeker.client.rpc("submit_assessment_response", {
      p_application_id: applicationId,
      p_response_text: "  A real written answer.  ",
      p_response_files: [],
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
      p_response_files: [],
      p_response_link: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/already been submitted/i);
  });
});

describe("submit_assessment_response — multiple files (send-365)", () => {
  let orgOwner: AuthedTestUser;
  let outsiderOwner: AuthedTestUser;
  let seeker: AuthedTestUser;
  let orgId: string;
  let outsiderOrgId: string;
  let jobId: string;
  let applicationId: string;
  const resumeIds: string[] = [];
  const uploadedPaths: string[] = [];

  beforeAll(async () => {
    orgOwner = await createAuthedTestUser("assess-response-mf-owner");
    outsiderOwner = await createAuthedTestUser("assess-response-mf-outsider");
    seeker = await createAuthedTestUser("assess-response-mf-seeker");

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({ name: `Assess Response MF Org ${randomUUID().slice(0, 8)}`, created_by: orgOwner.id, verified: true })
      .select("id")
      .single();
    if (orgErr || !org) throw new Error(`fixture org: ${orgErr?.message}`);
    orgId = org.id;

    const { data: outsiderOrg, error: outsiderErr } = await admin
      .from("organizations")
      .insert({
        name: `Assess Response MF Outsider Org ${randomUUID().slice(0, 8)}`,
        created_by: outsiderOwner.id,
        verified: true,
      })
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
        company_name: "Assess Response MF Test Co",
        title: `Assess Response MF Test Role ${randomUUID().slice(0, 8)}`,
        description: "Fixture posting for submit_assessment_response's multi-file case.",
        structured_jd: {},
        status: "open",
        posted_at: new Date().toISOString(),
        dedup_fingerprint: randomUUID(),
      })
      .select("id")
      .single();
    if (jobErr || !job) throw new Error(`fixture job: ${jobErr?.message}`);
    jobId = job.id;

    const { error: assessErr } = await admin.from("job_posting_assessments").insert({
      job_posting_id: jobId,
      organization_id: orgId,
      title: "Test assessment",
      instructions: "Do the thing.",
      required: false,
    });
    if (assessErr) throw new Error(`fixture assessment: ${assessErr.message}`);

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
    if (uploadedPaths.length > 0) {
      await admin.storage.from("job-assessment-submissions").remove(uploadedPaths);
    }
    await admin.from("applications").delete().eq("id", applicationId);
    for (const id of resumeIds) await admin.from("resumes").delete().eq("id", id);
    await deleteOrgsCascade(admin, [orgId, outsiderOrgId].filter(Boolean));
    await deleteTestUsers([orgOwner.id, outsiderOwner.id, seeker.id].filter(Boolean));
  });

  it(
    "accepts 3 files atomically alongside the parent row, readable by the candidate and the owning org, not by an outsider",
    async () => {
      // Real storage objects, the same way the candidate's own browser
      // would have uploaded them via /api/jobs/assessment-response before
      // this RPC call — the RPC's own ownership-prefix check reads real
      // paths, and the two-party read policy needs real rows to test.
      const files = await Promise.all(
        ["brief.txt", "notes.txt", "summary.txt"].map(async (name) => {
          const path = `${seeker.id}/${jobId}/${randomUUID()}.txt`;
          uploadedPaths.push(path);
          const content = `Response content for ${name}`;
          const { error: uploadErr } = await seeker.client.storage
            .from("job-assessment-submissions")
            .upload(path, new TextEncoder().encode(content), { contentType: "text/plain" });
          if (uploadErr) throw new Error(`fixture upload ${name}: ${uploadErr.message}`);
          return { path, originalFilename: name, byteSize: content.length };
        }),
      );

      const { data, error } = await seeker.client.rpc("submit_assessment_response", {
        p_application_id: applicationId,
        p_response_text: null,
        p_response_files: files,
        p_response_link: null,
      });
      expect(error).toBeNull();
      expect(data).toBe(true);

      const { data: submission } = await admin
        .from("application_assessment_submissions")
        .select("id")
        .eq("application_id", applicationId)
        .single();

      const { data: rows, count } = await admin
        .from("application_assessment_response_files")
        .select("original_filename, byte_size", { count: "exact" })
        .eq("application_assessment_submission_id", submission!.id)
        .order("original_filename", { ascending: true });
      expect(count, "all 3 files should have landed atomically alongside the parent row").toBe(3);
      expect((rows ?? []).map((r) => r.original_filename)).toEqual(["brief.txt", "notes.txt", "summary.txt"]);

      const { data: candidateRows, error: candidateErr } = await seeker.client
        .from("application_assessment_response_files")
        .select("id")
        .eq("application_assessment_submission_id", submission!.id);
      expect(candidateErr).toBeNull();
      expect(candidateRows).toHaveLength(3);

      const { data: orgRows, error: orgErr } = await orgOwner.client
        .from("application_assessment_response_files")
        .select("id")
        .eq("application_assessment_submission_id", submission!.id);
      expect(orgErr).toBeNull();
      expect(orgRows).toHaveLength(3);

      const { data: outsiderRows } = await outsiderOwner.client
        .from("application_assessment_response_files")
        .select("id")
        .eq("application_assessment_submission_id", submission!.id);
      expect(outsiderRows, "a different org's member must see none of these rows").toEqual([]);
    },
  );

  it(
    "IMMUTABLE, MULTI-FILE VARIANT: a second submit_assessment_response call for the same application is refused, even with a different file set — this does not just assume the single-file test above generalizes",
    async () => {
      const secondPath = `${seeker.id}/${jobId}/${randomUUID()}.txt`;
      const { error: uploadErr } = await seeker.client.storage
        .from("job-assessment-submissions")
        .upload(secondPath, new TextEncoder().encode("A second attempt."), { contentType: "text/plain" });
      if (uploadErr) throw new Error(`fixture second upload: ${uploadErr.message}`);
      uploadedPaths.push(secondPath);

      const { error } = await seeker.client.rpc("submit_assessment_response", {
        p_application_id: applicationId,
        p_response_text: null,
        p_response_files: [{ path: secondPath, originalFilename: "second-attempt.txt", byteSize: 18 }],
        p_response_link: null,
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/already been submitted/i);

      // The refused call's own file must not have landed either — the
      // immutability guarantee has to cover the child rows, not just the
      // parent, or a refused-looking call could still leave an orphaned
      // file row with no corresponding "current" submission content.
      const { data: submission } = await admin
        .from("application_assessment_submissions")
        .select("id")
        .eq("application_id", applicationId)
        .single();
      const { count } = await admin
        .from("application_assessment_response_files")
        .select("id", { count: "exact", head: true })
        .eq("application_assessment_submission_id", submission!.id);
      expect(count, "still exactly the original 3 files — the refused second call inserted nothing").toBe(3);
    },
  );
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

  it(
    "EXCLUSIVITY (send-364): setting a link clears existing files (rows AND storage objects); uploading clears an existing link",
    async () => {
      const { data: assessmentRow } = await admin
        .from("job_posting_assessments")
        .select("id")
        .eq("job_posting_id", jobId)
        .single();
      const assessmentId = assessmentRow!.id;

      // ---- Attach 2 files, the same way the upload route itself would:
      //      a real storage object via the org's own client, then a row. ----
      const filePaths = [`${orgId}/${jobId}/${randomUUID()}.txt`, `${orgId}/${jobId}/${randomUUID()}.txt`];
      for (const path of filePaths) {
        const { error: uploadErr } = await orgOwner.client.storage
          .from("job-assessment-exercises")
          .upload(path, new TextEncoder().encode("fixture content"), { contentType: "text/plain" });
        if (uploadErr) throw new Error(`fixture file upload: ${uploadErr.message}`);
      }
      const { error: insertFilesErr } = await orgOwner.client.from("job_posting_assessment_files").insert(
        filePaths.map((file_path) => ({
          job_posting_assessment_id: assessmentId,
          organization_id: orgId,
          file_path,
          original_filename: "fixture.txt",
          byte_size: 16,
        })),
      );
      if (insertFilesErr) throw new Error(`fixture file rows: ${insertFilesErr.message}`);

      const { count: beforeCount } = await admin
        .from("job_posting_assessment_files")
        .select("id", { count: "exact", head: true })
        .eq("job_posting_assessment_id", assessmentId);
      expect(beforeCount, "both fixture files should be attached before the link is set").toBe(2);

      // ---- Setting a link must clear both file rows AND their storage
      //      objects — attach 2 files, then set a link, confirm both file
      //      rows are gone. ----------------------------------------------
      const result = await reconcileJobPostingAssessment(orgOwner.client, jobId, orgId, orgOwner.id, {
        title: "Take-home exercise (revised again)",
        instructions: "Build a small API, v3.",
        exerciseLink: "https://example.com/exercise-2",
        required: false,
      });
      expect(result).toEqual({ ok: true });

      const { count: afterCount } = await admin
        .from("job_posting_assessment_files")
        .select("id", { count: "exact", head: true })
        .eq("job_posting_assessment_id", assessmentId);
      expect(afterCount, "setting a link must delete every existing file row").toBe(0);

      for (const path of filePaths) {
        const { error: downloadErr } = await admin.storage.from("job-assessment-exercises").download(path);
        expect(downloadErr, `the storage object at ${path} should have been removed, not just the row`).not.toBeNull();
      }

      // ---- Uploading a file must clear an existing link — attach a file
      //      when a link is set, confirm the link clears. The reconcile
      //      call just above already set exercise_link to a real value;
      //      this exercises the OTHER direction of the same rule, the exact
      //      helper /api/employer/job-assessment-exercise's own POST
      //      handler calls right after a successful storage upload. -------
      const { data: beforeClear } = await admin
        .from("job_posting_assessments")
        .select("exercise_link")
        .eq("id", assessmentId)
        .single();
      expect(beforeClear?.exercise_link, "a link should be set before exercising the clear").not.toBeNull();

      await clearAssessmentExerciseLink(orgOwner.client, assessmentId);

      const { data: afterClear } = await admin
        .from("job_posting_assessments")
        .select("exercise_link")
        .eq("id", assessmentId)
        .single();
      expect(afterClear?.exercise_link, "uploading a file must clear any existing link").toBeNull();
    },
  );

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
