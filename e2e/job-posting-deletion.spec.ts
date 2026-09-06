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
          // Deliberately tolerant of already-gone: the whole point of this
          // spec is that the posting was already deleted by the job under
          // test, so this is only a backstop for a run that fails before
          // reaching that step.
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

  test("shows the frozen company/title from manual_job_snapshot, not a blank or broken card", async ({
    authedPage,
    testUser,
    request,
  }) => {
    const orgName = `E2E DELETION-TEST Co ${randomUUID().slice(0, 8)}`;
    const title = `E2E DELETION-TEST Role ${randomUUID().slice(0, 6)}`;

    const { data: org, error: orgError } = await admin
      .from("organizations")
      .insert({ name: orgName, created_by: testUser.id, verified: true })
      .select("id")
      .single();
    if (orgError || !org) throw new Error(`fixture org: ${orgError?.message}`);
    createdOrgIds.push(org.id);

    // Closed well past the 30-day threshold, so the run below finds it
    // eligible immediately rather than depending on real wall-clock time.
    const closedAt = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    const { data: job, error: jobError } = await admin
      .from("job_postings")
      .insert({
        source_type: "internal",
        organization_id: org.id,
        company_name: orgName,
        title,
        description: "Fixture posting for e2e/job-posting-deletion — old enough to be deleted.",
        structured_jd: {},
        status: "closed",
        closed_at: closedAt,
        location: "Lagos, Nigeria",
        posted_at: closedAt,
        dedup_fingerprint: `e2e-deletion-${randomUUID()}`,
      })
      .select("id")
      .single();
    if (jobError || !job) throw new Error(`fixture posting: ${jobError?.message}`);
    createdJobIds.push(job.id);

    // A real prior application, snapshotted the way the actual apply flow
    // does it (src/lib/applications/job-snapshot.ts's exact shape) — not
    // hand-waved, because the assertion below is specifically that THIS
    // shape is what the Tracker falls back to.
    const { data: application, error: appError } = await admin
      .from("applications")
      .insert({
        user_id: testUser.id,
        job_posting_id: job.id,
        stage: "applied",
        source: "internal_apply",
        applied_at: new Date().toISOString(),
        manual_job_snapshot: { companyName: orgName, title, location: "Lagos, Nigeria" },
      })
      .select("id")
      .single();
    if (appError || !application) throw new Error(`fixture application: ${appError?.message}`);
    createdApplicationIds.push(application.id);

    // The real trigger, not a direct library call — Vercel Cron reaches this
    // exact route, and a manual/admin run uses the same POST path with the
    // same header this repo's other admin routes already standardise on.
    const deletionResponse = await request.post("/api/admin/delete-stale-postings", {
      headers: { "x-admin-secret": ADMIN_SECRET! },
    });
    expect(deletionResponse.ok(), "the deletion route itself failed").toBe(true);
    const deletionBody = await deletionResponse.json();
    expect(
      deletionBody.result?.ids,
      `posting ${job.id} was not among the deleted ids: ${JSON.stringify(deletionBody.result)}`,
    ).toContain(job.id);

    // Confirmed gone, not assumed from the route's own report.
    const { data: postingAfter } = await admin.from("job_postings").select("id").eq("id", job.id).maybeSingle();
    expect(postingAfter, "the posting should have actually been deleted").toBeNull();
    createdJobIds.splice(createdJobIds.indexOf(job.id), 1);

    // The actual page, as the actual user.
    await authedPage.goto("/tracker");
    await expect(authedPage.getByText(title, { exact: false })).toBeVisible();
    await expect(authedPage.getByText(orgName, { exact: false })).toBeVisible();

    // Also true at the database layer — belt and braces, since the UI
    // assertion above is the one that matters but a passing UI assertion
    // reading a STALE cached response would be a false positive.
    const { data: appAfter } = await admin
      .from("applications")
      .select("job_posting_id, manual_job_snapshot")
      .eq("id", application.id)
      .single();
    expect(appAfter?.job_posting_id).toBeNull();
    expect(appAfter?.manual_job_snapshot).toMatchObject({ companyName: orgName, title });
  });
});
