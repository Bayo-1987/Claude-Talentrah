/**
 * send-404 — closing a public-read RLS gap on three job-posting child
 * tables: job_posting_screening_questions (0171), job_posting_assessments
 * (0177), job_posting_assessment_files (0178). All three shipped with a
 * bare `for select using (true)` policy, each justified as "same shape as
 * job_postings' own policy" — but none of them actually joined back to
 * job_postings to check it, so a posting invisible via job_postings' own
 * policy (removed, or belonging to an unverified org with no other
 * qualifying branch) still had its screening questions / assessment /
 * assessment files fully public. Fixed in migration 0182 by making each
 * policy `exists (select 1 from job_postings j where j.id = <this row's
 * posting id> and <job_postings' own live qual>)`.
 *
 * THIS FILE IS THE LIVE PROOF, not just a regression test written after the
 * fact: run against migration 0182 reverted, every "is NOT readable"
 * assertion below fails (the anon/outsider client reads the row back in
 * full) — confirmed directly before the migration was applied. Run against
 * 0182 applied, they pass. The positive-control and org-member cases are
 * unchanged in both runs, which is what proves this is a tightening, not a
 * new hole: nothing that was correctly public stopped being public, and the
 * owning org's own access (is_org_member) is untouched.
 *
 * Two states covered, matching job_postings' own removal/verification
 * tests: a REMOVED posting (org A, otherwise verified) and an
 * UNVERIFIED-ORG posting (org B, otherwise open) — neither qualifies for
 * job_postings' external/verified-org/unlisted/admin-approved branches, so
 * job_postings' own policy already hides the posting itself from anon/an
 * outsider. This file asserts the three child tables now agree.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

const anon: DB = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

interface Fixture {
  orgId: string;
  member: Awaited<ReturnType<typeof createAuthedTestUser>>;
  postingId: string;
  questionId: string;
  assessmentId: string;
  fileId: string;
}

async function buildFixture(tag: string, verified: boolean, status: "open" | "removed") {
  const member = await createAuthedTestUser(`screening-gate-${tag}`);

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({
      name: `SCREENING-GATE-TEST ${tag} Co`,
      domain: `screening-gate-${tag}-${randomUUID()}.test`,
      created_by: member.id,
      verified,
    })
    .select("id")
    .single();
  if (orgErr || !org) throw new Error(`fixture org (${tag}): ${orgErr?.message}`);

  const { error: memberErr } = await admin
    .from("organization_members")
    .insert({ organization_id: org.id, user_id: member.id, role: "owner" });
  if (memberErr) throw new Error(`fixture membership (${tag}): ${memberErr.message}`);

  const { data: posting, error: postingErr } = await admin
    .from("job_postings")
    .insert({
      company_name: `SCREENING-GATE-TEST ${tag} Co`,
      title: `SCREENING-GATE-TEST ${tag} posting`,
      description: "Fixture posting for tests/rls/screening-assessment-public-read-gate.",
      structured_jd: {},
      source_type: "internal",
      organization_id: org.id,
      status,
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
      ...(status === "removed"
        ? { removed_at: new Date().toISOString(), removal_reason: "SCREENING-GATE-TEST: fixture" }
        : {}),
    })
    .select("id")
    .single();
  if (postingErr || !posting) throw new Error(`fixture posting (${tag}): ${postingErr?.message}`);

  const { data: question, error: questionErr } = await admin
    .from("job_posting_screening_questions")
    .insert({
      job_posting_id: posting.id,
      question_text: "SCREENING-GATE-TEST: authorized to work?",
      question_type: "yes_no",
      expected_yes_no: true,
    })
    .select("id")
    .single();
  if (questionErr || !question) throw new Error(`fixture question (${tag}): ${questionErr?.message}`);

  const { data: assessment, error: assessmentErr } = await admin
    .from("job_posting_assessments")
    .insert({
      job_posting_id: posting.id,
      organization_id: org.id,
      title: "SCREENING-GATE-TEST assessment",
      instructions: "SCREENING-GATE-TEST: complete the attached exercise.",
    })
    .select("id")
    .single();
  if (assessmentErr || !assessment) throw new Error(`fixture assessment (${tag}): ${assessmentErr?.message}`);

  const { data: file, error: fileErr } = await admin
    .from("job_posting_assessment_files")
    .insert({
      job_posting_assessment_id: assessment.id,
      organization_id: org.id,
      file_path: `${org.id}/${assessment.id}/${randomUUID()}.pdf`,
      original_filename: "SCREENING-GATE-TEST-exercise.pdf",
      byte_size: 1024,
    })
    .select("id")
    .single();
  if (fileErr || !file) throw new Error(`fixture file (${tag}): ${fileErr?.message}`);

  return {
    orgId: org.id,
    member,
    postingId: posting.id,
    questionId: question.id,
    assessmentId: assessment.id,
    fileId: file.id,
  } satisfies Fixture;
}

let visible: Fixture; // positive control: verified org, open posting
let removed: Fixture; // job_postings' own policy already hides this from anon
let unverified: Fixture; // same — unverified org, no other qualifying branch
let outsider: Awaited<ReturnType<typeof createAuthedTestUser>>;

beforeAll(async () => {
  [visible, removed, unverified, outsider] = await Promise.all([
    buildFixture("visible", true, "open"),
    buildFixture("removed", true, "removed"),
    buildFixture("unverified", false, "open"),
    createAuthedTestUser("screening-gate-outsider"),
  ]);
});

afterAll(async () => {
  await deleteOrgsCascade(admin, [visible.orgId, removed.orgId, unverified.orgId]);
  await deleteTestUsers([visible.member.id, removed.member.id, unverified.member.id, outsider.id]);
});

describe("POSITIVE CONTROL: a publicly-visible posting's screening/assessment content stays public", () => {
  it("anon reads the screening question", async () => {
    const { data } = await anon
      .from("job_posting_screening_questions")
      .select("id")
      .eq("id", visible.questionId);
    expect(data).toEqual([{ id: visible.questionId }]);
  });

  it("anon reads the assessment", async () => {
    const { data } = await anon.from("job_posting_assessments").select("id").eq("id", visible.assessmentId);
    expect(data).toEqual([{ id: visible.assessmentId }]);
  });

  it("anon reads the assessment file", async () => {
    const { data } = await anon
      .from("job_posting_assessment_files")
      .select("id")
      .eq("id", visible.fileId);
    expect(data).toEqual([{ id: visible.fileId }]);
  });
});

describe.each([
  ["a removed posting", () => removed],
  ["an unverified-org posting", () => unverified],
])("%s — job_postings' own policy already hides it; these three tables must agree", (_label, getFixture) => {
  it("anon cannot read the screening question", async () => {
    const f = getFixture();
    const { data } = await anon.from("job_posting_screening_questions").select("id").eq("id", f.questionId);
    expect(data).toEqual([]);
  });

  it("a signed-in outsider cannot read the screening question either", async () => {
    const f = getFixture();
    const { data } = await outsider.client
      .from("job_posting_screening_questions")
      .select("id")
      .eq("id", f.questionId);
    expect(data).toEqual([]);
  });

  it("anon cannot read the assessment", async () => {
    const f = getFixture();
    const { data } = await anon.from("job_posting_assessments").select("id").eq("id", f.assessmentId);
    expect(data).toEqual([]);
  });

  it("anon cannot read the assessment file", async () => {
    const f = getFixture();
    const { data } = await anon.from("job_posting_assessment_files").select("id").eq("id", f.fileId);
    expect(data).toEqual([]);
  });

  it("but the owning org's own member can still read all three", async () => {
    const f = getFixture();
    const [q, a, file] = await Promise.all([
      f.member.client.from("job_posting_screening_questions").select("id").eq("id", f.questionId),
      f.member.client.from("job_posting_assessments").select("id").eq("id", f.assessmentId),
      f.member.client.from("job_posting_assessment_files").select("id").eq("id", f.fileId),
    ]);
    expect(q.data).toEqual([{ id: f.questionId }]);
    expect(a.data).toEqual([{ id: f.assessmentId }]);
    expect(file.data).toEqual([{ id: f.fileId }]);
  });
});
