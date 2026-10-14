/**
 * ASSESSMENT-VIEWER-1, the read behind /employer/jobs/<job>/applicants/<application>/assessment. Real database, real sessions. Every refusal is PAIRED with the owner's success in the same run, so a refusal cannot be
 * passing because "everything is refused": the owning organisation reads the answer, and each of these gets `not_found` instead: another organisation, the same organisation's OTHER job, a made-up application, a
 * made-up job, a signed-out caller. A job without an assessment, and an application without a response, are clear states of their own (never a crash, never a blank page).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { admin, createAuthedTestUser, createTestUser, deleteTestUsers, type TestUser } from "../support/auth";
import { deleteOrgsCascade, deletePostingsCascade } from "../support/delete-orgs";
import { loadAssessmentResponse, RESPONSE_FILE_LINK_SECONDS } from "@/lib/employer/assessment-response";
import { ASSESSMENT_SUBMISSION_BUCKET } from "@/lib/employer/assessment-document";

type Authed = Awaited<ReturnType<typeof createAuthedTestUser>>;
const ANSWER = `SELECT * FROM orders; <script>alert("x")</script> & more`;

let ownerA: Authed;
let ownerB: Authed;
const seekers: TestUser[] = [];
let orgA = "";
let orgB = "";
let jobWith = "";
let jobWithOther = "";
let jobWithout = "";
let appWithAnswer = "";
let appNoAnswer = "";
let appOnOtherJob = "";
let appOnJobWithout = "";
const jobs: string[] = [];
const uploaded: string[] = [];
const FILE_BODY = "the candidate's attached notes";
const orgs: string[] = [];

async function org(owner: Authed, label: string) {
  const { data, error } = await admin.from("organizations").insert({ name: `EMPLOYER-TEST Msg av ${label} ${randomUUID().slice(0, 8)}`, created_by: owner.id, verified: true }).select("id").single();
  if (error || !data) throw new Error(`org: ${error?.message}`);
  orgs.push(data.id);
  await admin.from("organization_members").insert({ organization_id: data.id, user_id: owner.id, role: "owner" });
  return data.id;
}
async function job(organizationId: string, title: string, assessment: boolean, createdBy: string) {
  const { data, error } = await admin
    .from("job_postings")
    .insert({ source_type: "internal", organization_id: organizationId, company_name: "EMPLOYER-TEST Co", title, description: "Fixture.", structured_jd: {}, status: "open", posted_at: new Date().toISOString(), dedup_fingerprint: randomUUID() })
    .select("id")
    .single();
  if (error || !data) throw new Error(`job: ${error?.message}`);
  jobs.push(data.id);
  if (assessment) {
    const a = await admin.from("job_posting_assessments").insert({ job_posting_id: data.id, organization_id: organizationId, title: "Take-home", instructions: "Do it.", required: false, created_by: createdBy });
    if (a.error) throw new Error(`assessment: ${a.error.message}`);
  }
  return data.id;
}
async function apply(user: TestUser, jobId: string) {
  const { data, error } = await admin.from("applications").insert({ user_id: user.id, job_posting_id: jobId, stage: "applied", source: "internal_apply", applied_at: new Date().toISOString() }).select("id").single();
  if (error || !data) throw new Error(`application: ${error?.message}`);
  // 0254's trigger has just recorded a pending new-applicant notification for this application (it records one whatever the member's setting is). This file reads nothing from that table, and a pending row
  // can be claimed by ANOTHER file's digest run, so it is removed in the same breath. Nothing here is ever mailed: the owners are also set to 'off' below, before any application exists.
  const gone = await admin.from("employer_applicant_notifications").delete().eq("application_id", data.id);
  if (gone.error) throw new Error(`notification cleanup: ${gone.error.message}`);
  return data.id;
}
const load = (client: Authed["client"], organizationId: string, jobId: string, applicationId: string) => loadAssessmentResponse(client, { organizationId, jobId, applicationId });

beforeAll(async () => {
  [ownerA, ownerB] = await Promise.all([createAuthedTestUser("av-a"), createAuthedTestUser("av-b")]);
  for (let i = 0; i < 4; i += 1) seekers.push(await createTestUser(`av-s${i}`));
  await admin.from("profiles").update({ first_name: "Joy", last_name: "Akindele" }).eq("id", seekers[0].id);
  // The two employers hear nothing about new applicants while this file runs, so even a digest run that raced the seed would have nobody to email.
  for (const owner of [ownerA, ownerB]) {
    const pref = await admin.from("email_preferences").update({ new_applicant_notice: "off" }).eq("user_id", owner.id);
    if (pref.error) throw new Error(`preference: ${pref.error.message}`);
  }
  orgA = await org(ownerA, "A");
  orgB = await org(ownerB, "B");
  jobWith = await job(orgA, "Job with assessment", true, ownerA.id);
  jobWithOther = await job(orgA, "Other job with assessment", true, ownerA.id);
  jobWithout = await job(orgA, "Job without assessment", false, ownerA.id);
  appWithAnswer = await apply(seekers[0], jobWith);
  appNoAnswer = await apply(seekers[1], jobWith);
  appOnOtherJob = await apply(seekers[2], jobWithOther);
  appOnJobWithout = await apply(seekers[3], jobWithout);
  const s = await admin.from("application_assessment_submissions").insert({ application_id: appWithAnswer, job_posting_id: jobWith, organization_id: orgA, response_text: ANSWER, response_link: "https://example.test/work" });
  if (s.error) throw new Error(`submission: ${s.error.message}`);
  const stored = await admin.from("application_assessment_submissions").select("id").eq("application_id", appWithAnswer).single();
  const filePath = `${orgA}/${appWithAnswer}/notes-${randomUUID().slice(0, 6)}.txt`;
  const up = await admin.storage.from(ASSESSMENT_SUBMISSION_BUCKET).upload(filePath, new Blob([FILE_BODY], { type: "text/plain" }), { contentType: "text/plain" });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  uploaded.push(filePath);
  const fileRow = await admin.from("application_assessment_response_files").insert({ application_assessment_submission_id: stored.data!.id, organization_id: orgA, file_path: filePath, original_filename: "notes.txt", byte_size: FILE_BODY.length });
  if (fileRow.error) throw new Error(`file row: ${fileRow.error.message}`);
  const t = await admin.from("application_assessment_submissions").insert({ application_id: appOnOtherJob, job_posting_id: jobWithOther, organization_id: orgA, response_text: "the other job's answer" });
  if (t.error) throw new Error(`submission 2: ${t.error.message}`);
}, 180_000);

afterAll(async () => {
  const userIds = [ownerA, ownerB, ...seekers].map((u) => u?.id).filter(Boolean) as string[];
  const appIds = [appWithAnswer, appNoAnswer, appOnOtherJob, appOnJobWithout].filter(Boolean);
  if (uploaded.length) await admin.storage.from(ASSESSMENT_SUBMISSION_BUCKET).remove(uploaded);
  // Pooled accounts keep their preferences between files: hand the two owners back at the default.
  for (const owner of [ownerA, ownerB]) if (owner) await admin.from("email_preferences").update({ new_applicant_notice: "instant" }).eq("user_id", owner.id);
  await admin.from("applications").delete().in("user_id", seekers.map((u) => u.id));
  await deletePostingsCascade(admin, jobs);
  await deleteOrgsCascade(admin, orgs);
  await deleteTestUsers(userIds);

  // PROOF THAT THIS FILE LEFT NOTHING BEHIND: every row it created, by id, in every table it wrote to. A leftover fails the file (and says which table).
  const left: string[] = [];
  const count = async (label: string, q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const { count: n, error } = await q;
    if (error) throw new Error(`cleanup check ${label}: ${error.message}`);
    if (n) left.push(`${label}: ${n}`);
  };
  await count("organizations", admin.from("organizations").select("id", { count: "exact", head: true }).in("id", orgs));
  await count("organization_members", admin.from("organization_members").select("organization_id", { count: "exact", head: true }).in("organization_id", orgs));
  await count("job_postings", admin.from("job_postings").select("id", { count: "exact", head: true }).in("id", jobs));
  await count("job_posting_assessments", admin.from("job_posting_assessments").select("id", { count: "exact", head: true }).in("job_posting_id", jobs));
  await count("applications", admin.from("applications").select("id", { count: "exact", head: true }).in("id", appIds));
  await count("application_assessment_submissions", admin.from("application_assessment_submissions").select("id", { count: "exact", head: true }).in("application_id", appIds));
  await count("employer_applicant_notifications", admin.from("employer_applicant_notifications").select("id", { count: "exact", head: true }).in("organization_id", orgs));
  await count("application_assessment_response_files", admin.from("application_assessment_response_files").select("id", { count: "exact", head: true }).in("organization_id", orgs));
  const listed = await admin.storage.from(ASSESSMENT_SUBMISSION_BUCKET).list(`${orgs[0] ?? "none"}/${appWithAnswer}`);
  if ((listed.data ?? []).length) left.push(`storage objects: ${(listed.data ?? []).length}`);
  if (left.length) throw new Error(`assessment-response-loader left rows behind: ${left.join("; ")}`);
});

describe("seeding: this file leaves no pending new-applicant notification behind for anyone else to claim", () => {
  // 0254's trigger records a pending employer_applicant_notifications row for every applied application of an internal job. This file reads nothing from that table, so a row it leaves
  // could be claimed by ANOTHER file's digest run (the global claim) and mailed to this file's owner in that file's recorder.
  it("after the seed there are zero employer_applicant_notifications rows for the seeded organisations", async () => {
    const { count, error } = await admin.from("employer_applicant_notifications").select("id", { count: "exact", head: true }).in("organization_id", orgs);
    expect(error).toBeNull();
    expect(count, "pending notification rows left by the seed").toBe(0);
  });
});

describe("the owning organisation reads the answer (the success every refusal below is paired with)", () => {
  it("returns the written answer, the link, the applicant's name and the job title: and nothing personal beyond that", async () => {
    const r = await load(ownerA.client, orgA, jobWith, appWithAnswer);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.submission.responseText).toBe(ANSWER);
    expect(r.submission.responseLink).toBe("https://example.test/work");
    expect(r.applicantName).toBe("Joy Akindele");
    expect(r.jobTitle).toBe("Job with assessment");
    const everything = JSON.stringify(r);
    expect(everything, "no email address anywhere in the result").not.toContain("@talentrah.test");
    expect(everything).not.toMatch(/phone|email/i);
  });
});

describe("not found, each paired with the owner's success above", () => {
  it("ANOTHER ORGANISATION: the same job and application, a different employer, is not_found, and none of the answer is in the result", async () => {
    expect((await load(ownerA.client, orgA, jobWith, appWithAnswer)).status).toBe("ok");
    const r = await load(ownerB.client, orgB, jobWith, appWithAnswer);
    expect(r).toEqual({ status: "not_found" });
    expect(JSON.stringify(r)).not.toContain("SELECT");
  });
  it("another organisation that passes the OWNER's organisation id is still not_found (the id is checked against the caller's own session, not trusted)", async () => {
    expect((await load(ownerA.client, orgA, jobWith, appWithAnswer)).status).toBe("ok");
    expect(await load(ownerB.client, orgA, jobWith, appWithAnswer)).toEqual({ status: "not_found" });
  });
  it("RIGHT ORGANISATION, OTHER JOB: an application that is on a different job of the same organisation is not_found under this job's address", async () => {
    expect((await load(ownerA.client, orgA, jobWithOther, appOnOtherJob)).status).toBe("ok");
    expect(await load(ownerA.client, orgA, jobWith, appOnOtherJob)).toEqual({ status: "not_found" });
    expect(await load(ownerA.client, orgA, jobWithOther, appWithAnswer)).toEqual({ status: "not_found" });
  });
  it("A MADE-UP APPLICATION ID and a made-up job id are not_found", async () => {
    expect((await load(ownerA.client, orgA, jobWith, appWithAnswer)).status).toBe("ok");
    expect(await load(ownerA.client, orgA, jobWith, randomUUID())).toEqual({ status: "not_found" });
    expect(await load(ownerA.client, orgA, randomUUID(), appWithAnswer)).toEqual({ status: "not_found" });
  });
  it("SIGNED OUT: a caller with no session reads nothing (not_found), while the owner reads the answer", async () => {
    expect((await load(ownerA.client, orgA, jobWith, appWithAnswer)).status).toBe("ok");
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    expect(await loadAssessmentResponse(anon as never, { organizationId: orgA, jobId: jobWith, applicationId: appWithAnswer })).toEqual({ status: "not_found" });
  });
});

describe("clear states, never a crash or a blank page", () => {
  it("an application with NO submitted response says so (no_submission), with the applicant's name", async () => {
    const r = await load(ownerA.client, orgA, jobWith, appNoAnswer);
    expect(r.status).toBe("no_submission");
    if (r.status === "no_submission") expect(r.jobTitle).toBe("Job with assessment");
  });
  it("a job with NO assessment says so (no_assessment)", async () => {
    const r = await load(ownerA.client, orgA, jobWithout, appOnJobWithout);
    expect(r.status).toBe("no_assessment");
  });
});

describe("file links: short-lived signed URLs, made only after the ownership check", () => {
  const tokenExpiry = (url: string) => {
    const token = new URL(url).searchParams.get("token") ?? "";
    return (JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as { exp: number }).exp;
  };

  it("the owner gets a SIGNED url (never a public one) that expires within the lifetime constant and really serves the file", async () => {
    const r = await load(ownerA.client, orgA, jobWith, appWithAnswer);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.submission.responseFiles).toHaveLength(1);
    const url = r.submission.responseFiles[0].url!;
    expect(url, "a signed url").toContain("/object/sign/");
    expect(url, "never a public url").not.toContain("/object/public/");
    expect(new URL(url).searchParams.get("token"), "carries a token").toBeTruthy();
    const secondsLeft = tokenExpiry(url) - Math.floor(Date.now() / 1000);
    expect(RESPONSE_FILE_LINK_SECONDS).toBe(3600);
    expect(secondsLeft, "short-lived").toBeGreaterThan(0);
    expect(secondsLeft).toBeLessThanOrEqual(RESPONSE_FILE_LINK_SECONDS + 5);
    const served = await fetch(url);
    expect(served.ok).toBe(true);
    expect(await served.text()).toBe(FILE_BODY);
  });

  it("the bucket has no public URL: the plain object address answers an error with no file", async () => {
    const r = await load(ownerA.client, orgA, jobWith, appWithAnswer);
    if (r.status !== "ok") throw new Error("owner read failed");
    const path = decodeURIComponent(new URL(r.submission.responseFiles[0].url!).pathname.split("/object/sign/")[1]).replace(`${ASSESSMENT_SUBMISSION_BUCKET}/`, "");
    const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${ASSESSMENT_SUBMISSION_BUCKET}/${path}`;
    const res = await fetch(publicUrl);
    expect(res.ok, `public address status ${res.status}`).toBe(false);
    expect(await res.text()).not.toContain(FILE_BODY);
  });

  it("no storage call at all is made for a refused caller (another organisation, other job, made-up id, signed out): the link is created only AFTER the ownership check", async () => {
    // Paired with the owner above: the same file exists and the owner got a link.
    const ownerSpy = vi.spyOn(ownerA.client.storage, "from");
    expect((await load(ownerA.client, orgA, jobWith, appWithAnswer)).status).toBe("ok");
    expect(ownerSpy, "the owner's read does use storage").toHaveBeenCalledWith(ASSESSMENT_SUBMISSION_BUCKET);
    ownerSpy.mockRestore();

    const otherSpy = vi.spyOn(ownerB.client.storage, "from");
    expect(await load(ownerB.client, orgB, jobWith, appWithAnswer)).toEqual({ status: "not_found" });
    expect(await load(ownerB.client, orgA, jobWith, appWithAnswer)).toEqual({ status: "not_found" });
    expect(otherSpy, "another organisation never reaches storage").not.toHaveBeenCalled();
    otherSpy.mockRestore();

    const wrongJobSpy = vi.spyOn(ownerA.client.storage, "from");
    expect(await load(ownerA.client, orgA, jobWithOther, appWithAnswer)).toEqual({ status: "not_found" });
    expect(await load(ownerA.client, orgA, jobWith, randomUUID())).toEqual({ status: "not_found" });
    expect(wrongJobSpy, "a mismatched job or a made-up id never reaches storage").not.toHaveBeenCalled();
    wrongJobSpy.mockRestore();

    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const anonSpy = vi.spyOn(anon.storage, "from");
    expect(await loadAssessmentResponse(anon as never, { organizationId: orgA, jobId: jobWith, applicationId: appWithAnswer })).toEqual({ status: "not_found" });
    expect(anonSpy, "a signed-out caller never reaches storage").not.toHaveBeenCalled();
  });
});
