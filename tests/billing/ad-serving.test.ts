/**
 * Ad SERVING — the half that makes the charge correspond to something.
 *
 * Campaigns have been chargeable since 0047 and readable by nobody outside the
 * employer surface since 0047. `promoted_jobs` is the narrow hole through
 * `ad_campaigns`' org-members-only SELECT policy: job ids and campaign ids,
 * and not one money column.
 *
 * The two properties worth the most scrutiny here:
 *
 *   1. IT TAKES NO USER ID. The obvious signature had `p_user_id` and would
 *      have been a data leak — SECURITY DEFINER, executable by `authenticated`,
 *      so any signed-in caller could pass someone else's id and read their
 *      match scores back. The user comes from auth.uid(). Pinned below.
 *
 *   2. PAYMENT DOES NOT OVERRIDE RELEVANCE (D1). A promoted job must clear the
 *      seeker's own filters and the same match threshold as an organic result.
 *      The match score is the product's central claim; a paid slot that ignored
 *      it would discredit every other score on the page.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";
import type { Database } from "@/lib/supabase/types";

type PromotedJobsArgs = Database["public"]["Functions"]["promoted_jobs"]["Args"];

let owner: { id: string; client: DB };
let seeker: { id: string; client: DB };
let stranger: { id: string; client: DB };
let orgId: string;
let jobId: string;
let campaignId: string;
const createdUsers: string[] = [];

/**
 * Every campaign mutation in this file goes through here.
 *
 * The first version of the end-date test used a bare
 * `admin.from("ad_campaigns").update(...)` and CI caught it: `ends_on` has
 * `check (ends_on is null or ends_on >= starts_on)` and `starts_on` defaults
 * to today, so setting `ends_on` to yesterday was REJECTED — and because the
 * error was never read, the test proceeded believing its own setup. The
 * assertion then failed for the honest reason that the campaign really was
 * still live.
 *
 * Same shape as the unchecked deletes that let test organisations pile up in
 * production for weeks. A setup step that cannot fail loudly is a test that
 * can pass or fail for reasons unrelated to what it claims to check.
 */
async function updateCampaign(patch: Record<string, unknown>) {
  const { error } = await admin
    .from("ad_campaigns")
    .update(patch as never)
    .eq("id", campaignId);
  if (error) throw new Error(`campaign setup failed: ${error.message} [${error.code}]`);
}

/** Sets a campaign's status directly. Only the service role may (0048). */
async function setStatus(status: string) {
  await updateCampaign({ status });
}

async function scoreFor(userId: string, score: number) {
  const { error } = await admin
    .from("match_scores")
    .upsert(
      { user_id: userId, job_posting_id: jobId, score, tier: score >= 80 ? "excellent" : "good" },
      { onConflict: "user_id,job_posting_id" },
    );
  if (error) throw error;
}

async function promotedFor(client: DB, opts: PromotedJobsArgs = {}) {
  const { data, error } = await client.rpc("promoted_jobs", opts);
  if (error) throw error;
  return (data ?? []) as { job_posting_id: string; campaign_id: string; match_score: number }[];
}

beforeAll(async () => {
  owner = await createAuthedTestUser("adserve-owner");
  seeker = await createAuthedTestUser("adserve-seeker");
  stranger = await createAuthedTestUser("adserve-stranger");
  createdUsers.push(owner.id, seeker.id, stranger.id);

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({
      name: `ADSERVE-TEST Org ${randomUUID().slice(0, 8)}`,
      domain: `adserve-${randomUUID().slice(0, 8)}.example`,
      created_by: owner.id,
      verified: true,
    })
    .select("id")
    .single();
  if (orgErr || !org) throw orgErr ?? new Error("no org");
  orgId = org.id;
  await admin.from("organization_members").insert({
    organization_id: orgId,
    user_id: owner.id,
    role: "owner",
  });

  const { data: job, error: jobErr } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: orgId,
      title: "ADSERVE-TEST Role",
      company_name: "ADSERVE-TEST Co",
      description: "Fixture posting for ad serving.",
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
  if (jobErr || !job) throw jobErr ?? new Error("no job");
  jobId = job.id;

  const { data: campaign, error: cErr } = await admin
    .from("ad_campaigns")
    .insert({
      organization_id: orgId,
      job_posting_id: jobId,
      name: "ADSERVE-TEST Campaign",
      daily_rate_ngn: 1000,
      total_budget_ngn: 30000,
      created_by: owner.id,
      status: "active" as never,
    })
    .select("id")
    .single();
  if (cErr || !campaign) throw cErr ?? new Error("no campaign");
  campaignId = campaign.id;
}, 120_000);

