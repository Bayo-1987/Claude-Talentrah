/**
 * The feed side of ad serving.
 *
 * `ad-serving.test.ts` pins what the DATABASE will hand out. This pins what the
 * feed does with it — the layer where a paid slot could quietly stop being
 * labelled, start ignoring a filter, or bill for a card nobody rendered.
 *
 * These call the same functions the page calls, with a real session, rather
 * than rendering the page: the page is a server component that also scores
 * resumes, scans Auto-Apply and reads five other tables, none of which is
 * under test here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";
import {
  fetchPromotedJobs,
  recordPromotedImpressions,
  PROMOTED_MIN_SCORE,
  PROMOTED_SLOTS,
} from "@/lib/ads/promoted";

let owner: { id: string; client: DB };
let seeker: { id: string; client: DB };
let orgId: string;
const jobIds: string[] = [];
const campaignIds: string[] = [];
const createdUsers: string[] = [];

async function makePosting(title: string) {
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: orgId,
      title,
      company_name: "ADFEED-TEST Co",
      description: "Fixture posting for feed ad serving.",
      structured_jd: {},
      status: "open",
      work_type: "remote",
      seniority: "mid",
      employment_type: "full_time",
      location: "Lagos, Nigeria",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("no posting");
  jobIds.push(data.id);
  return data.id;
}

async function makeCampaign(jobId: string) {
  const { data, error } = await admin
    .from("ad_campaigns")
    .insert({
      organization_id: orgId,
      job_posting_id: jobId,
      name: `ADFEED-TEST ${randomUUID().slice(0, 6)}`,
      daily_rate_ngn: 1000,
      total_budget_ngn: 30000,
      created_by: owner.id,
      status: "active" as never,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("no campaign");
  campaignIds.push(data.id);
  return data.id;
}

async function score(jobId: string, value: number) {
  const { error } = await admin.from("match_scores").upsert(
    { user_id: seeker.id, job_posting_id: jobId, score: value, tier: value >= 80 ? "excellent" : "good" },
    { onConflict: "user_id,job_posting_id" },
  );
  if (error) throw error;
}

async function impressionsFor(campaignId: string) {
  const { count } = await admin
    .from("ad_events")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("event_type", "impression");
  return count ?? 0;
}

beforeAll(async () => {
  owner = await createAuthedTestUser("adfeed-owner");
  seeker = await createAuthedTestUser("adfeed-seeker");
  createdUsers.push(owner.id, seeker.id);

  const { data: org, error } = await admin
    .from("organizations")
    .insert({
      name: `ADFEED-TEST Org ${randomUUID().slice(0, 8)}`,
      domain: `adfeed-${randomUUID().slice(0, 8)}.example`,
      created_by: owner.id,
      verified: true,
    })
    .select("id")
    .single();
  if (error || !org) throw error ?? new Error("no org");
  orgId = org.id;
  await admin.from("organization_members").insert({
    organization_id: orgId, user_id: owner.id, role: "owner",
  });
}, 120_000);

afterAll(async () => {
  if (orgId) await deleteOrgsCascade(admin, [orgId]);
  await deleteTestUsers(createdUsers);
}, 60_000);

describe("what the feed asks for", () => {
  it("returns at most the slot count, however many campaigns are live", async () => {
    for (let i = 0; i < PROMOTED_SLOTS + 2; i += 1) {
      const jobId = await makePosting(`ADFEED-TEST Role ${i}`);
      await makeCampaign(jobId);
      await score(jobId, 90);
    }
    const promoted = await fetchPromotedJobs(seeker.client, {});
    expect(
      promoted.length,
      "more paid slots rendered than the feed allocates",
    ).toBeLessThanOrEqual(PROMOTED_SLOTS);
    expect(promoted.length).toBe(PROMOTED_SLOTS);
  });

  it("D1: the floor the feed passes keeps an untiered job out", async () => {
    const jobId = await makePosting("ADFEED-TEST Untiered");
    await makeCampaign(jobId);
    // Below 60 the match-tier system has no word for the score, so a card at
    // the top of the feed would show a number the design cannot label.
    await score(jobId, PROMOTED_MIN_SCORE - 1);
    const promoted = await fetchPromotedJobs(seeker.client, { limit: 20 });
    expect(
      promoted.some((p) => p.jobPostingId === jobId),
      "a paid slot appeared below the bottom of the tier system",
    ).toBe(false);

    await score(jobId, PROMOTED_MIN_SCORE);
    const after = await fetchPromotedJobs(seeker.client, { limit: 20 });
    expect(after.some((p) => p.jobPostingId === jobId)).toBe(true);
  });

  it("D1: the seeker's filter is passed through, not applied afterwards", async () => {
    // Applying it afterwards would return the job, then hide it — and the
    // impression would already have been billed for a card nobody saw.
    const promoted = await fetchPromotedJobs(seeker.client, { workTypes: ["onsite"], limit: 20 });
    expect(
      promoted.length,
      "the work-type filter did not reach the promoted query",
    ).toBe(0);
  });

  it("0095: a multi-select filter matches ANY of the selected values, not just the first", async () => {
    // The fixture posting is work_type "remote". A reader with Remote AND
    // Hybrid both active (the feed's own multi-select, ?workType=remote,hybrid)
    // must still see it promoted — an array collapsed to only its first
    // element, or one that required ALL values to match, would both wrongly
    // exclude it here.
    const jobId = await makePosting("ADFEED-TEST Multi-select");
    await makeCampaign(jobId);
    await score(jobId, PROMOTED_MIN_SCORE);
    const promoted = await fetchPromotedJobs(seeker.client, {
      workTypes: ["hybrid", "remote"],
      limit: 20,
    });
    expect(
      promoted.some((p) => p.jobPostingId === jobId),
      "a remote posting was excluded even though Remote was one of the selected work types",
    ).toBe(true);
  });
});

describe("impressions are recorded once per day per campaign", () => {
  it("MONEY-SHAPED: re-rendering the feed does not inflate the count", async () => {
    const jobId = await makePosting("ADFEED-TEST Impression");
    const campaignId = await makeCampaign(jobId);
    await score(jobId, 95);
    const promoted = [{ jobPostingId: jobId, campaignId, matchScore: 95 }];

    const before = await impressionsFor(campaignId);
    // A filter change, a back-navigation and a refresh are three renders.
    for (let i = 0; i < 3; i += 1) await recordPromotedImpressions(seeker.id, promoted);

    expect(
      (await impressionsFor(campaignId)) - before,
      "three renders billed three impressions",
    ).toBe(1);
  });

  it("records nothing when nothing was promoted", async () => {
    // The empty case has to be a no-op rather than an error — most feed renders
    // have no live campaign to show at all.
    await expect(recordPromotedImpressions(seeker.id, [])).resolves.toBeUndefined();
  });

  it("the surface says these are render counts, not viewport counts", async () => {
    const jobId = await makePosting("ADFEED-TEST Surface");
    const campaignId = await makeCampaign(jobId);
    await score(jobId, 95);
    await recordPromotedImpressions(seeker.id, [{ jobPostingId: jobId, campaignId, matchScore: 95 }]);

    const { data } = await admin
      .from("ad_events")
      .select("surface")
      .eq("campaign_id", campaignId)
      .eq("event_type", "impression");
    /*
     * D3 in the data, not only in a comment. These over-count — the card was
     * emitted, not necessarily seen — and whoever bills on them later should be
     * able to read that off the row rather than infer it from where the code
     * used to live.
     */
    expect(data?.[0]?.surface, "the counting method is not recorded on the event").toBe(
      "job_feed_render",
    );
  });
});
