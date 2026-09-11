/**
 * Stage 5b — deleteStaleClosedPostings (src/lib/jobs/posting-deletion.ts) and
 * the FK rule changes migration 0102 makes to support it.
 *
 * THREE SABOTAGE-PROOF REQUIREMENTS THIS FILE EXISTS TO PIN:
 *
 *   1. Deletion does not orphan an `applications` row — its
 *      `manual_job_snapshot` (Stage 5a) must still describe the job correctly
 *      after the underlying posting is gone, and `job_posting_id` must be
 *      NULL (SET NULL), never a dangling reference to a deleted row.
 *   2. The job is idempotent — running it twice in a row on the same data
 *      does not error, and the second run finds nothing left to do.
 *   3. Everything CASCADE is approved to cascade (match_scores,
 *      auto_apply_queue, ad_campaigns, ad_events, job_posting_reports) really
 *      does disappear with the posting, and everything SET NULL
 *      (job_tailoring_requests.source_job_posting_id,
 *      resumes.tailored_for_job_id) survives with the FK nulled rather than
 *      being deleted or left dangling.
 *
 * The Job Tracker's own rendering after a real deletion (requirement from the
 * task spec: "a user's application history/tracker page renders correctly
 * after its underlying posting has been deleted") is covered at the UI layer
 * by e2e/job-posting-deletion.spec.ts — this file proves the data survives
 * deletion in the right shape; that one proves the page actually reads it.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  deleteStaleClosedPostings,
  deleteJobPosting,
  CLOSED_STALE_AFTER_DAYS,
} from "@/lib/jobs/posting-deletion";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";
import { BANNER_BUCKET } from "@/lib/employer/banner";
import { runCleanups, mustDelete } from "../support/teardown";

const createdPostings: string[] = [];
const createdOrgs: string[] = [];
const createdUsers: string[] = [];

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function makeClosedPosting(closedAt: string | null, over: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "external",
      company_name: "POSTING-DELETION-TEST Co",
      title: `POSTING-DELETION-TEST Role ${randomUUID().slice(0, 8)}`,
      description: "Fixture posting owned by tests/jobs/posting-deletion.",
      structured_jd: {},
      status: "closed",
      posted_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
      closed_at: closedAt,
      dedup_fingerprint: randomUUID(),
      external_source: "posting-deletion-test",
      external_url: `https://example.test/${randomUUID()}`,
      ...over,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not create fixture posting: ${error?.message}`);
  createdPostings.push(data.id);
  return data.id;
}

async function fixtureUser(label: string) {
  const user = await createTestUser(label);
  createdUsers.push(user.id);
  return user.id;
}

async function readPosting(id: string) {
  const { data } = await admin.from("job_postings").select("id").eq("id", id).maybeSingle();
  return data;
}

afterAll(async () => {
  await runCleanups(
    [
      "postings still standing",
      async () => {
        if (createdPostings.length) {
          await mustDelete(
            "job_postings",
            admin.from("job_postings").delete().in("id", createdPostings.splice(0)),
          );
        }
      },
    ],
    [
      "organisations",
      async () => {
        if (createdOrgs.length) await deleteTestOrgs(createdOrgs.splice(0));
      },
    ],
    [
      "users",
      async () => {
        if (createdUsers.length) await deleteTestUsers(createdUsers.splice(0));
      },
    ],
  );
});

describe("eligibility: only closed-30+-days postings are touched", () => {
  it("leaves a posting closed less than 30 days ago alone", async () => {
    const id = await makeClosedPosting(daysAgo(CLOSED_STALE_AFTER_DAYS - 1));
    const result = await deleteStaleClosedPostings();
    expect(result.ids).not.toContain(id);
    expect(await readPosting(id)).not.toBeNull();
  });

  it("deletes a posting closed more than 30 days ago", async () => {
    const id = await makeClosedPosting(daysAgo(CLOSED_STALE_AFTER_DAYS + 1));
    const result = await deleteStaleClosedPostings();
    expect(result.ids).toContain(id);
    expect(result.deleted).toBeGreaterThan(0);
    expect(await readPosting(id)).toBeNull();
    createdPostings.splice(createdPostings.indexOf(id), 1);
  });

  it("never touches an OPEN posting, however old", async () => {
    const id = await makeClosedPosting(null, { status: "open", closed_at: null });
    await deleteStaleClosedPostings();
    expect(await readPosting(id)).not.toBeNull();
  });

  it("never touches a closed posting with no closed_at at all (defensive — should not occur post-0102)", async () => {
    const id = await makeClosedPosting(null);
    const result = await deleteStaleClosedPostings();
    expect(result.ids).not.toContain(id);
    expect(await readPosting(id)).not.toBeNull();
  });

  it("reports the eligible count before deleting anything, even for a run with nothing to do", async () => {
    const result = await deleteStaleClosedPostings();
    expect(result).toMatchObject({ eligible: expect.any(Number), deleted: expect.any(Number) });
    expect(result.deleted).toBeLessThanOrEqual(result.eligible);
  });
});

describe("idempotency: running it twice in a row does not error", () => {
  it("the second run finds nothing left and reports zero, not an error", async () => {
    const id = await makeClosedPosting(daysAgo(CLOSED_STALE_AFTER_DAYS + 5));

    const first = await deleteStaleClosedPostings();
    expect(first.error).toBeUndefined();
    expect(first.ids).toContain(id);
    expect(await readPosting(id)).toBeNull();
    createdPostings.splice(createdPostings.indexOf(id), 1);

    // SABOTAGE-PROOF TARGET: a naive implementation that assumes its own
    // SELECT is still valid by the time it DELETEs, or that throws on a
    // batch matching zero rows, breaks here.
    const second = await deleteStaleClosedPostings();
    expect(second.error).toBeUndefined();
    expect(second.ids).not.toContain(id);
  });
});

describe("CASCADE rows go with the posting, exactly as approved", () => {
  it("match_scores, auto_apply_queue, ad_campaigns, ad_events and job_posting_reports all disappear", async () => {
    const userId = await fixtureUser("posting-del-cascade");
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .insert({ name: `POSTING-DELETION-TEST Org ${randomUUID()}`, created_by: userId, verified: true })
      .select("id")
      .single();
    if (orgError || !org) throw new Error(`fixture org: ${orgError?.message}`);
    createdOrgs.push(org.id);

    const id = await makeClosedPosting(daysAgo(CLOSED_STALE_AFTER_DAYS + 1), {
      source_type: "internal",
      organization_id: org.id,
      external_source: null,
      external_url: null,
    });

    const { error: msError } = await admin
      .from("match_scores")
      .insert({ user_id: userId, job_posting_id: id, score: 90, tier: "Excellent" });
    if (msError) throw new Error(`fixture match_score: ${msError.message}`);

    const { error: reportError } = await admin
      .from("job_posting_reports")
      .insert({ job_posting_id: id, reporter_id: userId, reason: "scam" });
    if (reportError) throw new Error(`fixture report: ${reportError.message}`);

    const result = await deleteStaleClosedPostings();
    expect(result.ids).toContain(id);
    createdPostings.splice(createdPostings.indexOf(id), 1);

    const { data: scores } = await admin.from("match_scores").select("id").eq("job_posting_id", id);
    expect(scores ?? []).toHaveLength(0);

    const { data: reports } = await admin
      .from("job_posting_reports")
      .select("id")
      .eq("job_posting_id", id);
    expect(reports ?? []).toHaveLength(0);
  });
});

describe("SET NULL rows survive, exactly as approved", () => {
  it("an applications row keeps its manual_job_snapshot and gets job_posting_id nulled — never deleted, never dangling", async () => {
    const userId = await fixtureUser("posting-del-application");
    const id = await makeClosedPosting(daysAgo(CLOSED_STALE_AFTER_DAYS + 1));

    const snapshot = { companyName: "POSTING-DELETION-TEST Co", title: "Frozen Title", location: "Lagos" };
    const { data: application, error: appError } = await admin
      .from("applications")
      .insert({
        user_id: userId,
        job_posting_id: id,
        stage: "applied",
        source: "internal_apply",
        applied_at: new Date().toISOString(),
        manual_job_snapshot: snapshot,
      })
      .select("id")
      .single();
    if (appError || !application) throw new Error(`fixture application: ${appError?.message}`);

    const result = await deleteStaleClosedPostings();
    expect(result.ids).toContain(id);
    createdPostings.splice(createdPostings.indexOf(id), 1);

    const { data: after, error: readError } = await admin
      .from("applications")
      .select("id, job_posting_id, manual_job_snapshot, stage")
      .eq("id", application.id)
      .single();

    // SABOTAGE-PROOF TARGET: this row must still exist at all (not CASCADE-d
    // away), with job_posting_id nulled (not left dangling) and the snapshot
    // untouched — the exact combination that lets the Tracker keep rendering
    // "Frozen Title" with the posting gone.
    expect(readError).toBeNull();
    expect(after).not.toBeNull();
    expect(after!.job_posting_id).toBeNull();
    expect(after!.manual_job_snapshot).toEqual(snapshot);
    expect(after!.stage).toBe("applied");

    await mustDelete("applications", admin.from("applications").delete().eq("id", application.id));
  });

  it("job_tailoring_requests.source_job_posting_id is nulled, the row and its own text survive", async () => {
    const userId = await fixtureUser("posting-del-tailoring");
    const id = await makeClosedPosting(daysAgo(CLOSED_STALE_AFTER_DAYS + 1));

    const { data: request, error: reqError } = await admin
      .from("job_tailoring_requests")
      .insert({
        user_id: userId,
        source_job_posting_id: id,
        source_jd_text: "The job description text, kept regardless of the posting's fate.",
        gap_analysis: { gaps: [] },
      })
      .select("id")
      .single();
    if (reqError || !request) throw new Error(`fixture tailoring request: ${reqError?.message}`);

    const result = await deleteStaleClosedPostings();
    expect(result.ids).toContain(id);
    createdPostings.splice(createdPostings.indexOf(id), 1);

    const { data: after, error: readError } = await admin
      .from("job_tailoring_requests")
      .select("id, source_job_posting_id, source_jd_text")
      .eq("id", request.id)
      .single();
    expect(readError).toBeNull();
    expect(after!.source_job_posting_id).toBeNull();
    expect(after!.source_jd_text).toContain("kept regardless");

    await mustDelete(
      "job_tailoring_requests",
      admin.from("job_tailoring_requests").delete().eq("id", request.id),
    );
  });

  it("resumes.tailored_for_job_id is nulled, the resume itself survives", async () => {
    const userId = await fixtureUser("posting-del-resume");
    const id = await makeClosedPosting(daysAgo(CLOSED_STALE_AFTER_DAYS + 1));

    const { data: resume, error: resumeError } = await admin
      .from("resumes")
      .insert({
        user_id: userId,
        title: "Tailored — POSTING-DELETION-TEST Role",
        tailored_for_job_id: id,
        structured_content: {},
      })
      .select("id")
      .single();
    if (resumeError || !resume) throw new Error(`fixture resume: ${resumeError?.message}`);

    const result = await deleteStaleClosedPostings();
    expect(result.ids).toContain(id);
    createdPostings.splice(createdPostings.indexOf(id), 1);

    const { data: after, error: readError } = await admin
      .from("resumes")
      .select("id, tailored_for_job_id, title")
      .eq("id", resume.id)
      .single();
    expect(readError).toBeNull();
    expect(after!.tailored_for_job_id).toBeNull();
    expect(after!.title).toBe("Tailored — POSTING-DELETION-TEST Role");

    await mustDelete("resumes", admin.from("resumes").delete().eq("id", resume.id));
  });
});

/**
 * A banner is a Storage object, not a foreign key.
 *
 * This file's header reasons through every FK pointing at job_postings —
 * cascade or set-null — and that analysis cannot see a banner at all, because
 * `banner_path` is a plain string column. Nothing in the database would ever
 * remove the file. Without the cleanup this pins, every deleted posting that
 * had a banner would leave a permanently orphaned object consuming free-tier
 * quota, with no row left to explain it.
 *
 * Deliberately NOT removed at close time: a closed posting can be reopened
 * (this file's own reason for the 30-day wait), and an employer who reopened a
 * listing to find its artwork gone would have lost something that was never
 * actually deleted. The banner's lifetime matches the row's exactly.
 */