afterAll(async () => {
  if (orgId) await deleteOrgsCascade(admin, [orgId]);
  await deleteTestUsers(createdUsers);
}, 60_000);

describe("promoted_jobs takes the caller from auth.uid(), not an argument", () => {
  it("SECURITY: one seeker cannot read another's promoted set", async () => {
    await scoreFor(seeker.id, 95);
    // The stranger has NO match score for this job, so a correct function
    // returns nothing for them — regardless of what the seeker sees.
    expect(await promotedFor(seeker.client)).toHaveLength(1);
    expect(
      await promotedFor(stranger.client),
      "a second user saw a promoted set built from someone else's match scores",
    ).toHaveLength(0);
  });

  it("returns nothing to the service role — there is no seeker to promote to", async () => {
    await scoreFor(seeker.id, 95);
    // auth.uid() is null for service_role. Returning "everything" here would be
    // the natural bug, and it would leak every user's promoted set to any
    // server-side caller that forgot to pass a session.
    expect(await promotedFor(admin as unknown as DB)).toHaveLength(0);
  });
});

describe("D1 — payment does not override relevance", () => {
  it("a below-threshold match is NOT promoted, however much was paid", async () => {
    await scoreFor(seeker.id, 55);
    expect(
      await promotedFor(seeker.client, { p_min_score: 60 }),
      "a paid slot bypassed the match threshold",
    ).toHaveLength(0);

    await scoreFor(seeker.id, 85);
    expect(await promotedFor(seeker.client, { p_min_score: 60 })).toHaveLength(1);
  });

  it("the seeker's own filters bind a paid slot", async () => {
    await scoreFor(seeker.id, 95);
    // The fixture job is remote/mid.
    expect(
      await promotedFor(seeker.client, { p_work_types: ["onsite"] }),
      "a promoted job ignored the seeker's work-type filter",
    ).toHaveLength(0);
    expect(
      await promotedFor(seeker.client, { p_seniorities: ["executive"] }),
      "a promoted job ignored the seeker's seniority filter",
    ).toHaveLength(0);
    expect(await promotedFor(seeker.client, { p_work_types: ["remote"] })).toHaveLength(1);
  });

  it("0095: a multi-select work-type filter matches ANY of the selected values", async () => {
    await scoreFor(seeker.id, 95);
    // The fixture job is remote/mid — Hybrid alone would exclude it; Remote
    // OR Hybrid, the feed's own multi-select shape, must still include it.
    expect(
      await promotedFor(seeker.client, { p_work_types: ["remote", "hybrid"] }),
    ).toHaveLength(1);
  });

  it("the employer's targeting binds too, and an empty target means untargeted", async () => {
    await scoreFor(seeker.id, 95);
    await updateCampaign({ target_locations: ["Abuja"] });
    expect(
      await promotedFor(seeker.client),
      "a campaign targeted at Abuja served a Lagos posting",
    ).toHaveLength(0);

    await updateCampaign({ target_locations: null });
    expect(
      await promotedFor(seeker.client),
      "a null target should mean untargeted, not matches-nothing",
    ).toHaveLength(1);
  });
});

