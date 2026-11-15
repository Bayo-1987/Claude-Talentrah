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

 * JOBS-LIFECYCLE-1 W-1 CHANGED WHAT THE NIGHTLY RUN MAY DELETE, so this file now has two kinds of test. The nightly run keeps any closed posting a BLOCKING table references (applications, so a saved job;
 * resumes; tailoring requests; messages; assessments; interviews; ads; reports; the auto-apply queue; the superseded_by link) and deletes the rest, derived data included. The tests that used to
 * drive the FK rules (SET NULL / CASCADE) through the nightly run now drive the deletion directly (`deleteDirectly`), because those rules are what they pin and the nightly run no longer reaches those
 * rows; the new "W-1" describe pins that it keeps them. Everything about an UNREFERENCED closed row (eligibility, idempotency, banners) is untouched and was green before the change.
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
import { chunkInList } from "@/lib/supabase/in-list";

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

/**
 * Deletes a posting the way the database rules see it: a plain service-role DELETE, error checked. Used by the tests that pin the FK rules (0102), which the nightly run no longer reaches for a
 * referenced row (W-1).
 */
async function deleteDirectly(id: string) {
  const { error } = await admin.from("job_postings").delete().eq("id", id);
  expect(error, "a direct delete of the posting").toBeNull();
  createdPostings.splice(createdPostings.indexOf(id), 1);
}

async function readPosting(id: string) {
  const { data } = await admin.from("job_postings").select("id").eq("id", id).maybeSingle();
  return data;
}

/**
 * A long `.in()` list becomes the request URL, and the gateway refuses one past a few KB ("URI too long"): 1,001 ids is about 40 KB. Every `.in()` over a list that can grow goes through these two (the repo's own chunkInList,
 * src/lib/supabase/in-list.ts), 100 ids (about 3.9 KB) per request.
 */
