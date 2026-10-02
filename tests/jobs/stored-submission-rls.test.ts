/**
 * The job page's "Submitted with ..." confirmation is read from the STORED submission through the candidate's own
 * session client (src/lib/jobs/application-submission.ts), with no service role and no schema change. That is only safe
 * because of the RLS policies "candidate or owning org can read an assessment submission / response files".
 *
 * This pins the half that matters for privacy: a candidate who asks for ANOTHER candidate's application gets nothing
 * (no row, no file names, no wording), and their own wording is the same before and after they ask. It also pins the
 * two wordings a candidate does see for their own application, read end to end through the real helper.
 *
 * DB-backed (runs in CI against the ephemeral per-job database, like tests/employer/assessment-response.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";
import { fetchStoredSubmission } from "@/lib/jobs/application-submission";
import { storedSentNote } from "@/lib/jobs/screening-gate-copy";

type AuthedTestUser = Awaited<ReturnType<typeof createAuthedTestUser>>;
type SessionClient = Parameters<typeof fetchStoredSubmission>[0];

/** The page's own two steps: read the stored submission, then word it. */
async function noteFor(client: AuthedTestUser["client"], applicationId: string): Promise<string | null> {
  const submission = await fetchStoredSubmission(client as unknown as SessionClient, applicationId);
  return storedSentNote(submission);
}

