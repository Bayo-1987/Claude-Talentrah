/**
 * send-328 — Talent Directory verification surfaced on the employer
 * applicant list via `employer_job_applicants` (0170's widen).
 *
 * ── THE CONSENT CLAIM THIS FILE EXISTS TO PIN ─────────────────────────────
 *
 * `talent_verification_status` and `talent_directory_opt_in` are separate,
 * independent columns (0135). The decision (0170's own header): the badge
 * does NOT gate on opt-in — a verified credential is closer to a resume
 * fact than to directory discoverability, and applying to a specific job is
 * already a stronger consent signal than directory-wide discoverability.
 * "genuinely independent of opt-in" is a real, falsifiable claim, so this
 * builds a `verified` applicant with `talent_directory_opt_in = false`
 * specifically to prove the badge's data survives that combination, not
 * just a `verified` applicant with opt-in left at whatever the column
 * default happens to be.
 *
 * All four assertions read the RPC directly (through the org owner's own
 * authenticated client, the same path the applicants page itself uses) —
 * the actual boundary this feature depends on, not a re-implementation of
 * the page's one-line `=== "verified"` display check.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";

type AuthedTestUser = Awaited<ReturnType<typeof createAuthedTestUser>>;

let orgOwner: AuthedTestUser;
let orgId: string;
let jobId: string;
const applicationIds: Record<string, string> = {};
const seekerIds: string[] = [];
const resumeIds: string[] = [];

interface Seed {
  key: "verified" | "pendingCheck" | "rejected" | "neverTouched";
  status: string | null; // null = leave at the column default
  score: number | null;
  optIn: boolean;
}

const SEEDS: Seed[] = [
  { key: "verified", status: "verified", score: 87, optIn: false },
  { key: "pendingCheck", status: "pending", score: null, optIn: true },
  { key: "rejected", status: "rejected", score: null, optIn: true },
  // Never touched Talent Directory at all — left exactly at whatever
  // createAuthedTestUser's profile defaults to (0135: not null default
  // 'unverified'), no explicit update. This is the "no row"-shaped case:
  // there IS a profiles row (there always is), just never one that ran
  // through verification.
  { key: "neverTouched", status: null, score: null, optIn: false },
];

beforeAll(async () => {
  orgOwner = await createAuthedTestUser("applicant-verif-owner");

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({
      name: `Applicant-Verif-Test Org ${randomUUID().slice(0, 8)}`,
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

  const { data: job, error: jobErr } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: orgId,
      company_name: "Applicant-Verif-Test Co",
      title: `Applicant-Verif-Test Role ${randomUUID().slice(0, 8)}`,
      description: "Fixture posting for the applicant-verification-badge suite.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
    })
    .select("id")
    .single();
  if (jobErr || !job) throw new Error(`fixture job: ${jobErr?.message}`);
  jobId = job.id;

  for (const seed of SEEDS) {
    const seeker = await createAuthedTestUser(`applicant-verif-${seed.key}`);
    seekerIds.push(seeker.id);

    if (seed.status !== null) {
      const { error: profErr } = await admin
        .from("profiles")
        .update({
          talent_verification_status: seed.status,
          talent_verification_score: seed.score,
          talent_directory_opt_in: seed.optIn,
        })
        .eq("id", seeker.id);
      if (profErr) throw new Error(`fixture profile (${seed.key}): ${profErr.message}`);
    }

    const { data: resume, error: resumeErr } = await admin
      .from("resumes")
      .insert({
        user_id: seeker.id,
        structured_content: {
          contact: { name: `Verif Test ${seed.key}` },
          summary: "Fixture resume.",
          experience: [],
          education: [],
          skills: [],
        },
      })
      .select("id")
      .single();
    if (resumeErr || !resume) throw new Error(`fixture resume (${seed.key}): ${resumeErr?.message}`);
    resumeIds.push(resume.id);

    const { data: application, error: applicationErr } = await admin
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
    if (applicationErr || !application) {
      throw new Error(`fixture application (${seed.key}): ${applicationErr?.message}`);
    }
    applicationIds[seed.key] = application.id;
  }
}, 60_000);

afterAll(async () => {
  for (const id of Object.values(applicationIds)) await admin.from("applications").delete().eq("id", id);
  for (const id of resumeIds) await admin.from("resumes").delete().eq("id", id);
  await deleteOrgsCascade(admin, [orgId].filter(Boolean));
  await deleteTestUsers([orgOwner.id, ...seekerIds].filter(Boolean));
});

describe("employer_job_applicants surfaces Talent Directory verification, independent of opt-in", () => {
  it("returns 'verified' with the real score for a verified applicant who is NOT opted into the directory", async () => {
    const { data, error } = await orgOwner.client.rpc("employer_job_applicants", {
      p_job_posting_id: jobId,
    });
    expect(error).toBeNull();

    const row = (data ?? []).find((r) => r.application_id === applicationIds.verified);
    expect(row).toBeDefined();
    expect(row!.talent_verification_status).toBe("verified");
    expect(row!.talent_verification_score).toBe(87);
  });

  it("never reports 'verified' for a pending or rejected applicant, regardless of opt-in", async () => {
    const { data, error } = await orgOwner.client.rpc("employer_job_applicants", {
      p_job_posting_id: jobId,
    });
    expect(error).toBeNull();

    const pending = (data ?? []).find((r) => r.application_id === applicationIds.pendingCheck);
    const rejected = (data ?? []).find((r) => r.application_id === applicationIds.rejected);
    expect(pending!.talent_verification_status).toBe("pending");
    expect(rejected!.talent_verification_status).toBe("rejected");
    // Both are opted IN (optIn: true above) — proving the badge's absence
    // here is about verification status, not opt-in leaking through as a
    // second, undocumented gate.
    for (const row of [pending, rejected]) {
      expect(row!.talent_verification_status).not.toBe("verified");
    }
  });

  it("an applicant who never touched Talent Directory renders with no badge and no error", async () => {
    const { data, error } = await orgOwner.client.rpc("employer_job_applicants", {
      p_job_posting_id: jobId,
    });
    expect(error).toBeNull();

    const row = (data ?? []).find((r) => r.application_id === applicationIds.neverTouched);
    expect(row).toBeDefined();
    // 0135's column default — never explicitly set for this seeker.
    expect(row!.talent_verification_status).toBe("unverified");
    expect(row!.talent_verification_score).toBeNull();
  });

  it("all 4 applicants still resolve together — the widen didn't drop or duplicate a row", async () => {
    const { data, error } = await orgOwner.client.rpc("employer_job_applicants", {
      p_job_posting_id: jobId,
    });
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(4);
  });
});
