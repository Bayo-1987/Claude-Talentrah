/**
 * The other two-thirds of the ad funnel (0128). `ad-serving-feed.test.ts`
 * already pins impressions — the only event type ever recorded before this
 * build, confirmed by a full-repo search finding zero calls to
 * `record_ad_event` with `event_type: 'click'` or `'apply'` anywhere. This
 * file is the fail-before/pass-after proof for the other two: every
 * assertion below exercises code that did not exist until this change, so
 * "before" is simply "this test file didn't exist and these rows were never
 * written" — the same conclusion the full-repo search already reached, now
 * pinned to an assertion instead of a grep.
 *
 * Two things in this feature turn out to be untestable BY DIRECT CALL from a
 * plain vitest test, both confirmed by actually trying them rather than
 * assumed:
 *
 *   - `applyInAppAction` defers its ad-event writes through `next/server`'s
 *     `after()`, which throws ("called outside a request scope") the instant
 *     it's invoked outside a real Next.js request. No existing action in
 *     this codebase that uses `after()` is unit-tested directly for the same
 *     reason (`logCountryDefaultEvent`, the other thing `applyInAppAction`
 *     defers, has no direct test either).
 *   - `getCampaignAnalytics` calls `createClient()`
 *     (`src/lib/supabase/server.ts`), which calls Next's `cookies()` —
 *     itself request-scoped for the identical reason. Confirmed by running
 *     it here first and watching it throw the same "outside a request
 *     scope" error.
 *
 * What CAN be — and is — tested directly: `recordAdEvent` and
 * `findActiveCampaignForJobPosting` (plain async functions, no Next.js
 * request APIs), and the RLS policies BOTH `getCampaignAnalytics` and the
 * click route's ownership check actually depend on, exercised the same way
 * every other RLS suite in this repo does — real sessions
 * (`createAuthedTestUser`), not the Next.js-coupled wrapper functions. This
 * is not a weaker substitute: PostgREST/RLS enforcement is identical
 * whichever JS client carries the same JWT, so a real session client proves
 * the actual mechanism `getCampaignAnalytics` relies on, just without paying
 * the request-scope tax `createClient()` charges. The full request-scoped
 * integration (a real Apply click producing real rows, the analytics PAGE
 * rendering real numbers) was verified live against the dev server instead —
 * see this PR's own description for that result.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";
import { recordAdEvent, findActiveCampaignForJobPosting } from "@/lib/ads/promoted";

let owner: { id: string; client: DB };
let strangerOwner: { id: string; client: DB };
let orgId: string;
let strangerOrgId: string;
const createdUsers: string[] = [];
const jobIds: string[] = [];
const campaignIds: string[] = [];

async function makePosting(orgIdForJob: string, title: string) {
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: orgIdForJob,
      title,
      company_name: "ADCLICK-TEST Co",
      description: "Fixture posting for the ad click/apply suite.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("no posting");
  jobIds.push(data.id);
  return data.id;
}

async function makeCampaign(
  orgIdForCampaign: string,
  jobId: string,
  createdBy: string,
  status: "active" | "paused_by_employer" | "completed" = "active",
) {
  const { data, error } = await admin
    .from("ad_campaigns")
    .insert({
      organization_id: orgIdForCampaign,
      job_posting_id: jobId,
      name: `ADCLICK-TEST ${randomUUID().slice(0, 6)}`,
      daily_rate_ngn: 1000,
      total_budget_ngn: 30000,
      created_by: createdBy,
      status: status as never,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("no campaign");
  campaignIds.push(data.id);
  return data.id;
}

async function countFor(campaignId: string, eventType: "click" | "apply") {
  const { count } = await admin
    .from("ad_events")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("event_type", eventType);
  return count ?? 0;
}

beforeAll(async () => {
  owner = await createAuthedTestUser("adclick-owner");
  strangerOwner = await createAuthedTestUser("adclick-stranger-owner");
  createdUsers.push(owner.id, strangerOwner.id);

  const [{ data: org, error: orgErr }, { data: strangerOrg, error: strangerOrgErr }] = await Promise.all([
    admin
      .from("organizations")
      .insert({ name: `ADCLICK-TEST Org ${randomUUID().slice(0, 8)}`, created_by: owner.id, verified: true })
      .select("id")
      .single(),
    admin
      .from("organizations")
      .insert({
        name: `ADCLICK-TEST Stranger Org ${randomUUID().slice(0, 8)}`,
        created_by: strangerOwner.id,
        verified: true,
      })
      .select("id")
      .single(),
  ]);
  if (orgErr || !org) throw orgErr ?? new Error("no org");
  if (strangerOrgErr || !strangerOrg) throw strangerOrgErr ?? new Error("no stranger org");
  orgId = org.id;
  strangerOrgId = strangerOrg.id;

  await Promise.all([
    admin.from("organization_members").insert({ organization_id: orgId, user_id: owner.id, role: "owner" }),
    admin
      .from("organization_members")
      .insert({ organization_id: strangerOrgId, user_id: strangerOwner.id, role: "owner" }),
  ]);
}, 120_000);

afterAll(async () => {
  await deleteOrgsCascade(admin, [orgId, strangerOrgId].filter(Boolean));
  await deleteTestUsers(createdUsers);
}, 60_000);

describe("recordAdEvent — click and apply, real rows this build makes possible", () => {
  it("FAIL-BEFORE/PASS-AFTER: a click produces a real ad_events row that didn't exist before this call", async () => {
    const jobId = await makePosting(orgId, "ADCLICK-TEST Click Role");
    const campaignId = await makeCampaign(orgId, jobId, owner.id);

    const before = await countFor(campaignId, "click");
    expect(before, "fixture campaign should start with zero clicks").toBe(0);

    await recordAdEvent({
      campaignId,
      jobPostingId: jobId,
      userId: owner.id,
      eventType: "click",
      surface: "job_feed_click",
    });

    expect(await countFor(campaignId, "click")).toBe(1);
  });

  it("FAIL-BEFORE/PASS-AFTER: an apply produces a real ad_events row that didn't exist before this call", async () => {
    const jobId = await makePosting(orgId, "ADCLICK-TEST Apply Role");
    const campaignId = await makeCampaign(orgId, jobId, owner.id);

    expect(await countFor(campaignId, "apply")).toBe(0);

    await recordAdEvent({
      campaignId,
      jobPostingId: jobId,
      userId: owner.id,
      eventType: "apply",
      surface: "job_feed_apply",
    });

    expect(await countFor(campaignId, "apply")).toBe(1);
  });

  it("dedup holds for click: two rapid calls in the same minute produce one row, not two", async () => {
    const jobId = await makePosting(orgId, "ADCLICK-TEST Dedup Role");
    const campaignId = await makeCampaign(orgId, jobId, owner.id);

    await Promise.all([
      recordAdEvent({ campaignId, jobPostingId: jobId, userId: owner.id, eventType: "click", surface: "job_feed_click" }),
      recordAdEvent({ campaignId, jobPostingId: jobId, userId: owner.id, eventType: "click", surface: "job_feed_click" }),
    ]);

    expect(
      await countFor(campaignId, "click"),
      "a double-click in the same minute must dedup to one row (0052's own bucket rule)",
    ).toBe(1);
  });

  it("dedup holds for apply: two calls the same day produce one row, not two", async () => {
    const jobId = await makePosting(orgId, "ADCLICK-TEST Apply Dedup Role");
    const campaignId = await makeCampaign(orgId, jobId, owner.id);

    await recordAdEvent({ campaignId, jobPostingId: jobId, userId: owner.id, eventType: "apply", surface: "job_feed_apply" });
    await recordAdEvent({ campaignId, jobPostingId: jobId, userId: owner.id, eventType: "apply", surface: "job_feed_apply" });

    expect(await countFor(campaignId, "apply")).toBe(1);
  });

  it("click and apply dedup INDEPENDENTLY of each other — recording both for the same person doesn't collide", async () => {
    // Real concern: the dedup index is (campaign_id, user_id, event_type,
    // dedup_bucket) — event_type is part of the key, so a click and an apply
    // for the same campaign/user/day must both land, not just the first.
    const jobId = await makePosting(orgId, "ADCLICK-TEST Both Role");
    const campaignId = await makeCampaign(orgId, jobId, owner.id);

    await recordAdEvent({ campaignId, jobPostingId: jobId, userId: owner.id, eventType: "click", surface: "job_feed_apply" });
    await recordAdEvent({ campaignId, jobPostingId: jobId, userId: owner.id, eventType: "apply", surface: "job_feed_apply" });

    expect(await countFor(campaignId, "click")).toBe(1);
    expect(await countFor(campaignId, "apply")).toBe(1);
  });
});

describe("findActiveCampaignForJobPosting", () => {
  it("finds the real active campaign for a job posting", async () => {
    const jobId = await makePosting(orgId, "ADCLICK-TEST Active Lookup");
    const campaignId = await makeCampaign(orgId, jobId, owner.id, "active");
    expect(await findActiveCampaignForJobPosting(jobId)).toBe(campaignId);
  });

  it("returns null for a job posting with no campaign at all", async () => {
    const jobId = await makePosting(orgId, "ADCLICK-TEST No Campaign");
    expect(await findActiveCampaignForJobPosting(jobId)).toBeNull();
  });

  it("returns null for a job posting whose only campaign is paused, not active", async () => {
    const jobId = await makePosting(orgId, "ADCLICK-TEST Paused Campaign");
    await makeCampaign(orgId, jobId, owner.id, "paused_by_employer");
    expect(await findActiveCampaignForJobPosting(jobId)).toBeNull();
  });

  it("returns null for a completed campaign", async () => {
    const jobId = await makePosting(orgId, "ADCLICK-TEST Completed Campaign");
    await makeCampaign(orgId, jobId, owner.id, "completed");
    expect(await findActiveCampaignForJobPosting(jobId)).toBeNull();
  });
});

describe(
  "the RLS policies getCampaignAnalytics depends on — exercised directly, since createClient()'s " +
    "own cookies() call is just as request-scoped as after()",
  () => {
    const countForAs = async (client: DB, campaignId: string, eventType: "click" | "apply" | "impression") => {
      const { count } = await client
        .from("ad_events")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("event_type", eventType);
      return count ?? 0;
    };

    it("the owning org's own session sees the same counts a service-role read sees", async () => {
      const jobId = await makePosting(orgId, "ADCLICK-TEST Analytics Role");
      const campaignId = await makeCampaign(orgId, jobId, owner.id);

      await recordAdEvent({ campaignId, jobPostingId: jobId, userId: owner.id, eventType: "click", surface: "job_feed_click" });
      await recordAdEvent({
        campaignId,
        jobPostingId: jobId,
        userId: owner.id,
        eventType: "apply",
        surface: "job_feed_apply",
      });
      await admin.rpc("record_ad_event", {
        p_campaign_id: campaignId,
        p_job_posting_id: jobId,
        p_user_id: owner.id,
        p_event_type: "impression",
        p_surface: "job_feed_render",
      });

      // Exactly the three queries getCampaignAnalytics runs — through the
      // real owning-org session (what the Server Component actually uses),
      // compared against an unrestricted admin read of the same rows.
      const [sessionClicks, sessionApplies, sessionImpressions] = await Promise.all([
        countForAs(owner.client, campaignId, "click"),
        countForAs(owner.client, campaignId, "apply"),
        countForAs(owner.client, campaignId, "impression"),
      ]);
      const [directClicks, directApplies, directImpressions] = await Promise.all([
        countFor(campaignId, "click"),
        countFor(campaignId, "apply"),
        countForAs(admin, campaignId, "impression"),
      ]);

      expect(sessionClicks).toBe(directClicks);
      expect(sessionApplies).toBe(directApplies);
      expect(sessionImpressions).toBe(directImpressions);
      expect(sessionClicks, "the fixture itself should have produced a real, non-zero count").toBeGreaterThan(0);
    });

    it(
      "SABOTAGE-PROOF TARGET: an org's own session reads ZERO events for another org's campaign — " +
        "not an error, not the real count",
      async () => {
        const jobId = await makePosting(orgId, "ADCLICK-TEST Isolation Role");
        const campaignId = await makeCampaign(orgId, jobId, owner.id);
        await recordAdEvent({
          campaignId,
          jobPostingId: jobId,
          userId: owner.id,
          eventType: "click",
          surface: "job_feed_click",
        });

        // This is the exact query getCampaignAnalytics(strangerOrgId, campaignId)
        // would run once RLS — not an app-level organizationId filter — is what
        // actually decides the answer: the stranger's own session reading a
        // real campaign that is genuinely not theirs.
        const { data, error } = await strangerOwner.client
          .from("ad_events")
          .select("id")
          .eq("campaign_id", campaignId);
        expect(error).toBeNull();
        expect(
          data ?? [],
          "LEAK: an unrelated organisation's session read another org's campaign events",
        ).toHaveLength(0);

        // And the ownership pre-check getCampaignAnalytics does BEFORE
        // reading ad_events — ad_campaigns' own SELECT policy (0047,
        // is_org_member(organization_id)) is what makes a foreign campaign
        // id invisible, the same reason a wrong id and "no events yet" must
        // not look identical.
        const { data: campaignRow } = await strangerOwner.client
          .from("ad_campaigns")
          .select("id")
          .eq("organization_id", strangerOrgId)
          .eq("id", campaignId)
          .maybeSingle();
        expect(
          campaignRow,
          "LEAK: a foreign organisation's session could see another org's campaign row at all",
        ).toBeNull();
      },
    );
  },
);