describe("only a live campaign serves", () => {
  it("a paused or completed campaign is not promoted", async () => {
    await scoreFor(seeker.id, 95);
    for (const status of ["paused_by_employer", "paused_insufficient_funds", "completed", "draft"]) {
      await setStatus(status);
      expect(
        await promotedFor(seeker.client),
        `a campaign in ${status} was served`,
      ).toHaveLength(0);
    }
    await setStatus("active");
    expect(await promotedFor(seeker.client)).toHaveLength(1);
  });

  it("a campaign past its end date is not promoted", async () => {
    await scoreFor(seeker.id, 95);
    /*
     * `starts_on` moves too. `ad_campaigns_ends_after_starts` requires
     * ends_on >= starts_on, and starts_on defaults to today — so backdating
     * only the end date is rejected by the constraint, which is exactly how
     * this test failed the first time.
     */
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    await updateCampaign({ starts_on: day(-2), ends_on: day(-1) });
    expect(
      await promotedFor(seeker.client),
      "a campaign past its end date was still served",
    ).toHaveLength(0);

    await updateCampaign({ starts_on: day(0), ends_on: null });
    expect(await promotedFor(seeker.client)).toHaveLength(1);
  });
});

describe("ad_events is append-only, by the server, deduped", () => {
  it("a client cannot write an event — it would be writing an invoice", async () => {
    const ins = await seeker.client.from("ad_events").insert({
      campaign_id: campaignId,
      job_posting_id: jobId,
      user_id: seeker.id,
      event_type: "click",
      dedup_bucket: "forged",
    });
    expect(ins.error, "a user authored their own ad event").not.toBeNull();
    expect(ins.error?.code).toBe("42501");
  });

  it("MONEY-SHAPED: the same impression in the same day records once", async () => {
    const before = await countEvents("impression");
    for (let i = 0; i < 5; i += 1) {
      await admin.rpc("record_ad_event", {
        p_campaign_id: campaignId,
        p_job_posting_id: jobId,
        p_user_id: seeker.id,
        p_event_type: "impression",
      });
    }
    expect(
      (await countEvents("impression")) - before,
      "a re-rendered feed inflated the impression count",
    ).toBe(1);
  });

  it("reports whether it actually recorded, so a caller can tell", async () => {
    const first = await admin.rpc("record_ad_event", {
      p_campaign_id: campaignId,
      p_job_posting_id: jobId,
      p_user_id: stranger.id,
      p_event_type: "apply",
    });
    const second = await admin.rpc("record_ad_event", {
      p_campaign_id: campaignId,
      p_job_posting_id: jobId,
      p_user_id: stranger.id,
      p_event_type: "apply",
    });
    expect(first.data, "the first apply should have been recorded").toBe(true);
    expect(second.data, "the duplicate should report false, not throw").toBe(false);
  });

  it("different event types in the same bucket do not collide", async () => {
    await admin.rpc("record_ad_event", {
      p_campaign_id: campaignId, p_job_posting_id: jobId,
      p_user_id: seeker.id, p_event_type: "impression",
    });
    const click = await admin.rpc("record_ad_event", {
      p_campaign_id: campaignId, p_job_posting_id: jobId,
      p_user_id: seeker.id, p_event_type: "click",
    });
    expect(click.data, "a click was swallowed by the day's impression").toBe(true);
  });

  it("the employer can read their own campaign's events, and only theirs", async () => {
    const { data: mine } = await owner.client.from("ad_events").select("id").eq("campaign_id", campaignId);
    expect((mine ?? []).length, "the employer cannot see their own analytics").toBeGreaterThan(0);
    const { data: theirs } = await seeker.client.from("ad_events").select("id").eq("campaign_id", campaignId);
    expect(theirs ?? [], "a seeker read an employer's campaign analytics").toHaveLength(0);
  });
});

async function countEvents(type: string): Promise<number> {
  const { count } = await admin
    .from("ad_events")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("event_type", type as never);
  return count ?? 0;
}