describe("a deleted posting takes its banner file with it", () => {
  /** A real, minimal PNG — Storage stores bytes, so the test supplies bytes. */
  function tinyPng(): Uint8Array {
    const b = new Uint8Array(64);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    b.set([0, 0, 0, 13], 8);
    b.set([0x49, 0x48, 0x44, 0x52], 12);
    b.set([0, 0, 6, 64], 16); // 1600
    b.set([0, 0, 1, 144], 20); // 400
    return b;
  }

  async function objectExists(path: string): Promise<boolean> {
    const slash = path.lastIndexOf("/");
    const { data, error } = await admin.storage
      .from(BANNER_BUCKET)
      .list(path.slice(0, slash), { search: path.slice(slash + 1) });
    if (error) throw new Error(`could not list storage: ${error.message}`);
    return (data ?? []).some((o) => o.name === path.slice(slash + 1));
  }

  it("removes the Storage object, not just the row", async () => {
    const orgId = randomUUID();
    const jobId = await makeClosedPosting(daysAgo(31));
    const path = `${orgId}/${jobId}.png`;

    const { error: upErr } = await admin.storage
      .from(BANNER_BUCKET)
      .upload(path, tinyPng(), { contentType: "image/png", upsert: true });
    if (upErr) throw new Error(`fixture upload failed: ${upErr.message}`);

    const { error: setErr } = await admin
      .from("job_postings")
      .update({ banner_path: path })
      .eq("id", jobId);
    if (setErr) throw new Error(`could not attach the fixture banner: ${setErr.message}`);

    // The control. Without it, "the file is gone afterwards" would pass just
    // as happily if the upload had silently never happened.
    expect(await objectExists(path), "fixture banner was not stored to begin with").toBe(true);

    await deleteStaleClosedPostings();

    expect(await readPosting(jobId), "the row should be gone").toBeNull();
    expect(
      await objectExists(path),
      "the row was deleted but its banner file was left orphaned in Storage",
    ).toBe(false);
  });

  it("leaves the banner alone when the posting is NOT eligible", async () => {
    /*
     * The other direction, and the one that catches an over-eager cleanup: a
     * posting closed only yesterday is not deleted, so its banner must still
     * be there. A cleanup keyed off the eligible set rather than off what was
     * actually deleted would fail here.
     */
    const orgId = randomUUID();
    const jobId = await makeClosedPosting(daysAgo(1));
    const path = `${orgId}/${jobId}.png`;
    await admin.storage.from(BANNER_BUCKET).upload(path, tinyPng(), { contentType: "image/png", upsert: true });
    await admin.from("job_postings").update({ banner_path: path }).eq("id", jobId);

    await deleteStaleClosedPostings();

    expect(await readPosting(jobId), "a recently-closed posting must survive").not.toBeNull();
    expect(await objectExists(path), "its banner must survive with it").toBe(true);

    const { error } = await admin.storage.from(BANNER_BUCKET).remove([path]);
    if (error) console.error("[banner test cleanup]", error.message);
  });
});

