import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deletePostingsCascade, deleteOrgsCascade } from "../tests/support/delete-orgs";

/**
 * Stage 5b, the page-rendering half of the sabotage-proof requirement
 * "a user's application history/tracker page renders correctly after its
 * underlying posting has been deleted".
 *
 * tests/jobs/posting-deletion.test.ts already proves the DATA survives
 * correctly at the database layer (manual_job_snapshot intact,
 * job_posting_id nulled, nothing dangling). This drives the real deletion
 * job over its real HTTP trigger — the same route Vercel Cron calls — and
 * then loads /tracker as the actual user, because a row shaped correctly in
 * Postgres is not the same claim as a page that reads it correctly: the
 * Tracker's query joins `job_postings(...)`, and a join against a row that
 * no longer exists is exactly the kind of thing that looks fine in isolation
 * and breaks in the page that composes it.
 *
 * JOBS-LIFECYCLE-1 W-1 changed the premise. The nightly run no longer deletes a closed posting that anything blocking references (a tracker row included): it KEEPS it. So this file now says three
 * things: (A) the nightly run keeps a closed posting a tracker row references, and the card still renders; (B) once a posting is gone (removed here directly, the way the database rules see it), the
 * tracker card renders from manual_job_snapshot; (C) a closed posting nothing references is still deleted by the nightly run.
 *
 * A skip must not read as a pass in CI — same rule report-job-posting.spec.ts
 * documents for the same secret. Locally `.env.local` leaves INGEST_SECRET
 * empty (admin routes fail closed by design), so skipping there is honest;
 * in CI `ci.yml`'s `e2e` job generates one, so a silent skip there would be
 * indistinguishable from a real pass on the summary line.
 */
const ADMIN_SECRET = process.env.INGEST_SECRET || process.env.ADMIN_API_SECRET;

if (process.env.CI && !ADMIN_SECRET) {
  throw new Error(
    "job-posting-deletion spec cannot run in CI: no INGEST_SECRET/ADMIN_API_SECRET configured",
  );
}