/**
 * VERIFICATION (0109) — a paid slot clears the same gate as an organic one.
 *
 * ── WHY THIS WAS NOT CAUGHT BY ANYTHING ABOVE ─────────────────────────────
 *
 * `promoted_jobs` is SECURITY DEFINER, so the `job postings are publicly
 * readable` policy — the one that hides an unverified organisation's postings
 * (0027) — never runs for it. Every other listing surface leans on that
 * policy. This one filtered posting status, campaign state and the seeker's
 * filters, and never asked whether the organisation was verified.
 *
 * Measured on a live database before the fix, one statement, one user, one
 * instant: the organic surface returned 0 rows and the paid surface returned
 * 1. The gate held where nothing was being paid for and failed where money
 * had changed hands, which is the wrong way round — an advertisement carries
 * more implied endorsement than an organic card, not less.
 *
 * ── HOW AN UNVERIFIED ORG GETS A LIVE CAMPAIGN AND A SCORED SEEKER ────────
 *
 * Both look impossible and are not:
 *
 *   - REVIEW IS NOT A VERIFICATION GATE. `set_ad_campaign_review` has no such
 *     condition. The admin queue merely DISPLAYS the org's verified state,
 *     with the comment "an unverified organisation running paid ads is worth
 *     a second look" — advisory, for a human to weigh.
 *   - VERIFICATION IS NOT ONE-WAY. `saveCompanyProfileAction` re-runs it in
 *     both directions on a domain change, deliberately, so an employer cannot
 *     verify with their real domain and then rename to someone else's. The
 *     `match_scores` rows written while they were verified outlive it.
 *
 * So: verify, post, get approved, run; seekers are scored organically; change
 * the domain; the badge is correctly revoked and the advertisement keeps
 * running for everyone already holding a score.
 *
 * These tests reuse this file's own fixture and toggle EXACTLY ONE FIELD, so
 * neither direction can pass for an unrelated reason.
 */
describe("an unverified organisation's campaign reaches nobody", () => {
  async function setVerified(verified: boolean) {
    const { error } = await admin
      .from("organizations")
      .update({ verified })
      .eq("id", orgId);
    // Checked, for the reason updateCampaign's header gives: a setup step that
    // cannot fail loudly turns this into a test that passes for its own
    // reasons. `verified` is service-role-writable only (0028), so a client
    // doing this would be refused and the refusal would be silent.
    if (error) throw new Error(`verification setup failed: ${error.message} [${error.code}]`);
  }

  afterAll(async () => {
    // Restore, so ordering cannot leak this into a later test in the file.
    await setVerified(true);
  });

  it("is promoted while the organisation is verified — the control", async () => {
    /*
     * FIRST, and deliberately. Every assertion below is equally satisfied by a
     * promoted_jobs that returns nothing at all, which is exactly what a
     * botched `create or replace` produces. This pins that the fixture really
     * does promote before anything is toggled.
     */
    await setVerified(true);
    await scoreFor(seeker.id, 88);
    const rows = await promotedFor(seeker.client, { p_min_score: 60, p_limit: 10 });
    expect(
      rows.map((r) => r.job_posting_id),
      "the fixture does not promote even when verified — every case below is vacuous",
    ).toContain(jobId);
  });

  it("stops being promoted the moment the organisation loses verification", async () => {
    await setVerified(false);
    const rows = await promotedFor(seeker.client, { p_min_score: 60, p_limit: 10 });
    expect(
      rows.map((r) => r.job_posting_id),
      "LEAK: an unverified organisation's posting was served as a paid slot",
    ).not.toContain(jobId);
  });

  it("agrees with what the organic surface does with the same row", async () => {
    /*
     * The property that actually matters, asserted as one thing rather than
     * two: the paid and organic surfaces must reach the SAME answer about the
     * same posting. Asserted through the seeker's own RLS-scoped client, not
     * the service role, so it is the real policy answering.
     */
    await setVerified(false);
    const { data: organic } = await seeker.client
      .from("job_postings")
      .select("id")
      .eq("id", jobId);
    const promoted = await promotedFor(seeker.client, { p_min_score: 60, p_limit: 10 });

    const organicSees = (organic ?? []).length > 0;
    const promotedSees = promoted.some((r) => r.job_posting_id === jobId);
    expect(organicSees, "0027's gate stopped holding on the organic surface").toBe(false);
    expect(
      promotedSees,
      "the paid surface disagreed with the organic one about the same posting",
    ).toBe(organicSees);
  });

  it("comes back when verification is restored, so the rule is the org's state", async () => {
    // Proves the exclusion tracks `verified` specifically, and is not the
    // campaign having been quietly broken by one of the toggles above.
    await setVerified(true);
    const rows = await promotedFor(seeker.client, { p_min_score: 60, p_limit: 10 });
    expect(rows.map((r) => r.job_posting_id)).toContain(jobId);
  });
});