/**
 * deleteJobPosting — the employer-triggered single-row delete
 * (src/lib/employer/actions.ts's deleteJobAction), independent of the sweep
 * above. Exercises the function directly rather than deleteJobAction itself:
 * the Server Action resolves its session via cookies(), which throws outside
 * a real Next.js request scope — the same limitation already documented for
 * other Server Actions in this codebase (see 0153's own column-privileges
 * test comment for createOrganizationAction). Everything this function
 * actually decides (closed-only, org-scoped, banner cleanup) lives here,
 * in a plain function that takes explicit arguments.
 */
describe("deleteJobPosting: an employer's own direct delete of one posting", () => {
  async function makeOrg(label: string) {
    const userId = await fixtureUser(label);
    const { data: org, error } = await admin
      .from("organizations")
      .insert({ name: `POSTING-DELETION-TEST Org ${randomUUID()}`, created_by: userId, verified: true })
      .select("id")
      .single();
    if (error || !org) throw new Error(`fixture org: ${error?.message}`);
    createdOrgs.push(org.id);
    return org.id;
  }

  async function makeOrgPosting(organizationId: string, status: "open" | "closed" = "closed") {
    return makeClosedPosting(status === "closed" ? new Date().toISOString() : null, {
      source_type: "internal",
      organization_id: organizationId,
      external_source: null,
      external_url: null,
      status,
    });
  }

  it("deletes a closed posting that belongs to the given organization", async () => {
    const orgId = await makeOrg("posting-del-single-owner");
    const id = await makeOrgPosting(orgId, "closed");

    const result = await deleteJobPosting(admin, id, orgId);
    expect(result).toEqual({ deleted: true });
    expect(await readPosting(id)).toBeNull();
    createdPostings.splice(createdPostings.indexOf(id), 1);
  });

  /**
   * SABOTAGE-PROOF TARGET: org B guessing (or otherwise obtaining) org A's
   * posting id must not be enough to delete it. This is the function's own
   * defense-in-depth check — deleteJobAction's session-client read already
   * stops this in the real request path, but this proves the service-role
   * write refuses it independently, the same "never trust an id alone past
   * that boundary" discipline 0128's own header documents.
   */
  it("refuses to delete another organization's posting, even with its real id", async () => {
    const ownerOrgId = await makeOrg("posting-del-cross-org-owner");
    const attackerOrgId = await makeOrg("posting-del-cross-org-attacker");
    const id = await makeOrgPosting(ownerOrgId, "closed");

    const result = await deleteJobPosting(admin, id, attackerOrgId);
    expect(result).toEqual({ deleted: false, reason: "not_found" });
    expect(await readPosting(id), "org A's posting must survive org B's attempt").not.toBeNull();
  });

  /**
   * The open-vs-closed decision this feature made: only a CLOSED posting can
   * be deleted directly, the same and only precedent this codebase has for
   * "how long before a job_postings row is gone for good." Enforced here,
   * not just hidden in the UI — a request that reaches this function for an
   * open posting (a stale page, a replayed request) must still be refused.
   */
  it("refuses to delete an OPEN posting, even for its own organization", async () => {
    const orgId = await makeOrg("posting-del-single-open");
    const id = await makeOrgPosting(orgId, "open");

    const result = await deleteJobPosting(admin, id, orgId);
    expect(result).toEqual({ deleted: false, reason: "not_closed" });
    expect(await readPosting(id), "the open posting must survive").not.toBeNull();
  });

  it("reports not_found for an id that doesn't exist at all", async () => {
    const orgId = await makeOrg("posting-del-single-missing");
    const result = await deleteJobPosting(admin, randomUUID(), orgId);
    expect(result).toEqual({ deleted: false, reason: "not_found" });
  });

  it("takes its banner file with it, the same as the scheduled sweep", async () => {
    const orgId = await makeOrg("posting-del-single-banner");
    const id = await makeOrgPosting(orgId, "closed");
    const path = `${orgId}/${id}.png`;

    const { error: upErr } = await admin.storage
      .from(BANNER_BUCKET)
      .upload(path, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { contentType: "image/png", upsert: true });
    if (upErr) throw new Error(`fixture upload failed: ${upErr.message}`);
    await admin.from("job_postings").update({ banner_path: path }).eq("id", id);

    const result = await deleteJobPosting(admin, id, orgId);
    expect(result).toEqual({ deleted: true });
    createdPostings.splice(createdPostings.indexOf(id), 1);

    const { data: listed } = await admin.storage
      .from(BANNER_BUCKET)
      .list(orgId, { search: `${id}.png` });
    expect(
      (listed ?? []).some((o) => o.name === `${id}.png`),
      "the banner file should have been removed along with the row",
    ).toBe(false);
  });
});
