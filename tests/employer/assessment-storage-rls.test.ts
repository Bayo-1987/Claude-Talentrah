/**
 * Storage RLS for the two assessment buckets (send-346 v2, migration 0177)
 * — the riskiest new surface in this build, per the feature's own spec,
 * and tested directly against real signed-in clients rather than assumed
 * from reading the policy SQL.
 *
 * ── job-assessment-submissions IS THE HARD CASE ───────────────────────────
 *
 * 0115's job-banners policy only ever had to check ONE party (org
 * membership). This bucket needs EITHER of two: the submitting candidate,
 * or a member of the owning organisation — resolved by a SECURITY DEFINER
 * helper, `can_access_assessment_submission`. All four read combinations
 * are tested below, not just the two that are supposed to work — a
 * regression that accidentally widened the policy (e.g. dropping the
 * `is_org_member` scoping and matching any org) would only show up in the
 * "wrong org" and "wrong candidate" cases, which is exactly why those two
 * are asserted just as carefully as the two that should succeed.
 *
 * ── THE EXECUTE GRANT IS ITS OWN EXPLICIT TEST ────────────────────────────
 *
 * CLAUDE.md's own recorded lesson: "If an RLS policy calls a function,
 * every role that evaluates that policy needs EXECUTE on it." A missing
 * grant is a SILENT denial, not an error — every read would look like "the
 * policy correctly refused," indistinguishable from a real refusal, unless
 * something asserts the grant exists directly. Mirrors
 * tests/rls/column-privileges.test.ts's own reasoning for existing at all.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";

type AuthedTestUser = Awaited<ReturnType<typeof createAuthedTestUser>>;

let orgAOwner: AuthedTestUser;
let orgBOwner: AuthedTestUser;
let candidate1: AuthedTestUser;
let candidate2: AuthedTestUser;
let orgAId: string;
let orgBId: string;
let jobId: string;
let applicationId: string;
const resumeIds: string[] = [];

const submissionPath = () => `${candidate1.id}/${jobId}.txt`;
const exercisePath = () => `${orgAId}/${jobId}.pdf`;

beforeAll(async () => {
  orgAOwner = await createAuthedTestUser("assess-storage-orgA-owner");
  orgBOwner = await createAuthedTestUser("assess-storage-orgB-owner");
  candidate1 = await createAuthedTestUser("assess-storage-cand1");
  candidate2 = await createAuthedTestUser("assess-storage-cand2");

  const { data: orgA, error: orgAErr } = await admin
    .from("organizations")
    .insert({ name: `Assess Storage OrgA ${randomUUID().slice(0, 8)}`, created_by: orgAOwner.id, verified: true })
    .select("id")
    .single();
  if (orgAErr || !orgA) throw new Error(`fixture orgA: ${orgAErr?.message}`);
  orgAId = orgA.id;

  const { data: orgB, error: orgBErr } = await admin
    .from("organizations")
    .insert({ name: `Assess Storage OrgB ${randomUUID().slice(0, 8)}`, created_by: orgBOwner.id, verified: true })
    .select("id")
    .single();
  if (orgBErr || !orgB) throw new Error(`fixture orgB: ${orgBErr?.message}`);
  orgBId = orgB.id;

  await admin.from("organization_members").insert([
    { organization_id: orgAId, user_id: orgAOwner.id, role: "owner" },
    { organization_id: orgBId, user_id: orgBOwner.id, role: "owner" },
  ]);

  const { data: job, error: jobErr } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: orgAId,
      company_name: "Assess Storage Test Co",
      title: `Assess Storage Test Role ${randomUUID().slice(0, 8)}`,
      description: "Fixture posting for assessment storage RLS.",
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
    organization_id: orgAId,
    title: "Test assessment",
    instructions: "Do the thing.",
    required: false,
  });
  if (assessErr) throw new Error(`fixture assessment: ${assessErr.message}`);

  const { data: resume, error: resumeErr } = await admin
    .from("resumes")
    .insert({
      user_id: candidate1.id,
      structured_content: { contact: {}, summary: "", experience: [], education: [], skills: [] },
    })
    .select("id")
    .single();
  if (resumeErr || !resume) throw new Error(`fixture resume: ${resumeErr?.message}`);
  resumeIds.push(resume.id);

  const { data: application, error: appErr } = await admin
    .from("applications")
    .insert({
      user_id: candidate1.id,
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
  await admin.storage.from("job-assessment-submissions").remove([submissionPath()]);
  await admin.storage.from("job-assessment-exercises").remove([exercisePath()]);
  await admin.from("applications").delete().eq("id", applicationId);
  for (const id of resumeIds) await admin.from("resumes").delete().eq("id", id);
  await deleteOrgsCascade(admin, [orgAId, orgBId].filter(Boolean));
  await deleteTestUsers(
    [orgAOwner.id, orgBOwner.id, candidate1.id, candidate2.id].filter(Boolean) as string[],
  );
});

describe("job-assessment-submissions — private, two-party read", () => {
  it("the candidate can upload into their own folder", async () => {
    const bytes = new TextEncoder().encode("My assessment response.");
    const { error } = await candidate1.client.storage
      .from("job-assessment-submissions")
      .upload(submissionPath(), bytes, { contentType: "text/plain", upsert: true });
    expect(error).toBeNull();
  });

  it("a DIFFERENT candidate cannot write into candidate1's folder", async () => {
    const forged = `${candidate1.id}/${jobId}-forged.txt`;
    const { error } = await candidate2.client.storage
      .from("job-assessment-submissions")
      .upload(forged, new TextEncoder().encode("forged"), { contentType: "text/plain", upsert: true });
    expect(error, "a forged write into someone else's folder must be refused").not.toBeNull();
  });

  it("records the submission via submit_assessment_response, as the candidate", async () => {
    const { data, error } = await candidate1.client.rpc("submit_assessment_response", {
      p_application_id: applicationId,
      p_response_text: null,
      p_response_file_path: submissionPath(),
      p_response_link: null,
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it("the SUBMITTING CANDIDATE can read their own file", async () => {
    const { data, error } = await candidate1.client.storage
      .from("job-assessment-submissions")
      .download(submissionPath());
    expect(error).toBeNull();
    expect(data?.size).toBeGreaterThan(0);
  });

  it("a member of the OWNING organisation can read the file", async () => {
    const { data, error } = await orgAOwner.client.storage
      .from("job-assessment-submissions")
      .download(submissionPath());
    expect(error).toBeNull();
    expect(data?.size).toBeGreaterThan(0);
  });

  it("a member of a DIFFERENT organisation CANNOT read the file", async () => {
    const { data, error } = await orgBOwner.client.storage
      .from("job-assessment-submissions")
      .download(submissionPath());
    expect(error, "a different org's member must be refused").not.toBeNull();
    expect(data).toBeNull();
  });

  it("a DIFFERENT candidate CANNOT read the file", async () => {
    const { data, error } = await candidate2.client.storage
      .from("job-assessment-submissions")
      .download(submissionPath());
    expect(error, "a different candidate must be refused").not.toBeNull();
    expect(data).toBeNull();
  });

  it(
    "EXPLICIT GRANT CHECK: authenticated has EXECUTE on can_access_assessment_submission",
    async () => {
      /*
       * PostgREST does not expose information_schema/pg_proc to the JS
       * client (confirmed against this same project while building this
       * feature — see 0113's own header for the identical finding about
       * the storage schema), so this cannot query pg_proc's ACL directly
       * the way a raw psql session could. What it CAN do, and what this
       * asserts, is the grant's own real-world EFFECT: `orgAOwner` is not
       * the uploader, so their read has no path to success that doesn't
       * go through can_access_assessment_submission's `is_org_member`
       * branch — a missing EXECUTE grant would make this call error/return
       * false for EVERY caller, including orgAOwner, which is exactly the
       * silent-denial shape CLAUDE.md's 0027 lesson describes. This is
       * deliberately a SEPARATE, explicitly-named test from "owning org can
       * read" above (same assertion) specifically so a reader — or a
       * future regression's own failure output — sees "the grant check
       * failed" rather than a generic "owning org couldn't read," the same
       * reason tests/rls/column-privileges.test.ts exists as its own file
       * rather than being folded into a general RLS suite.
       */
      const { data, error } = await orgAOwner.client.storage
        .from("job-assessment-submissions")
        .download(submissionPath());
      expect(
        error,
        "a non-null error here most likely means EXECUTE is not granted to authenticated on can_access_assessment_submission",
      ).toBeNull();
      expect(data?.size).toBeGreaterThan(0);
    },
  );
});

describe("job-assessment-exercises — public read, org-scoped write", () => {
  it("orgA can upload its own exercise document", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4\nfixture pdf content");
    const { error } = await orgAOwner.client.storage
      .from("job-assessment-exercises")
      .upload(exercisePath(), bytes, { contentType: "application/pdf", upsert: true });
    expect(error).toBeNull();
  });

  it("a SIGNED-OUT visitor can read the exercise document — same as a public job description", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { data, error } = await anon.storage.from("job-assessment-exercises").download(exercisePath());
    expect(error).toBeNull();
    expect(data?.size).toBeGreaterThan(0);
  });

  it("orgB CANNOT overwrite orgA's exercise file — write stays org-scoped", async () => {
    const { error } = await orgBOwner.client.storage
      .from("job-assessment-exercises")
      .upload(exercisePath(), new TextEncoder().encode("%PDF-1.4\nmalicious overwrite"), {
        contentType: "application/pdf",
        upsert: true,
      });
    expect(error, "a different org must be refused a write to orgA's own path").not.toBeNull();
  });
});
