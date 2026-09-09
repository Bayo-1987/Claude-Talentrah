/**
 * 0126 — the other half of the 0125/PR #329 consent decision (CLAUDE.md):
 * applying is still implicit consent, no gate, no opt-out — but the seeker's
 * Job Tracker now shows when an employer has actually opened their resume.
 *
 * Two new surfaces, same weight as 0125's own suite:
 *   - `record_employer_resume_view` (employer side, SECURITY DEFINER, same
 *     membership-check shape as `is_org_member_for_application`)
 *   - `seeker_application_view_status` (seeker side, SECURITY DEFINER, gated
 *     on the CALLER'S OWN `applications.user_id`, not org membership)
 *
 * The isolation bar is the same one 0125 set: prove the unrelated-party case
 * fails (or in this case, has no effect and leaks nothing) before trusting
 * the legitimate case works.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";

type AuthedTestUser = Awaited<ReturnType<typeof createAuthedTestUser>>;

let seekerA: AuthedTestUser;
let seekerB: AuthedTestUser;
let orgOwnerA: AuthedTestUser;
let orgOwnerB: AuthedTestUser;
let orgIdA: string;
let orgIdB: string;
let jobIdA: string;
let applicationIdA: string; // seekerA's application to job A — the one under test
let applicationIdB: string; // seekerB's application to job A — for cross-seeker isolation
let resumeIdA: string;
let resumeIdB: string;

beforeAll(async () => {
  [seekerA, seekerB, orgOwnerA, orgOwnerB] = await Promise.all([
    createAuthedTestUser("ervn-seeker-a"),
    createAuthedTestUser("ervn-seeker-b"),
    createAuthedTestUser("ervn-owner-a"),
    createAuthedTestUser("ervn-owner-b"),
  ]);

  const [{ data: orgA, error: orgAErr }, { data: orgB, error: orgBErr }] = await Promise.all([
    admin
      .from("organizations")
      .insert({ name: `ERVN-TEST Org A ${randomUUID().slice(0, 8)}`, created_by: orgOwnerA.id, verified: true })
      .select("id")
      .single(),
    admin
      .from("organizations")
      .insert({ name: `ERVN-TEST Org B ${randomUUID().slice(0, 8)}`, created_by: orgOwnerB.id, verified: true })
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

  const { data: jobA, error: jobAErr } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: orgIdA,
      company_name: "ERVN-TEST Co A",
      title: `ERVN-TEST Role A ${randomUUID().slice(0, 8)}`,
      description: "Fixture posting for the employer-resume-view-notice RLS suite.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
    })
    .select("id")
    .single();
  if (jobAErr || !jobA) throw new Error(`fixture job A: ${jobAErr?.message}`);
  jobIdA = jobA.id;

  const [{ data: resumeA, error: resumeAErr }, { data: resumeB, error: resumeBErr }] = await Promise.all([
    admin
      .from("resumes")
      .insert({
        user_id: seekerA.id,
        structured_content: {
          contact: { name: "ERVN Seeker A" },
          summary: "Fixture resume A.",
          experience: [],
          education: [],
          skills: ["sql"],
        },
      })
      .select("id")
      .single(),
    admin
      .from("resumes")
      .insert({
        user_id: seekerB.id,
        structured_content: {
          contact: { name: "ERVN Seeker B" },
          summary: "Fixture resume B.",
          experience: [],
          education: [],
          skills: ["sql"],
        },
      })
      .select("id")
      .single(),
  ]);
  if (resumeAErr || !resumeA) throw new Error(`fixture resume A: ${resumeAErr?.message}`);
  if (resumeBErr || !resumeB) throw new Error(`fixture resume B: ${resumeBErr?.message}`);
  resumeIdA = resumeA.id;
  resumeIdB = resumeB.id;

  const [{ data: appA, error: appAErr }, { data: appB, error: appBErr }] = await Promise.all([
    admin
      .from("applications")
      .insert({
        user_id: seekerA.id,
        job_posting_id: jobIdA,
        resume_id: resumeIdA,
        stage: "applied",
        source: "internal_apply",
        applied_at: new Date().toISOString(),
      })
      .select("id")
      .single(),
    admin
      .from("applications")
      .insert({
        user_id: seekerB.id,
        job_posting_id: jobIdA,
        resume_id: resumeIdB,
        stage: "applied",
        source: "internal_apply",
        applied_at: new Date().toISOString(),
      })
      .select("id")
      .single(),
  ]);
  if (appAErr || !appA) throw new Error(`fixture application A: ${appAErr?.message}`);
  if (appBErr || !appB) throw new Error(`fixture application B: ${appBErr?.message}`);
  applicationIdA = appA.id;
  applicationIdB = appB.id;
}, 60_000);

afterAll(async () => {
  for (const id of [applicationIdA, applicationIdB].filter(Boolean)) {
    await admin.from("applications").delete().eq("id", id);
  }
  for (const id of [resumeIdA, resumeIdB].filter(Boolean)) {
    await admin.from("resumes").delete().eq("id", id);
  }
  await deleteOrgsCascade(admin, [orgIdA, orgIdB].filter(Boolean));
  await deleteTestUsers([seekerA.id, seekerB.id, orgOwnerA.id, orgOwnerB.id].filter(Boolean));
});

describe("record_employer_resume_view — the employer side", () => {
  afterAll(async () => {
    await admin.from("employer_applicant_status").delete().eq("application_id", applicationIdA);
  });

  it(
    "SABOTAGE-PROOF TARGET: an unrelated org (B) calling this for org A's application has no effect " +
      "— not an error that would confirm the application exists, no row created",
    async () => {
      const { error } = await orgOwnerB.client.rpc("record_employer_resume_view", {
        p_application_id: applicationIdA,
      });
      expect(error).toBeNull();

      const { data: real } = await admin
        .from("employer_applicant_status")
        .select("first_viewed_at")
        .eq("application_id", applicationIdA)
        .maybeSingle();
      expect(real, "LEAK: an unrelated organisation's call created a status row on org A's applicant").toBeNull();
    },
  );

  it("the owning org's call creates the row, defaults status to 'new', and stamps first_viewed_at", async () => {
    const { error } = await orgOwnerA.client.rpc("record_employer_resume_view", {
      p_application_id: applicationIdA,
    });
    expect(error).toBeNull();

    const { data, error: readErr } = await admin
      .from("employer_applicant_status")
      .select("status, first_viewed_at, updated_by")
      .eq("application_id", applicationIdA)
      .single();
    expect(readErr).toBeNull();
    expect(data?.status, "a row created by a view, not a status action, must still default to 'new'").toBe("new");
    expect(data?.first_viewed_at).toBeTruthy();
    expect(data?.updated_by).toBe(orgOwnerA.id);
  });

  it("first-view-only: a second call from the SAME owning org does not move the timestamp", async () => {
    const { data: before } = await admin
      .from("employer_applicant_status")
      .select("first_viewed_at")
      .eq("application_id", applicationIdA)
      .single();
    expect(before?.first_viewed_at).toBeTruthy();

    const { error } = await orgOwnerA.client.rpc("record_employer_resume_view", {
      p_application_id: applicationIdA,
    });
    expect(error).toBeNull();

    const { data: after } = await admin
      .from("employer_applicant_status")
      .select("first_viewed_at")
      .eq("application_id", applicationIdA)
      .single();
    expect(
      after?.first_viewed_at,
      "REGRESSION: opening the resume a second time moved first_viewed_at",
    ).toBe(before?.first_viewed_at);
  });

  it(
    "an unrelated org (B) calling a SECOND time, after a real row already exists, still cannot move " +
      "org A's timestamp",
    async () => {
      const { data: before } = await admin
        .from("employer_applicant_status")
        .select("first_viewed_at")
        .eq("application_id", applicationIdA)
        .single();

      await orgOwnerB.client.rpc("record_employer_resume_view", { p_application_id: applicationIdA });

      const { data: after } = await admin
        .from("employer_applicant_status")
        .select("first_viewed_at, updated_by")
        .eq("application_id", applicationIdA)
        .single();
      expect(
        after?.first_viewed_at,
        "LEAK: an unrelated organisation's call changed org A's view timestamp",
      ).toBe(before?.first_viewed_at);
      expect(
        after?.updated_by,
        "LEAK: an unrelated organisation's call re-stamped updated_by on org A's applicant",
      ).toBe(orgOwnerA.id);
    },
  );
});

describe("seeker_application_view_status — the seeker side, read-only", () => {
  beforeAll(async () => {
    // A real view, recorded through the real employer path — this describe
    // block is downstream of "record_employer_resume_view" above, so
    // applicationIdA already has a first_viewed_at by the time these run.
    await orgOwnerA.client.rpc("record_employer_resume_view", { p_application_id: applicationIdA });
  });

  it("seekerA sees their own application's real view timestamp", async () => {
    const { data, error } = await seekerA.client.rpc("seeker_application_view_status", {
      p_application_ids: [applicationIdA],
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.application_id).toBe(applicationIdA);
    expect(data?.[0]?.first_viewed_at).toBeTruthy();
  });

  it(
    "the returned rows carry ONLY application_id and first_viewed_at — no status/updated_by leak via " +
      "a wildcard select inside the function",
    async () => {
      const { data } = await seekerA.client.rpc("seeker_application_view_status", {
        p_application_ids: [applicationIdA],
      });
      expect(Object.keys(data?.[0] ?? {}).sort()).toEqual(["application_id", "first_viewed_at"].sort());
    },
  );

  it(
    "SABOTAGE-PROOF TARGET: seekerB asking about seekerA's application (never their own) gets nothing " +
      "back — not seekerA's data",
    async () => {
      const { data, error } = await seekerB.client.rpc("seeker_application_view_status", {
        p_application_ids: [applicationIdA],
      });
      expect(error).toBeNull();
      expect(
        data ?? [],
        "LEAK: a seeker read another seeker's application view status",
      ).toHaveLength(0);
    },
  );

  it("an application that was never viewed (seekerB's) returns nothing, not a null-valued row", async () => {
    const { data, error } = await seekerB.client.rpc("seeker_application_view_status", {
      p_application_ids: [applicationIdB],
    });
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("a mixed array returns only the viewed, owned application — not the other one, either reason", async () => {
    const { data, error } = await seekerA.client.rpc("seeker_application_view_status", {
      p_application_ids: [applicationIdA, applicationIdB],
    });
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.application_id)).toEqual([applicationIdA]);
  });
});

describe("end-to-end: employer opens resume, seeker sees it, a second open doesn't move it", () => {
  it("full round trip through the real RPCs both sides actually call", async () => {
    await admin.from("employer_applicant_status").delete().eq("application_id", applicationIdB);

    const first = await orgOwnerA.client.rpc("record_employer_resume_view", {
      p_application_id: applicationIdB,
    });
    expect(first.error).toBeNull();

    const seekerView = await seekerB.client.rpc("seeker_application_view_status", {
      p_application_ids: [applicationIdB],
    });
    expect(seekerView.error).toBeNull();
    const firstTimestamp = seekerView.data?.[0]?.first_viewed_at;
    expect(firstTimestamp, "seeker should see the real view the employer just recorded").toBeTruthy();

    const second = await orgOwnerA.client.rpc("record_employer_resume_view", {
      p_application_id: applicationIdB,
    });
    expect(second.error).toBeNull();

    const seekerViewAgain = await seekerB.client.rpc("seeker_application_view_status", {
      p_application_ids: [applicationIdB],
    });
    expect(seekerViewAgain.data?.[0]?.first_viewed_at, "a second open must not move the seeker-visible timestamp").toBe(
      firstTimestamp,
    );

    await admin.from("employer_applicant_status").delete().eq("application_id", applicationIdB);
  });
});
