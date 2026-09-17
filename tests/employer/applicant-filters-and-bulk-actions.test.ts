/**
 * send-326 — tier filter, unscored toggle, and bulk status actions on the
 * applicants list. All page-level: no new query, no RPC change (confirmed
 * separately by `git diff --stat` in the PR description).
 *
 * Two shapes of test here:
 *   - Pure logic (`applicant-filters.ts`) — no DB needed, exercised directly
 *     against the exact functions the page calls, not a reimplementation.
 *   - Bulk-action isolation — a real fixture, because the property that
 *     matters ("touches exactly the selected rows, not the rest of the
 *     job's applicants") is a live-database claim about
 *     `employer_applicant_status`, not something a pure function can prove.
 *     Writes go through each org owner's own authenticated client
 *     (`orgOwner.client`), the same RLS-scoped path `setApplicantStatusAction`
 *     itself uses — a bulk action is just that action called N times via
 *     `Promise.all`, so this proves the mechanism the client component
 *     actually relies on, not a separate one.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type TestUser } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";
import {
  applicantMatchesFilter,
  effectiveTierFor,
  parseApplicantFilterParams,
} from "@/lib/employer/applicant-filters";
import type { MatchExplanation } from "@/lib/matching/score";

describe("parseApplicantFilterParams", () => {
  it("parses a multi-tier value", () => {
    expect(parseApplicantFilterParams({ tier: "excellent,fair" })).toEqual({
      tiers: ["excellent", "fair"],
      hideUnscored: false,
    });
  });

  it("drops garbage tier values rather than treating them as a match-nothing filter", () => {
    expect(parseApplicantFilterParams({ tier: "excellent,bogus,,fair" }).tiers).toEqual([
      "excellent",
      "fair",
    ]);
  });

  it("treats anything other than unscored=hide as 'shown' — the honest default", () => {
    expect(parseApplicantFilterParams({}).hideUnscored).toBe(false);
    expect(parseApplicantFilterParams({ unscored: "show" }).hideUnscored).toBe(false);
    expect(parseApplicantFilterParams({ unscored: "hide" }).hideUnscored).toBe(true);
  });
});

describe("effectiveTierFor — must agree with what MatchTierBadge actually renders", () => {
  it("returns null for an unscored applicant", () => {
    expect(effectiveTierFor(null, null)).toBeNull();
  });

  it("downgrades a thin-denominator 'excellent' score the same way the badge does", () => {
    // 1 screenable tag total — THIN_SCREENABLE_TAG_MAX is 2, so a raw
    // Excellent-range score here must NOT report as "excellent": the tier
    // chip has to agree with the badge, or "Excellent" would mean two
    // different things on the same page.
    const explanation: MatchExplanation = {
      matchedSkills: ["sql"],
      missingSkills: [],
      seniorityAlignment: "match",
    };
    expect(effectiveTierFor(90, explanation)).not.toBe("excellent");
  });

  it("reports a genuinely broad excellent match as excellent", () => {
    const explanation: MatchExplanation = {
      matchedSkills: ["sql", "python", "react", "leadership"],
      missingSkills: ["kubernetes"],
      seniorityAlignment: "match",
    };
    expect(effectiveTierFor(90, explanation)).toBe("excellent");
  });
});

describe("applicantMatchesFilter — tier and unscored are independent axes", () => {
  it("with no tier filter active, every scored applicant passes regardless of tier", () => {
    expect(applicantMatchesFilter(65, "fair", { tiers: [], hideUnscored: false })).toBe(true);
    expect(applicantMatchesFilter(95, "excellent", { tiers: [], hideUnscored: false })).toBe(true);
  });

  it("a selected tier excludes a scored applicant in a different tier", () => {
    expect(applicantMatchesFilter(65, "fair", { tiers: ["excellent"], hideUnscored: false })).toBe(
      false,
    );
  });

  it("clearing the tier filter brings back an applicant it had excluded", () => {
    const excluded = applicantMatchesFilter(65, "fair", { tiers: ["excellent"], hideUnscored: false });
    const cleared = applicantMatchesFilter(65, "fair", { tiers: [], hideUnscored: false });
    expect(excluded).toBe(false);
    expect(cleared).toBe(true);
  });

  it("an active tier filter never hides an unscored applicant — unscored is a separate axis", () => {
    expect(applicantMatchesFilter(null, null, { tiers: ["excellent"], hideUnscored: false })).toBe(true);
  });

  it("hideUnscored hides only unscored applicants, never a scored one outside the tier filter", () => {
    expect(applicantMatchesFilter(null, null, { tiers: [], hideUnscored: true })).toBe(false);
    expect(applicantMatchesFilter(65, "fair", { tiers: [], hideUnscored: true })).toBe(true);
  });
});

/* -------------------------------------------------------------------------- *
 * Bulk action isolation — real fixture, real RLS-scoped writes
 * -------------------------------------------------------------------------- */