test.describe("the tracker page after its posting is permanently deleted (Stage 5b)", () => {
  test.skip(!ADMIN_SECRET, "needs INGEST_SECRET or ADMIN_API_SECRET to call the deletion route");

  const createdOrgIds: string[] = [];
  const createdJobIds: string[] = [];
  const createdApplicationIds: string[] = [];

  test.afterEach(async () => {
    await runCleanups(
      [
        "applications",
        async () => {
          if (createdApplicationIds.length) {
            await admin.from("applications").delete().in("id", createdApplicationIds.splice(0));
          }
        },
      ],
      [
        "job postings",
        async () => {
          // Deliberately tolerant of already-gone: tests B and C remove their
          // posting themselves, so this is the cleanup for A (whose posting
          // is KEPT by the nightly run) and the backstop for a run that fails
          // before reaching its own removal.
          if (createdJobIds.length) await deletePostingsCascade(admin, createdJobIds.splice(0));
        },
      ],
      [
        "organisations",
        async () => {
          if (createdOrgIds.length) await deleteOrgsCascade(admin, createdOrgIds.splice(0));
        },
      ],
    );
  });

  const FROZEN_LOCATION = "Lagos, Nigeria";

  /** A verified organisation and a closed internal posting, closed well past the 30-day threshold so the nightly run finds it eligible without waiting on the wall clock. */
  async function closedStalePosting(testUserId: string) {
    const orgName = `E2E DELETION-TEST Co ${randomUUID().slice(0, 8)}`;
    const title = `E2E DELETION-TEST Role ${randomUUID().slice(0, 6)}`;
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .insert({ name: orgName, created_by: testUserId, verified: true })
      .select("id")
      .single();
    if (orgError || !org) throw new Error(`fixture org: ${orgError?.message}`);
    createdOrgIds.push(org.id);

    const closedAt = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    const { data: job, error: jobError } = await admin
      .from("job_postings")
      .insert({
        source_type: "internal",
        organization_id: org.id,
        company_name: orgName,
        title,
        description: "Fixture posting for e2e/job-posting-deletion — old enough for the nightly run to consider.",
        structured_jd: {},
        status: "closed",
        closed_at: closedAt,
        location: FROZEN_LOCATION,
        posted_at: closedAt,
        dedup_fingerprint: `e2e-deletion-${randomUUID()}`,
      })
      .select("id")
      .single();
    if (jobError || !job) throw new Error(`fixture posting: ${jobError?.message}`);
    createdJobIds.push(job.id);
    return { orgName, title, jobId: job.id };
  }

  /** A real prior application, snapshotted the way the actual apply flow does it (src/lib/applications/job-snapshot.ts's exact shape), because the assertions are about THIS shape. */
  async function trackerRow(testUserId: string, jobId: string, orgName: string, title: string) {
    const { data: application, error: appError } = await admin
      .from("applications")
      .insert({
        user_id: testUserId,
        job_posting_id: jobId,
        stage: "applied",
        source: "internal_apply",
        applied_at: new Date().toISOString(),
        manual_job_snapshot: { companyName: orgName, title, location: FROZEN_LOCATION },
      })
      .select("id")
      .single();
    if (appError || !application) throw new Error(`fixture application: ${appError?.message}`);
    createdApplicationIds.push(application.id);
    return application.id;
  }

  /** The real trigger, not a direct library call: Vercel Cron reaches this exact route, and a manual/admin run uses the same POST path with the header this repo's other admin routes standardise on. */
  async function runNightly(request: import("@playwright/test").APIRequestContext) {
    const response = await request.post("/api/admin/delete-stale-postings", { headers: { "x-admin-secret": ADMIN_SECRET! } });
    expect(response.ok(), "the deletion route itself failed").toBe(true);
    const body = await response.json();
    expect(body.result?.error, `the run reported an error: ${JSON.stringify(body.result)}`).toBeUndefined();
    return body.result as { eligible: number; deleted: number; ids: string[]; kept: number };
  }

  test("A) the nightly run KEEPS a closed posting a tracker row references, and the tracker card still renders", async ({
    authedPage,
    testUser,
    request,
  }) => {
    const { orgName, title, jobId } = await closedStalePosting(testUser.id);
    const applicationId = await trackerRow(testUser.id, jobId, orgName, title);

    const result = await runNightly(request);
    expect(result, `the run must see the posting, keep it and delete nothing: ${JSON.stringify(result)}`).toMatchObject({ eligible: 1, deleted: 0, kept: 1 });
    expect(result.ids).not.toContain(jobId);

    // Confirmed from the database, not assumed from the route's own report: the posting is still there and the tracker row still points at it.
    const { data: postingAfter } = await admin.from("job_postings").select("id").eq("id", jobId).maybeSingle();
    expect(postingAfter, "the referenced posting must still exist").not.toBeNull();
    const { data: appAfter } = await admin.from("applications").select("job_posting_id").eq("id", applicationId).single();
    expect(appAfter?.job_posting_id).toBe(jobId);

    await authedPage.goto("/tracker");
    await expect(authedPage.getByText(title, { exact: false })).toBeVisible();
    await expect(authedPage.getByText(orgName, { exact: false })).toBeVisible();
  });

  test("B) shows the frozen company/title from manual_job_snapshot, not a blank or broken card, once the posting is gone", async ({
    authedPage,
    testUser,
  }) => {
    const { orgName, title, jobId } = await closedStalePosting(testUser.id);
    const applicationId = await trackerRow(testUser.id, jobId, orgName, title);

    // The nightly run no longer reaches a referenced posting, so this state is made the way the database rules see it: a plain service-role DELETE, error checked (a rejected delete resolves, it does not throw).
    const { error: deleteError } = await admin.from("job_postings").delete().eq("id", jobId);
    expect(deleteError, "removing the posting directly").toBeNull();
    createdJobIds.splice(createdJobIds.indexOf(jobId), 1);
    const { data: postingAfter } = await admin.from("job_postings").select("id").eq("id", jobId).maybeSingle();
    expect(postingAfter, "the posting should actually be gone").toBeNull();

    // The actual page, as the actual user: the Tracker's query joins job_postings(...), and a join against a row that no longer exists is what this proves still renders.
    await authedPage.goto("/tracker");
    await expect(authedPage.getByText(title, { exact: false })).toBeVisible();
    await expect(authedPage.getByText(orgName, { exact: false })).toBeVisible();

    // Also true at the database layer, since a passing UI assertion reading a STALE cached response would be a false positive.
    const { data: appAfter } = await admin
      .from("applications")
      .select("job_posting_id, manual_job_snapshot")
      .eq("id", applicationId)
      .single();
    expect(appAfter?.job_posting_id).toBeNull();
    expect(appAfter?.manual_job_snapshot).toMatchObject({ companyName: orgName, title });
  });

  test("C) the nightly run still DELETES a closed posting nothing references", async ({ testUser, request }) => {
    const { jobId } = await closedStalePosting(testUser.id);

    const result = await runNightly(request);
    expect(result.ids, `posting ${jobId} was not among the deleted ids: ${JSON.stringify(result)}`).toContain(jobId);
    expect(result).toMatchObject({ eligible: 1, deleted: 1, kept: 0 });

    // Confirmed gone, not assumed from the route's own report.
    const { data: postingAfter } = await admin.from("job_postings").select("id").eq("id", jobId).maybeSingle();
    expect(postingAfter, "the unreferenced posting should actually have been deleted").toBeNull();
    createdJobIds.splice(createdJobIds.indexOf(jobId), 1);
  });
});
