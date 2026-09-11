/**
 * 0125 — the real employer-applicant view. Three new SECURITY-boundary
 * surfaces, all new: `employer_job_applicants` (identity-bearing, unlike
 * 0029/0059's aggregate-only counts), `employer_view_resume`, and the
 * `employer_applicant_status` table's own RLS.
 *
 * This codebase's own history (0027, 0028, 0107–0109) is a documented run of
 * RLS/definer-function mistakes that leaked data across boundaries that
 * looked closed — that is the bar this suite has to clear, not a checklist.
 *
 * ── HOW EACH ISOLATION CLAIM WAS ACTUALLY PROVEN, STATED PLAINLY ──────────
 *
 * `employer_applicant_status`'s RLS policies were caught for real, not by a
 * staged sabotage: the first version of this migration inlined an EXISTS
 * clause referencing `applications`/`job_postings` directly inside the
 * policy, and this suite's very first run failed the LEGITIMATE case — the
 * owning org's own write was refused with a real 42501 — because a plain
 * RLS policy's subquery runs as the calling role and inherits
 * `applications`' owner-only RLS instead of bypassing it. See migration
 * 0125's own header for the fix (a SECURITY DEFINER helper,
 * `is_org_member_for_application`). That is genuine "the test caught a real
 * bug" evidence, not a synthetic exercise.
 *
 * `employer_job_applicants` and `employer_view_resume` were NOT sabotaged by
 * deploying a deliberately-unguarded version to either Supabase project —
 * Claude Code's own auto-mode classifier declined that action outright, and
 * rightly so: briefly deploying a real, callable, granted-to-`authenticated`
 * function with its membership check removed is a real exposure window on a
 * shared project, not a contained experiment. What's checked instead is the
 * structural reason those two never had the applicant-status bug in the
 * first place: both are themselves SECURITY DEFINER (unlike a table's own
 * RLS policy), so their own function bodies bypass `applications`' RLS
 * entirely when reading it — there is no inherited-policy trap for their
 * `is_org_member(...)` check to fall into. The "does the isolation check
 * actually gate anything" question is answered by testing `is_org_member`
 * itself against a real, mismatched (org, caller) pair directly, below —
 * proving the exact primitive both functions' WHERE clauses depend on
 * genuinely discriminates true/false, rather than trusting that it does.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type TestUser } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";

type AuthedTestUser = Awaited<ReturnType<typeof createAuthedTestUser>>;

let seeker: TestUser;
let orgOwnerA: AuthedTestUser;
let orgOwnerB: AuthedTestUser;
let orgIdA: string;
let orgIdB: string;
let jobIdA: string;
let jobIdB: string;
let applicationId: string;
let resumeId: string;

beforeAll(async () => {
  [seeker, orgOwnerA, orgOwnerB] = await Promise.all([
    createAuthedTestUser("eav-seeker"),
    createAuthedTestUser("eav-owner-a"),
    createAuthedTestUser("eav-owner-b"),
  ]);

  const [{ data: orgA, error: orgAErr }, { data: orgB, error: orgBErr }] = await Promise.all([
    admin
      .from("organizations")
      .insert({ name: `EAV-TEST Org A ${randomUUID().slice(0, 8)}`, created_by: orgOwnerA.id, verified: true })
      .select("id")
      .single(),
    admin
      .from("organizations")
      .insert({ name: `EAV-TEST Org B ${randomUUID().slice(0, 8)}`, created_by: orgOwnerB.id, verified: true })
      .select("id")
      .single(),
  ]);
  if (orgAErr || !orgA) throw new Error(`fixture org A: ${orgAErr?.message}`);
  if (orgBErr || !orgB) throw new Error(`fixture org B: ${orgBErr?.message}`);
  orgIdA = orgA.id;
  orgIdB = orgB.id;

  const [memA, memB] = await Promise.all([
    admin.from("organization_members").insert({ organization_id: orgIdA, user_id: orgOwnerA.id, role: "owner" }),
    admin.from("organization_members").insert({ organization_id: orgIdB, user_id: orgOwnerB.id, role: "owner" }),
  ]);
  if (memA.error) throw new Error(`fixture membership A: ${memA.error.message}`);
  if (memB.error) throw new Error(`fixture membership B: ${memB.error.message}`);

  // Names on the profile, not just the resume's own structured_content — the
  // function reads profiles.first_name/last_name, and createAuthedTestUser
  // leaves them null by default.
  const { error: nameErr } = await admin
    .from("profiles")
    .update({ first_name: "EAV", last_name: "Seeker" })
    .eq("id", seeker.id);
  if (nameErr) throw new Error(`fixture profile name: ${nameErr.message}`);

  const [{ data: jobA, error: jobAErr }, { data: jobB, error: jobBErr }] = await Promise.all([
    admin
      .from("job_postings")
      .insert({
        source_type: "internal",
        organization_id: orgIdA,
        company_name: "EAV-TEST Co A",
        title: `EAV-TEST Role A ${randomUUID().slice(0, 8)}`,
        description: "Fixture posting for the employer-applicant-view RLS suite.",
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
        organization_id: orgIdB,
        company_name: "EAV-TEST Co B",
        title: `EAV-TEST Role B ${randomUUID().slice(0, 8)}`,
        description: "Fixture posting for the employer-applicant-view RLS suite.",
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
  jobIdA = jobA.id;
  jobIdB = jobB.id;

  // A resume + an application to job A. Seeded with the service role — the
  // same reason 0029's own test does: applications/resumes are owner-only,
  // and an employer legitimately cannot write either.
  const { data: resume, error: resumeErr } = await admin
    .from("resumes")
    .insert({
      user_id: seeker.id,
      structured_content: {
        contact: { name: "EAV Test Seeker" },
        summary: "Fixture resume for the employer-applicant-view RLS suite.",
        experience: [],
        education: [],
        skills: ["sql"],
      },
    })
    .select("id")
    .single();
  if (resumeErr || !resume) throw new Error(`fixture resume: ${resumeErr?.message}`);
  resumeId = resume.id;

  const { data: application, error: applicationErr } = await admin
    .from("applications")
    .insert({
      user_id: seeker.id,
      job_posting_id: jobIdA,
      resume_id: resumeId,
      stage: "applied",
      source: "internal_apply",
      applied_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (applicationErr || !application) throw new Error(`fixture application: ${applicationErr?.message}`);
  applicationId = application.id;
}, 60_000);

afterAll(async () => {
  if (applicationId) await admin.from("applications").delete().eq("id", applicationId);
  if (resumeId) await admin.from("resumes").delete().eq("id", resumeId);
  await deleteOrgsCascade(admin, [orgIdA, orgIdB].filter(Boolean));
  await deleteTestUsers([seeker.id, orgOwnerA.id, orgOwnerB.id].filter(Boolean));
});

describe("is_org_member — the exact primitive both employer_job_applicants and employer_view_resume gate on", () => {
  it("returns true for the real member, false for the real non-member, against the SAME org", async () => {
    const [{ data: memberResult, error: memberErr }, { data: outsiderResult, error: outsiderErr }] =
      await Promise.all([
        orgOwnerA.client.rpc("is_org_member", { p_organization_id: orgIdA }),
        orgOwnerB.client.rpc("is_org_member", { p_organization_id: orgIdA }),
      ]);
    expect(memberErr).toBeNull();
    expect(outsiderErr).toBeNull();
    expect(memberResult, "the real member of org A must read as a member").toBe(true);
    expect(
      outsiderResult,
      "SABOTAGE-PROOF TARGET: a real member of a DIFFERENT org must not read as a member of org A",
    ).toBe(false);
  });
});

describe("employer_job_applicants — identity-bearing, org-scoped", () => {
  it("the owning org sees the real applicant", async () => {
    const { data, error } = await orgOwnerA.client.rpc("employer_job_applicants", {
      p_job_posting_id: jobIdA,
    });
    expect(error).toBeNull();
    const row = (data ?? []).find((r) => r.application_id === applicationId);
    expect(row, "the owning org should see its own real applicant").toBeDefined();
    expect(row?.first_name).toBe("EAV Test Seeker".split(" ")[0]);
    expect(row?.resume_id).toBe(resumeId);
    // Default status, since no employer_applicant_status row exists yet.
    expect(row?.status, "an applicant with no status row must read as 'new'").toBe("new");
    // Never anything from applications.stage, notes, or the seeker's email —
    // only the columns the function's own return type declares.
    expect(Object.keys(row ?? {}).sort()).toEqual(
      ["application_id", "applied_at", "first_name", "last_name", "resume_id", "status"].sort(),
    );
  });

  it(
    "SABOTAGE-PROOF TARGET: an unrelated org (B) gets zero rows for org A's job posting — not an " +
      "error, not org A's data",
    async () => {
      const { data, error } = await orgOwnerB.client.rpc("employer_job_applicants", {
        p_job_posting_id: jobIdA,
      });
      expect(error).toBeNull();
      expect(
        data ?? [],
        "LEAK: an unrelated organisation read another org's applicant list",
      ).toHaveLength(0);
    },
  );

  it("symmetric: org A gets zero rows (and no error) for org B's own job posting", async () => {
    const { data, error } = await orgOwnerA.client.rpc("employer_job_applicants", {
      p_job_posting_id: jobIdB,
    });
    expect(error).toBeNull();
    expect(data ?? [], "LEAK: org A read org B's job posting via a legitimate-looking id").toHaveLength(0);
  });

  it("an anonymous/signed-out caller has no EXECUTE grant at all", async () => {
    // anon has no organisation to be a member of — same reasoning 0029/0059
    // both give for withholding this grant.
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error } = await anon.rpc("employer_job_applicants", { p_job_posting_id: jobIdA });
    expect(error, "anon should be refused EXECUTE, not merely returned an empty list").not.toBeNull();
  });
});

describe("employer_view_resume — the only door to a resume's structured_content", () => {
  it("the owning org can view the real applicant's resume", async () => {
    const { data, error } = await orgOwnerA.client
      .rpc("employer_view_resume", { p_application_id: applicationId })
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.structured_content).toBeTruthy();
    const content = data?.structured_content as { contact?: { name?: string } } | null;
    expect(content?.contact?.name).toBe("EAV Test Seeker");
  });

  it(
    "SABOTAGE-PROOF TARGET: an unrelated org (B) gets nothing for org A's application, even " +
      "knowing its real (not guessed) application id",
    async () => {
      const { data, error } = await orgOwnerB.client
        .rpc("employer_view_resume", { p_application_id: applicationId })
        .maybeSingle();
      expect(error).toBeNull();
      expect(
        data,
        "LEAK: an unrelated organisation read an applicant's resume content",
      ).toBeNull();
    },
  );

  it("a fabricated/enumerated application id returns nothing, not an error that would confirm it exists", async () => {
    const { data, error } = await orgOwnerA.client
      .rpc("employer_view_resume", { p_application_id: randomUUID() })
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});

describe("employer_applicant_status — RLS-scoped table, not a definer function", () => {
  afterAll(async () => {
    await admin.from("employer_applicant_status").delete().eq("application_id", applicationId);
  });

  it("the owning org can set and read a status", async () => {
    const { error: writeError } = await orgOwnerA.client
      .from("employer_applicant_status")
      .upsert({ application_id: applicationId, status: "shortlisted" }, { onConflict: "application_id" });
    expect(writeError).toBeNull();

    const { data, error } = await orgOwnerA.client
      .from("employer_applicant_status")
      .select("status, updated_by")
      .eq("application_id", applicationId)
      .single();
    expect(error).toBeNull();
    expect(data?.status).toBe("shortlisted");
    // Stamped by the trigger from auth.uid(), never trusted from the client.
    expect(data?.updated_by).toBe(orgOwnerA.id);

    // employer_job_applicants must reflect the real row now, not the 'new' default.
    const { data: rows } = await orgOwnerA.client.rpc("employer_job_applicants", {
      p_job_posting_id: jobIdA,
    });
    expect(rows?.find((r) => r.application_id === applicationId)?.status).toBe("shortlisted");
  });

  it(
    "SABOTAGE-PROOF TARGET: an unrelated org (B) cannot write a status onto org A's applicant",
    async () => {
      const { error, data } = await orgOwnerB.client
        .from("employer_applicant_status")
        .upsert({ application_id: applicationId, status: "not_a_fit" }, { onConflict: "application_id" })
        .select();
      // RLS refuses the write outright (no rows affected / policy violation) —
      // either an error or a silently-empty result is acceptable here, but the
      // row's real status must be provably unchanged either way.
      const { data: real } = await admin
        .from("employer_applicant_status")
        .select("status")
        .eq("application_id", applicationId)
        .maybeSingle();
      expect(
        real?.status,
        "ESCALATION: an unrelated organisation changed another org's applicant status",
      ).not.toBe("not_a_fit");
      void error;
      void data;
    },
  );

  it("an unrelated org (B) cannot even read org A's applicant status row", async () => {
    await admin
      .from("employer_applicant_status")
      .upsert({ application_id: applicationId, status: "interviewing" }, { onConflict: "application_id" });

    const { data } = await orgOwnerB.client
      .from("employer_applicant_status")
      .select("status")
      .eq("application_id", applicationId)
      .maybeSingle();
    expect(data, "LEAK: an unrelated organisation read another org's applicant status").toBeNull();
  });
});

describe("nothing here loosens the seeker's own applications/resumes RLS", () => {
  it("an org member still cannot read `applications` or `resumes` directly — only through the new functions", async () => {
    const { data: rawApplications } = await orgOwnerA.client
      .from("applications")
      .select("id")
      .eq("id", applicationId);
    expect(
      rawApplications ?? [],
      "an org member must not gain direct table access to applications",
    ).toHaveLength(0);

    const { data: rawResumes } = await orgOwnerA.client.from("resumes").select("id").eq("id", resumeId);
    expect(rawResumes ?? [], "an org member must not gain direct table access to resumes").toHaveLength(0);
  });
});

/**
 * 0151's own standing check — see that migration's header. The owning org's
 * own upsert (setApplicantStatusAction) is untouched — this proves only the
 * DELETE gap is closed, not the real, working write path.
 */
describe("0151: employer_applicant_status has no direct client DELETE, at the grant level", () => {
  it("the owning org cannot delete the status row for their own application", async () => {
    const { error } = await orgOwnerA.client
      .from("employer_applicant_status")
      .delete()
      .eq("application_id", applicationId);
    expect(error?.code, "GRANT BUG: employer_applicant_status DELETE not refused at the grant level").toBe(
      "42501",
    );
  });
});
