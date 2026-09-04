/**
 * Stage 5a's two properties that a database-level test cannot show on its
 * own: a page actually 404ing at the HTTP level for a stale posting reached
 * by a direct URL, and the feed's URL-param filters actually composing in a
 * real browser. tests/jobs/freshness.test.ts and
 * tests/jobs/freshness-visibility.test.ts already cover the underlying
 * query logic (including two mechanisms sabotage-proofed against a live
 * database) — this is the route/browser layer those cannot reach.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deletePostingsCascade, deleteOrgsCascade } from "../tests/support/delete-orgs";

const DAY_MS = 24 * 60 * 60 * 1000;
const isoAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

test.describe("job freshness (Stage 5a)", () => {
  const createdOrgIds: string[] = [];
  const createdJobIds: string[] = [];

  test.afterEach(async () => {
    await runCleanups(
      [
        "freshness job postings",
        async () => {
          if (createdJobIds.length) await deletePostingsCascade(admin, createdJobIds.splice(0));
        },
      ],
      [
        "freshness organisations",
        async () => {
          if (createdOrgIds.length) await deleteOrgsCascade(admin, createdOrgIds.splice(0));
        },
      ],
    );
  });

  async function fixtureOrg(testUserId: string): Promise<string> {
    const { data: org, error } = await admin
      .from("organizations")
      .insert({ name: `E2E Freshness Co ${randomUUID().slice(0, 8)}`, created_by: testUserId, verified: true })
      .select("id, name")
      .single();
    if (error || !org) throw new Error(`fixture org: ${error?.message}`);
    createdOrgIds.push(org.id);
    return org.id;
  }

  async function fixtureJob(orgId: string, postedAt: string, title: string): Promise<string> {
    const { data: org } = await admin.from("organizations").select("name").eq("id", orgId).single();
    const { data: job, error } = await admin
      .from("job_postings")
      .insert({
        source_type: "internal",
        organization_id: orgId,
        company_name: org!.name,
        title,
        description: "A real fixture posting long enough to render on a card in the e2e suite.",
        status: "open",
        posted_at: postedAt,
        dedup_fingerprint: `e2e-freshness-${randomUUID()}`,
      })
      .select("id")
      .single();
    if (error || !job) throw new Error(`fixture posting: ${error?.message}`);
    createdJobIds.push(job.id);
    return job.id;
  }

  test("a posting older than 30 days 404s via direct URL, even though its id is real and valid", async ({
    authedPage,
    testUser,
  }) => {
    const orgId = await fixtureOrg(testUser.id);
    const staleJobId = await fixtureJob(orgId, isoAgo(35), "E2E Freshness Stale Role");

    const response = await authedPage.goto(`/jobs/${staleJobId}`);
    expect(
      response?.status(),
      "SABOTAGE-PROOF TARGET: a >30-day posting must 404 even reached directly by URL",
    ).toBe(404);
  });

  test("a posting inside the 30-day window renders normally at the same URL shape", async ({
    authedPage,
    testUser,
  }) => {
    // Positive control: proves the 404 above is the freshness floor doing
    // its job, not some unrelated breakage in the route.
    const orgId = await fixtureOrg(testUser.id);
    const freshJobId = await fixtureJob(orgId, isoAgo(5), "E2E Freshness Fresh Role");

    const response = await authedPage.goto(`/jobs/${freshJobId}`);
    expect(response?.status()).toBe(200);
    await expect(authedPage.getByRole("heading", { name: "E2E Freshness Fresh Role" })).toBeVisible();
  });

  test("the Posted filter composes with Work type on the feed — both narrow together, neither is ignored", async ({
    authedPage,
    testUser,
  }) => {
    const orgId = await fixtureOrg(testUser.id);
    // Matches BOTH filters: remote + posted in the last 24h.
    const matchTitle = `E2E Freshness Match ${randomUUID().slice(0, 6)}`;
    const matchId = await fixtureJob(orgId, isoAgo(0), matchTitle);
    await admin.from("job_postings").update({ work_type: "remote" }).eq("id", matchId);

    // Matches Work type but NOT Posted (remote, but 10 days old — outside "24h").
    const wrongAgeTitle = `E2E Freshness WrongAge ${randomUUID().slice(0, 6)}`;
    const wrongAgeId = await fixtureJob(orgId, isoAgo(10), wrongAgeTitle);
    await admin.from("job_postings").update({ work_type: "remote" }).eq("id", wrongAgeId);

    // Matches Posted but NOT Work type (onsite, posted today).
    const wrongTypeTitle = `E2E Freshness WrongType ${randomUUID().slice(0, 6)}`;
    const wrongTypeId = await fixtureJob(orgId, isoAgo(0), wrongTypeTitle);
    await admin.from("job_postings").update({ work_type: "onsite" }).eq("id", wrongTypeId);

    // Recommended (the default tab), not External: External filters to
    // source_type "external" and every fixture here is "internal".
    // Recommended has no source filter, so the two URL params under test
    // (workType, posted) are the only things narrowing the board.
    await authedPage.goto("/jobs?workType=remote&posted=24h");

    await expect(authedPage.getByText(matchTitle)).toBeVisible();
    await expect(
      authedPage.getByText(wrongAgeTitle),
      "SABOTAGE-PROOF TARGET: Work type alone must not be enough — Posted must also apply",
    ).toHaveCount(0);
    await expect(
      authedPage.getByText(wrongTypeTitle),
      "Posted alone must not be enough — Work type must also apply",
    ).toHaveCount(0);
  });
});