type AuthedTestUser = Awaited<ReturnType<typeof createAuthedTestUser>>;

let orgOwner: AuthedTestUser;
let seekers: TestUser[] = [];
let orgId: string;
let jobId: string;
const applicationIds: string[] = [];
const resumeIds: string[] = [];

beforeAll(async () => {
  orgOwner = await createAuthedTestUser("applicant-bulk-owner");
  seekers = await Promise.all([
    createAuthedTestUser("applicant-bulk-seeker-a"),
    createAuthedTestUser("applicant-bulk-seeker-b"),
    createAuthedTestUser("applicant-bulk-seeker-c"),
    createAuthedTestUser("applicant-bulk-seeker-d"),
  ]);

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({
      name: `Applicant-Bulk-Test Org ${randomUUID().slice(0, 8)}`,
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
      company_name: "Applicant-Bulk-Test Co",
      title: `Applicant-Bulk-Test Role ${randomUUID().slice(0, 8)}`,
      description: "Fixture posting for the applicant-filters-and-bulk-actions suite.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
    })
    .select("id")
    .single();
  if (jobErr || !job) throw new Error(`fixture job: ${jobErr?.message}`);
  jobId = job.id;

  for (const seeker of seekers) {
    const { data: resume, error: resumeErr } = await admin
      .from("resumes")
      .insert({
        user_id: seeker.id,
        structured_content: {
          contact: { name: "Bulk Test Seeker" },
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
        user_id: seeker.id,
        job_posting_id: jobId,
        resume_id: resume.id,
        stage: "applied",
        source: "internal_apply",
        applied_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (applicationErr || !application) throw new Error(`fixture application: ${applicationErr?.message}`);
    applicationIds.push(application.id);
  }
}, 60_000);

afterAll(async () => {
  for (const id of applicationIds) await admin.from("applications").delete().eq("id", id);
  for (const id of resumeIds) await admin.from("resumes").delete().eq("id", id);
  await deleteOrgsCascade(admin, [orgId].filter(Boolean));
  await deleteTestUsers([orgOwner.id, ...seekers.map((s) => s.id)].filter(Boolean));
});

describe("a bulk action touches exactly the selected applications", () => {
  it("updates only the 2 selected of 4, leaving the other 2 at their default status", async () => {
    const [selectedA, , selectedC] = applicationIds; // indices 0 and 2 — not contiguous, on purpose

    const results = await Promise.all(
      [selectedA, selectedC].map((id) =>
        orgOwner.client
          .from("employer_applicant_status")
          .upsert({ application_id: id, status: "shortlisted" }, { onConflict: "application_id" }),
      ),
    );
    for (const r of results) expect(r.error).toBeNull();

    const { data: rows, error } = await orgOwner.client.rpc("employer_job_applicants", {
      p_job_posting_id: jobId,
    });
    expect(error).toBeNull();

    const byId = new Map((rows ?? []).map((r) => [r.application_id, r.status]));
    expect(byId.get(applicationIds[0])).toBe("shortlisted");
    expect(byId.get(applicationIds[2])).toBe("shortlisted");
    // The two NOT selected must still read the RPC's own default — proof
    // this is not a whole-job update wearing a "bulk" label.
    expect(byId.get(applicationIds[1])).toBe("new");
    expect(byId.get(applicationIds[3])).toBe("new");
  });
});
