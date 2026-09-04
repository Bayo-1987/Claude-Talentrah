/**
 * Stage 5a's snapshot-at-creation change: every `applications` row now
 * carries `manual_job_snapshot` in the same {companyName, title, url,
 * location} shape the manual tracker path already used, written by
 * src/lib/applications/job-snapshot.ts and populated at every creation site
 * (src/lib/applications/actions.ts's toggleSaveAction, applyInAppAction,
 * markAppliedExternallyAction). The point is to make a user's application
 * history independent of the posting surviving Stage 5b's later deletion —
 * this test proves the snapshot actually lands in the row, not just that the
 * button reports success.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deletePostingsCascade, deleteOrgsCascade } from "../tests/support/delete-orgs";

test.describe("application snapshot at creation (Stage 5a)", () => {
  const createdOrgIds: string[] = [];
  const createdJobIds: string[] = [];

  test.afterEach(async () => {
    await runCleanups(
      [
        "snapshot job postings",
        async () => {
          if (createdJobIds.length) await deletePostingsCascade(admin, createdJobIds.splice(0));
        },
      ],
      [
        "snapshot organisations",
        async () => {
          if (createdOrgIds.length) await deleteOrgsCascade(admin, createdOrgIds.splice(0));
        },
      ],
    );
  });

  async function fixtureOrg(testUserId: string, name: string): Promise<string> {
    const { data: org, error } = await admin
      .from("organizations")
      .insert({ name, created_by: testUserId, verified: true })
      .select("id, name")
      .single();
    if (error || !org) throw new Error(`fixture org: ${error?.message}`);
    createdOrgIds.push(org.id);
    return org.id;
  }

  async function fixtureJob(
    orgId: string | null,
    companyName: string,
    title: string,
    overrides: { sourceType?: "internal" | "external"; externalUrl?: string } = {},
  ): Promise<string> {
    // External postings carry their own company_name and no organization_id
    // — job_postings_internal_has_org requires exactly one of the two,
    // matched to source_type (0000_baseline_schema.sql).
    const { data: job, error } = await admin
      .from("job_postings")
      .insert({
        source_type: overrides.sourceType ?? "internal",
        organization_id: orgId,
        company_name: companyName,
        title,
        description: "A real fixture posting long enough to render on the detail page.",
        status: "open",
        location: "Lagos, Nigeria",
        posted_at: new Date().toISOString(),
        external_url: overrides.externalUrl,
        dedup_fingerprint: `e2e-snapshot-${randomUUID()}`,
      })
      .select("id")
      .single();
    if (error || !job) throw new Error(`fixture posting: ${error?.message}`);
    createdJobIds.push(job.id);
    return job.id;
  }

  function expectSnapshotShape(snapshot: unknown, expected: { title: string; companyName: string }) {
    expect(snapshot, "SABOTAGE-PROOF TARGET: no manual_job_snapshot was written at all").not.toBeNull();
    const s = snapshot as Record<string, unknown>;
    expect(s.title).toBe(expected.title);
    expect(s.companyName).toBe(expected.companyName);
    expect(s.location).toBe("Lagos, Nigeria");
  }

  test("saving an internal job writes a snapshot on the new row", async ({ authedPage, testUser }) => {
    const orgName = `E2E Snapshot Co ${randomUUID().slice(0, 8)}`;
    const orgId = await fixtureOrg(testUser.id, orgName);
    const title = `E2E Snapshot Save Role ${randomUUID().slice(0, 6)}`;
    const jobId = await fixtureJob(orgId, orgName, title);

    await authedPage.goto(`/jobs/${jobId}`);
    await authedPage.getByRole("button", { name: "Save", exact: true }).click();
    await authedPage.waitForLoadState("networkidle");

    const { data: row, error } = await admin
      .from("applications")
      .select("manual_job_snapshot")
      .eq("user_id", testUser.id)
      .eq("job_posting_id", jobId)
      .single();
    expect(error, "no application row was created by Save").toBeNull();
    expectSnapshotShape(row!.manual_job_snapshot, { title, companyName: orgName });
  });

  test("applying in-app to an internal job writes a snapshot on the new row", async ({
    authedPage,
    testUser,
  }) => {
    const orgName = `E2E Snapshot Co ${randomUUID().slice(0, 8)}`;
    const orgId = await fixtureOrg(testUser.id, orgName);
    const title = `E2E Snapshot Apply Role ${randomUUID().slice(0, 6)}`;
    const jobId = await fixtureJob(orgId, orgName, title);

    await authedPage.goto(`/jobs/${jobId}`);
    await authedPage.getByRole("button", { name: "Apply", exact: true }).click();
    await authedPage.waitForLoadState("networkidle");

    const { data: row, error } = await admin
      .from("applications")
      .select("manual_job_snapshot, stage")
      .eq("user_id", testUser.id)
      .eq("job_posting_id", jobId)
      .single();
    expect(error, "no application row was created by Apply").toBeNull();
    expect(row!.stage).toBe("applied");
    expectSnapshotShape(row!.manual_job_snapshot, { title, companyName: orgName });
  });

  test("marking an external job as applied writes a snapshot on the new row", async ({
    authedPage,
    testUser,
  }) => {
    // External postings have no organization_id (job_postings_internal_has_org),
    // so no fixture org here — just a company_name on the posting itself.
    const companyName = `E2E Snapshot External Co ${randomUUID().slice(0, 8)}`;
    const title = `E2E Snapshot External Role ${randomUUID().slice(0, 6)}`;
    const jobId = await fixtureJob(null, companyName, title, {
      sourceType: "external",
      externalUrl: "https://example.com/careers/role",
    });

    await authedPage.goto(`/jobs/${jobId}`);
    await authedPage.getByRole("button", { name: "Mark as applied", exact: true }).click();
    await authedPage.waitForLoadState("networkidle");

    const { data: row, error } = await admin
      .from("applications")
      .select("manual_job_snapshot, stage")
      .eq("user_id", testUser.id)
      .eq("job_posting_id", jobId)
      .single();
    expect(error, "no application row was created by Mark as applied").toBeNull();
    expect(row!.stage).toBe("applied");
    expectSnapshotShape(row!.manual_job_snapshot, { title, companyName });
  });
});