describe("the stored-submission confirmation is private to the candidate who made it", () => {
  let orgOwner: AuthedTestUser;
  let candidateA: AuthedTestUser;
  let candidateB: AuthedTestUser;
  let orgId: string;
  let jobWithFile: string;
  let jobTextOnly: string;
  let appAFile: string;
  let appAText: string;
  let appB: string;
  let submissionAFileId: string;
  const resumeIds: string[] = [];
  const applicationIds: string[] = [];
  const jobIds: string[] = [];
  const uploadedPaths: string[] = [];

  async function makeJob(label: string): Promise<string> {
    const { data: job, error } = await admin
      .from("job_postings")
      .insert({
        source_type: "internal",
        organization_id: orgId,
        company_name: "Stored Submission Test Co",
        title: `Stored Submission ${label} ${randomUUID().slice(0, 8)}`,
        description: "Fixture posting for the stored-submission RLS check.",
        structured_jd: {},
        status: "open",
        posted_at: new Date().toISOString(),
        dedup_fingerprint: randomUUID(),
      })
      .select("id")
      .single();
    if (error || !job) throw new Error(`fixture job: ${error?.message}`);
    jobIds.push(job.id);
    const { error: assessErr } = await admin.from("job_posting_assessments").insert({
      job_posting_id: job.id,
      organization_id: orgId,
      title: "Test assessment",
      instructions: "Do the thing.",
      required: false,
    });
    if (assessErr) throw new Error(`fixture assessment: ${assessErr.message}`);
    return job.id;
  }

  async function makeApplication(user: AuthedTestUser, jobId: string): Promise<string> {
    const { data: resume, error: resumeErr } = await admin
      .from("resumes")
      .insert({
        user_id: user.id,
        structured_content: { contact: {}, summary: "", experience: [], education: [], skills: [] },
      })
      .select("id")
      .single();
    if (resumeErr || !resume) throw new Error(`fixture resume: ${resumeErr?.message}`);
    resumeIds.push(resume.id);
    const { data: application, error } = await admin
      .from("applications")
      .insert({
        user_id: user.id,
        job_posting_id: jobId,
        resume_id: resume.id,
        stage: "applied",
        source: "internal_apply",
        applied_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !application) throw new Error(`fixture application: ${error?.message}`);
    applicationIds.push(application.id);
    return application.id;
  }

  beforeAll(async () => {
    orgOwner = await createAuthedTestUser("stored-sub-owner");
    candidateA = await createAuthedTestUser("stored-sub-a");
    candidateB = await createAuthedTestUser("stored-sub-b");

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({ name: `Stored Submission Org ${randomUUID().slice(0, 8)}`, created_by: orgOwner.id, verified: true })
      .select("id")
      .single();
    if (orgErr || !org) throw new Error(`fixture org: ${orgErr?.message}`);
    orgId = org.id;
    await admin.from("organization_members").insert({ organization_id: orgId, user_id: orgOwner.id, role: "owner" });

    jobWithFile = await makeJob("file");
    jobTextOnly = await makeJob("text");
    appAFile = await makeApplication(candidateA, jobWithFile);
    appAText = await makeApplication(candidateA, jobTextOnly);
    appB = await makeApplication(candidateB, jobTextOnly);

    // A real upload, the way the candidate's browser does it before the RPC: the RPC checks the path prefix.
    const path = `${candidateA.id}/${jobWithFile}/${randomUUID()}.txt`;
    uploadedPaths.push(path);
    const content = "Candidate A's answer";
    const { error: uploadErr } = await candidateA.client.storage
      .from("job-assessment-submissions")
      .upload(path, new TextEncoder().encode(content), { contentType: "text/plain" });
    if (uploadErr) throw new Error(`fixture upload: ${uploadErr.message}`);

    const submit = (client: AuthedTestUser["client"], applicationId: string, files: Array<{ path: string; originalFilename: string; byteSize: number }>, text: string | null) =>
      client.rpc("submit_assessment_response", {
        p_application_id: applicationId,
        p_response_text: text,
        p_response_files: files,
        p_response_link: null,
      });

    const withFile = await submit(
      candidateA.client,
      appAFile,
      [{ path, originalFilename: "answer.txt", byteSize: content.length }],
      null,
    );
    if (withFile.error) throw new Error(`fixture submit (file): ${withFile.error.message}`);
    const textOnlyA = await submit(candidateA.client, appAText, [], "Candidate A's written answer.");
    if (textOnlyA.error) throw new Error(`fixture submit (text A): ${textOnlyA.error.message}`);
    const textOnlyB = await submit(candidateB.client, appB, [], "Candidate B's written answer.");
    if (textOnlyB.error) throw new Error(`fixture submit (text B): ${textOnlyB.error.message}`);

    const { data: sub, error: subErr } = await admin
      .from("application_assessment_submissions")
      .select("id")
      .eq("application_id", appAFile)
      .single();
    if (subErr || !sub) throw new Error(`fixture submission lookup: ${subErr?.message}`);
    submissionAFileId = sub.id;
  }, 90_000);

  afterAll(async () => {
    if (uploadedPaths.length > 0) await admin.storage.from("job-assessment-submissions").remove(uploadedPaths);
    for (const id of applicationIds) await admin.from("applications").delete().eq("id", id);
    for (const id of resumeIds) await admin.from("resumes").delete().eq("id", id);
    await deleteOrgsCascade(admin, [orgId].filter(Boolean));
    await deleteTestUsers([orgOwner.id, candidateA.id, candidateB.id].filter(Boolean));
  });

  it("a candidate sees their own stored wording, with the file by name", async () => {
    expect(await noteFor(candidateA.client, appAFile)).toBe("Submitted with answer.txt");
  });

  it("and 'Submitted without an attachment' when what they sent had no file", async () => {
    expect(await noteFor(candidateA.client, appAText)).toBe("Submitted without an attachment");
  });

  it("another candidate asking for that application gets nothing: no submission, no wording, no file names", async () => {
    for (const applicationId of [appAFile, appAText]) {
      expect(await fetchStoredSubmission(candidateB.client as unknown as SessionClient, applicationId)).toBeNull();
      expect(await noteFor(candidateB.client, applicationId)).toBeNull();
    }
  });

  it("nor can they read A's response-file rows directly, by submission id or unfiltered", async () => {
    const byId = await candidateB.client
      .from("application_assessment_response_files")
      .select("id, original_filename")
      .eq("application_assessment_submission_id", submissionAFileId);
    expect(byId.error).toBeNull();
    expect(byId.data).toEqual([]);

    const unfiltered = await candidateB.client.from("application_assessment_response_files").select("original_filename");
    expect(unfiltered.error).toBeNull();
    expect((unfiltered.data ?? []).map((r) => r.original_filename)).not.toContain("answer.txt");
  });

  it("their own wording is the same before and after they ask for someone else's", async () => {
    const before = await noteFor(candidateB.client, appB);
    expect(before).toBe("Submitted without an attachment");

    await noteFor(candidateB.client, appAFile);
    await noteFor(candidateB.client, appAText);

    expect(await noteFor(candidateB.client, appB)).toBe(before);
    // ... and A's is untouched by B having asked.
    expect(await noteFor(candidateA.client, appAFile)).toBe("Submitted with answer.txt");
  });

  it("the owning organisation can still read it (the policy is 'candidate or owning org', not candidate only)", async () => {
    const { data, error } = await orgOwner.client
      .from("application_assessment_response_files")
      .select("original_filename")
      .eq("application_assessment_submission_id", submissionAFileId);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.original_filename)).toEqual(["answer.txt"]);
  });
});
