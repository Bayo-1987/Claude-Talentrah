/**
 * Path 3 (0118/0119): an admin can approve ONE job posting for public
 * listing without touching the organisation's own `verified` flag.
 *
 * Three things this suite proves against a real database rather than
 * assumes from reading the migration:
 *
 *   1. The new SELECT branch actually admits an approved posting, and only
 *      an approved one — null and rejected stay hidden, same as before 0119.
 *   2. `search_job_postings` (SECURITY INVOKER, 0108) inherits the branch
 *      automatically, with no code change of its own — the claim 0119's
 *      header makes, proved rather than trusted.
 *   3. `promoted_jobs` (SECURITY DEFINER, 0109) does NOT inherit it — a real
 *      negative test with a live campaign and a live match_scores row, not
 *      just "the migration didn't touch that file".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { admin, createAuthedTestUser, deleteTestUsers, type TestUser } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const anon: SupabaseClient<Database> = createClient<Database>(URL, ANON, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let seeker: TestUser & { client: SupabaseClient<Database> };
let orgOwner: TestUser;
let orgId: string;
let jobId: string;
const campaignIds: string[] = [];

beforeAll(async () => {
  [seeker, orgOwner] = await Promise.all([
    createAuthedTestUser("path3-seeker"),
    createAuthedTestUser("path3-owner"),
  ]);

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({
      name: `PATH3-TEST Org ${randomUUID().slice(0, 8)}`,
      created_by: orgOwner.id,
      verified: false,
    })
    .select("id")
    .single();
  if (orgErr) throw new Error(`fixture org: ${orgErr.message}`);
  orgId = org!.id;

  const { data: job, error: jobErr } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: orgId,
      company_name: "PATH3-TEST Co",
      title: `PATH3-TEST UniqueSlugP3 Role ${randomUUID().slice(0, 8)}`,
      description: "Fixture posting for the Path 3 RLS/RPC suite.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
    })
    .select("id, title")
    .single();
  if (jobErr) throw new Error(`fixture job: ${jobErr.message}`);
  jobId = job!.id;
});

afterAll(async () => {
  if (jobId) await admin.from("job_postings").delete().eq("id", jobId);
  if (campaignIds.length) await admin.from("ad_campaigns").delete().in("id", campaignIds);
  if (orgId) await deleteOrgsCascade(admin, [orgId]);
  await deleteTestUsers([seeker.id, orgOwner.id]);
});

describe("the job postings SELECT policy's new branch", () => {
  it("hides the posting while there is no decision at all", async () => {
    const { data } = await anon.from("job_postings").select("id").eq("id", jobId).maybeSingle();
    expect(data, "an undecided posting from an unverified org must not be public").toBeNull();
  });

  it("hides the posting when the decision is 'rejected'", async () => {
    await admin.from("job_postings").update({ admin_review_decision: "rejected" }).eq("id", jobId);
    const { data } = await anon.from("job_postings").select("id").eq("id", jobId).maybeSingle();
    expect(data, "a rejected posting must not be public").toBeNull();
  });

  it("admits the posting once the decision is 'approved'", async () => {
    await admin.from("job_postings").update({ admin_review_decision: "approved" }).eq("id", jobId);
    const { data } = await anon.from("job_postings").select("id").eq("id", jobId).maybeSingle();
    expect(data?.id, "an approved Path 3 posting must be publicly readable").toBe(jobId);
  });
});

describe("search_job_postings (SECURITY INVOKER) inherits the branch with no code change", () => {
  it("returns the approved posting to a signed-in seeker", async () => {
    // Approved by the previous describe block's last test, which runs first
    // in file order — restated explicitly here so this test does not depend
    // on execution order silently.
    await admin.from("job_postings").update({ admin_review_decision: "approved" }).eq("id", jobId);

    const { data, error } = await seeker.client.rpc("search_job_postings", {
      p_query: "UniqueSlugP3",
      p_since: new Date(Date.now() - 86_400_000).toISOString(),
    });
    expect(error).toBeNull();
    expect(
      (data ?? []).some((r) => r.id === jobId),
      "search_job_postings did not surface the Path 3-approved posting",
    ).toBe(true);
  });
});

describe("promoted_jobs (SECURITY DEFINER) does NOT inherit the branch", () => {
  it("does not surface a Path 3-approved posting from an unverified org, even with a live campaign", async () => {
    await admin.from("job_postings").update({ admin_review_decision: "approved" }).eq("id", jobId);

    await admin.from("match_scores").insert({
      user_id: seeker.id,
      job_posting_id: jobId,
      score: 95,
      tier: "excellent",
    });

    const { data: campaign, error: campaignErr } = await admin
      .from("ad_campaigns")
      .insert({
        organization_id: orgId,
        job_posting_id: jobId,
        name: "PATH3-TEST Campaign",
        daily_rate_ngn: 1000,
        total_budget_ngn: 30000,
        status: "active",
        created_by: orgOwner.id,
      })
      .select("id")
      .single();
    expect(campaignErr, `fixture campaign: ${campaignErr?.message}`).toBeNull();
    if (campaign?.id) campaignIds.push(campaign.id);

    const { data: promoted, error: promotedErr } = await seeker.client.rpc("promoted_jobs", {});
    expect(promotedErr).toBeNull();
    expect(
      (promoted ?? []).some((r) => r.job_posting_id === jobId),
      "LEAK: promoted_jobs surfaced a Path 3-approved posting from an unverified organisation as a paid, endorsed slot",
    ).toBe(false);

    await admin.from("match_scores").delete().eq("user_id", seeker.id).eq("job_posting_id", jobId);
  });
});