const IN_CHUNK = 100;
const chunks = (items: readonly string[]) => chunkInList(items, IN_CHUNK);
/** Deletes the postings in requests of at most IN_CHUNK ids. Every chunk is tried; one that fails is reported with the rest, not instead of them. */
async function deletePostingsInChunks(ids: readonly string[]) {
  const failures: string[] = [];
  for (const part of chunks(ids)) {
    try {
      await mustDelete("job_postings", admin.from("job_postings").delete().in("id", part));
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (failures.length > 0) throw new Error(`${failures.length} of ${chunks(ids).length} delete request(s) failed: ${failures.join("; ")}`);
}
/** How many of these postings exist, counted in requests of at most IN_CHUNK ids. */
async function countPostings(ids: readonly string[]) {
  let total = 0;
  for (const part of chunks(ids)) {
    const { count, error } = await admin.from("job_postings").select("id", { count: "exact", head: true }).in("id", part);
    expect(error, "counting postings").toBeNull();
    total += count ?? 0;
  }
  return total;
}

afterAll(async () => {
  await runCleanups(
    [
      "postings still standing",
      async () => {
        if (createdPostings.length) await deletePostingsInChunks(createdPostings.splice(0));
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
  it("match_scores (derived data, EXEMPT from the W-1 guard) disappear with the posting when the nightly run deletes it", async () => {
    const userId = await fixtureUser("posting-del-cascade");
    const id = await makeClosedPosting(daysAgo(CLOSED_STALE_AFTER_DAYS + 1));

    const { error: msError } = await admin
      .from("match_scores")
      .insert({ user_id: userId, job_posting_id: id, score: 90, tier: "Excellent" });
    if (msError) throw new Error(`fixture match_score: ${msError.message}`);

    const result = await deleteStaleClosedPostings();
    expect(result.error).toBeUndefined();
    expect(result.ids).toContain(id);
    createdPostings.splice(createdPostings.indexOf(id), 1);

    const { data: scores } = await admin.from("match_scores").select("id").eq("job_posting_id", id);
    expect(scores ?? []).toHaveLength(0);
  });

  it("job_posting_reports cascade when the posting is deleted (the FK rule, driven directly: the nightly run now keeps a reported posting, see W-1 below)", async () => {
    const userId = await fixtureUser("posting-del-report-cascade");
    const id = await makeClosedPosting(daysAgo(CLOSED_STALE_AFTER_DAYS + 1));
    const { error: reportError } = await admin
      .from("job_posting_reports")
      .insert({ job_posting_id: id, reporter_id: userId, reason: "scam" });
    if (reportError) throw new Error(`fixture report: ${reportError.message}`);

    await deleteDirectly(id);

    const { data: reports } = await admin.from("job_posting_reports").select("id").eq("job_posting_id", id);
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

    await deleteDirectly(id);

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

    await deleteDirectly(id);

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

    await deleteDirectly(id);

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

/**
 * JOBS-LIFECYCLE-1 W-1: the nightly run is guarded by job_posting_delete_unreferenced (0279). A closed posting that a BLOCKING table references is kept, with everything that references it;
 * one that nothing blocking references is deleted exactly as before (the 30-day rule is unchanged until W4). Red first: against the unguarded delete every "is kept" case below fails.
 */
describe("W-1: the nightly run keeps a closed posting that anything blocking references", () => {
  const stale = () => daysAgo(CLOSED_STALE_AFTER_DAYS + 1);

  async function employerPosting(userId: string) {
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .insert({ name: `POSTING-DELETION-TEST Org ${randomUUID()}`, created_by: userId, verified: true })
      .select("id")
      .single();
    if (orgError || !org) throw new Error(`fixture org: ${orgError?.message}`);
    createdOrgs.push(org.id);
    const id = await makeClosedPosting(stale(), { source_type: "internal", organization_id: org.id, external_source: null, external_url: null });
    return { id, orgId: org.id };
  }

  async function runAndExpectKept(id: string) {
    const result = await deleteStaleClosedPostings();
    expect(result.error, "the guarded run must succeed").toBeUndefined();
    expect(result.ids, "the run must not have deleted it").not.toContain(id);
    expect(await readPosting(id), "the posting is still there").not.toBeNull();
    expect(result.kept ?? 0).toBeGreaterThanOrEqual(1);
  }

  it("POSITIVE CONTROL: a closed EMPLOYER posting nothing references is still deleted at 30 days (the rule is unchanged until W4)", async () => {
    const userId = await fixtureUser("posting-del-w1-control");
    const { id } = await employerPosting(userId);
    const result = await deleteStaleClosedPostings();
    expect(result.error).toBeUndefined();
    expect(result.ids).toContain(id);
    createdPostings.splice(createdPostings.indexOf(id), 1);
    expect(await readPosting(id)).toBeNull();
  });

  it("an applicant: a closed employer posting with an application is kept, and the application is untouched", async () => {
    const userId = await fixtureUser("posting-del-w1-applicant");
    const { id } = await employerPosting(userId);
    const { data: application, error } = await admin
      .from("applications")
      .insert({ user_id: userId, job_posting_id: id, stage: "applied", source: "internal_apply", applied_at: new Date().toISOString(), manual_job_snapshot: { title: "Kept" } })
      .select("id")
      .single();
    if (error || !application) throw new Error(`fixture application: ${error?.message}`);

    await runAndExpectKept(id);
    const { data: after } = await admin.from("applications").select("job_posting_id, stage").eq("id", application.id).single();
    expect(after).toEqual({ job_posting_id: id, stage: "applied" });
    await mustDelete("applications", admin.from("applications").delete().eq("id", application.id));
  });

  it("a SAVED job (an application at stage saved) keeps the posting too", async () => {
    const userId = await fixtureUser("posting-del-w1-saved");
    const id = await makeClosedPosting(stale());
    const { data: application, error } = await admin
      .from("applications")
      .insert({ user_id: userId, job_posting_id: id, stage: "saved", source: "manual" })
      .select("id")
      .single();
    if (error || !application) throw new Error(`fixture saved application: ${error?.message}`);
    await runAndExpectKept(id);
    await mustDelete("applications", admin.from("applications").delete().eq("id", application.id));
  });

  it("a report keeps the posting, and the report is still there", async () => {
    const userId = await fixtureUser("posting-del-w1-report");
    const { id } = await employerPosting(userId);
    const { error } = await admin.from("job_posting_reports").insert({ job_posting_id: id, reporter_id: userId, reason: "scam" });
    if (error) throw new Error(`fixture report: ${error.message}`);
    await runAndExpectKept(id);
    const { data: reports } = await admin.from("job_posting_reports").select("id").eq("job_posting_id", id);
    expect(reports ?? []).toHaveLength(1);
  });

  it("an ad campaign keeps the posting, and the campaign is still there", async () => {
    const userId = await fixtureUser("posting-del-w1-campaign");
    const { id, orgId } = await employerPosting(userId);
    const { error } = await admin
      .from("ad_campaigns")
      .insert({ job_posting_id: id, organization_id: orgId, created_by: userId, name: "POSTING-DELETION-TEST campaign", daily_rate_ngn: 100, total_budget_ngn: 1000 });
    if (error) throw new Error(`fixture campaign: ${error.message}`);
    await runAndExpectKept(id);
    const { data: campaigns } = await admin.from("ad_campaigns").select("id").eq("job_posting_id", id);
    expect(campaigns ?? []).toHaveLength(1);
  });

  it("a tailored resume and a tailoring request keep the posting", async () => {
    const userId = await fixtureUser("posting-del-w1-tailor");
    const resumePosting = await makeClosedPosting(stale());
    const requestPosting = await makeClosedPosting(stale());
    const resume = await admin.from("resumes").insert({ user_id: userId, title: "Tailored — kept", tailored_for_job_id: resumePosting, structured_content: {} }).select("id").single();
    if (resume.error || !resume.data) throw new Error(`fixture resume: ${resume.error?.message}`);
    const request = await admin.from("job_tailoring_requests").insert({ user_id: userId, source_job_posting_id: requestPosting, source_jd_text: "kept", gap_analysis: { gaps: [] } }).select("id").single();
    if (request.error || !request.data) throw new Error(`fixture tailoring request: ${request.error?.message}`);
    await runAndExpectKept(resumePosting);
    await runAndExpectKept(requestPosting);
    await mustDelete("resumes", admin.from("resumes").delete().eq("id", resume.data.id));
    await mustDelete("job_tailoring_requests", admin.from("job_tailoring_requests").delete().eq("id", request.data.id));
  });

  it("2b: with 1,001 kept rows ahead of it, a deletable row is still reached and deleted (the eligible set is read in pages, not capped at 1,000)", async () => {
    const userId = await fixtureUser("posting-del-w1-paging");
    const keptIds = Array.from({ length: 1001 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const deletableId = "ffffffff-ffff-4fff-8fff-ffffffffffff"; // sorts after every kept id
    const base = { source_type: "external" as const, company_name: "POSTING-DELETION-TEST Co", description: "Fixture.", structured_jd: {}, status: "closed" as const, posted_at: new Date().toISOString(), last_checked_at: new Date().toISOString(), closed_at: stale(), external_source: "posting-deletion-test" };
    for (let i = 0; i < keptIds.length; i += 250) {
      const rows = keptIds.slice(i, i + 250).map((id) => ({ ...base, id, title: `POSTING-DELETION-TEST Kept ${id.slice(-4)}`, dedup_fingerprint: randomUUID(), external_url: `https://example.test/${id}` }));
      const { error } = await admin.from("job_postings").insert(rows);
      if (error) throw new Error(`fixture kept postings: ${error.message}`);
      const apps = rows.map((r) => ({ user_id: userId, job_posting_id: r.id, stage: "saved" as const, source: "manual" as const }));
      const { error: appError } = await admin.from("applications").insert(apps);
      if (appError) throw new Error(`fixture saved applications: ${appError.message}`);
    }
    createdPostings.push(...keptIds);
    const { error: delError } = await admin.from("job_postings").insert({ ...base, id: deletableId, title: "POSTING-DELETION-TEST Deletable", dedup_fingerprint: randomUUID(), external_url: `https://example.test/${deletableId}` });
    if (delError) throw new Error(`fixture deletable posting: ${delError.message}`);
    createdPostings.push(deletableId);

    const result = await deleteStaleClosedPostings();
    expect(result.error).toBeUndefined();
    expect(result.ids, "the deletable row was reached and deleted").toContain(deletableId);
    createdPostings.splice(createdPostings.indexOf(deletableId), 1);
    expect(await readPosting(deletableId)).toBeNull();
    expect(await countPostings(keptIds.slice(0, 200)), "the kept rows are still there").toBe(200);
    await mustDelete("applications", admin.from("applications").delete().eq("user_id", userId));
  }, 120_000);

  it("the run reports what it kept, and a second run is a no-op (idempotent)", async () => {
    const userId = await fixtureUser("posting-del-w1-idempotent");
    const id = await makeClosedPosting(stale());
    const { error } = await admin.from("applications").insert({ user_id: userId, job_posting_id: id, stage: "saved", source: "manual" });
    if (error) throw new Error(`fixture application: ${error.message}`);
    const first = await deleteStaleClosedPostings();
    const second = await deleteStaleClosedPostings();
    expect(first.error).toBeUndefined();
    expect(second.error).toBeUndefined();
    expect(second.ids).toEqual([]);
    expect(await readPosting(id)).not.toBeNull();
    await mustDelete("applications", admin.from("applications").delete().eq("job_posting_id", id));
  });
});
