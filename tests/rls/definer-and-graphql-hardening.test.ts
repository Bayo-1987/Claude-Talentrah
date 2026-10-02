/**
 * send-514 — migration 0211: definer and GraphQL hardening (the Supabase security advisor's findings, read-only report of 2 Oct, decided by the owner).
 *
 *   1. Six trigger-only SECURITY DEFINER functions lose EXECUTE for public, anon and authenticated. A trigger function cannot be called as an RPC
 *      anyway (Postgres says "trigger functions can only be called as triggers"), and a trigger does not need the CALLER'S execute privilege to fire, so
 *      the revoke removes exposure without removing behaviour. Both halves are proved here: a direct call is now refused with 42501 (permission denied),
 *      and each trigger still fires when the action that triggers it is performed.
 *   2. referral_leaderboard loses anon's EXECUTE (0130 meant authenticated only; anon kept Supabase's default grant). Signed-in users still get the board.
 *   3. pg_graphql is dropped. The app never calls /graphql/v1 (the earlier investigation, docs/pg-graphql-investigation.md, found no caller by four
 *      independent methods). /graphql/v1 stops answering.
 *
 * Runs against CI's fresh per-job Supabase stack, which applies every migration from scratch, so 0211 is there by construction.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`definer-and-graphql-hardening test cannot run: ${key} is not set.`);
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const TRIGGER_FUNCTIONS = [
  "enforce_ad_campaign_transition",
  "enforce_application_stage_transition",
  "ensure_email_preferences",
  "invalidate_match_scores_on_jd_change",
  "match_scores_prune_on_posting_closed",
  "stamp_employer_applicant_status",
] as const;

const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

type Authed = Awaited<ReturnType<typeof createAuthedTestUser>>;
let seeker: Authed;
let owner: Authed;
let orgId = "";
let jobId = "";
let resumeId = "";
let applicationId = "";
const stamp = randomUUID().slice(0, 8);

async function must<T>(label: string, p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error || data === null || data === undefined) throw new Error(`fixture ${label}: ${error?.message ?? "no row"}`);
  return data as NonNullable<T>;
}

async function seedScore() {
  const { error } = await admin.from("match_scores").upsert({
    user_id: seeker.id,
    job_posting_id: jobId,
    score: 88,
    tier: "excellent",
    explanation: { matchedSkills: ["sql"], missingSkills: [], seniorityAlignment: "match" },
    computed_at: new Date().toISOString(),
  });
  if (error) throw new Error(`seed score: ${error.message}`);
}
async function scoreCount() {
  const { count, error } = await admin.from("match_scores").select("job_posting_id", { count: "exact", head: true }).eq("job_posting_id", jobId).eq("user_id", seeker.id);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

beforeAll(async () => {
  seeker = await createAuthedTestUser("defhard-seeker");
  owner = await createAuthedTestUser("defhard-owner");
  const org = await must("org", admin.from("organizations").insert({ name: `DEFHARD-TEST Org ${stamp}`, created_by: owner.id, verified: true }).select("id").single());
  orgId = org.id;
  const mem = await admin.from("organization_members").insert({ organization_id: orgId, user_id: owner.id, role: "owner" });
  if (mem.error) throw new Error(`fixture membership: ${mem.error.message}`);
  const job = await must(
    "job",
    admin
      .from("job_postings")
      .insert({ source_type: "internal", organization_id: orgId, company_name: "DEFHARD-TEST Co", title: `DEFHARD-TEST Role ${stamp}`, description: "Fixture for the definer-and-graphql-hardening suite.", structured_jd: { skills: ["sql"] }, seniority: "mid", status: "open", posted_at: new Date().toISOString(), dedup_fingerprint: randomUUID() })
      .select("id")
      .single(),
  );
  jobId = job.id;
  const resume = await must("resume", admin.from("resumes").insert({ user_id: seeker.id, structured_content: { contact: { name: "Defhard Seeker" }, summary: "Fixture.", experience: [], education: [], skills: ["sql"] } }).select("id").single());
  resumeId = resume.id;
  const app = await must("application", admin.from("applications").insert({ user_id: seeker.id, job_posting_id: jobId, resume_id: resumeId, stage: "hired", source: "internal_apply", applied_at: new Date().toISOString() }).select("id").single());
  applicationId = app.id;
}, 120_000);

afterAll(async () => {
  const check = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    if (error) throw new Error(`cleanup failed: ${error.message}`);
  };
  if (applicationId) {
    await check(admin.from("employer_applicant_status").delete().eq("application_id", applicationId));
    await check(admin.from("applications").delete().eq("id", applicationId));
  }
  if (jobId) await check(admin.from("match_scores").delete().eq("job_posting_id", jobId));
  if (resumeId) await check(admin.from("resumes").delete().eq("id", resumeId));
  if (orgId) await deleteOrgsCascade(admin, [orgId]);
  await deleteTestUsers([seeker?.id, owner?.id].filter(Boolean) as string[]);
}, 120_000);

describe("the six trigger-only functions cannot be called directly", () => {
  it.each(TRIGGER_FUNCTIONS)("%s: anon is refused with 'permission denied' (42501)", async (fn) => {
    const { error } = await anon.rpc(fn as never);
    expect(error, "must be an error").not.toBeNull();
    expect(error!.code).toBe("42501");
  });

  it.each(TRIGGER_FUNCTIONS)("%s: a signed-in user is refused with 'permission denied' (42501)", async (fn) => {
    const { error } = await (owner.client as unknown as SupabaseClient).rpc(fn as never);
    expect(error, "must be an error").not.toBeNull();
    expect(error!.code).toBe("42501");
  });
});

describe("every one of the six triggers still fires, for the caller that performs the action", () => {
  it("applications_enforce_stage_transition: a seeker cannot move a hired application back (check_violation), but may archive it", async () => {
    const back = await seeker.client.from("applications").update({ stage: "interviewing" }).eq("id", applicationId).select("stage");
    expect(back.error?.code).toBe("23514");
    const archive = await seeker.client.from("applications").update({ stage: "archived" }).eq("id", applicationId).select("stage");
    expect(archive.error).toBeNull();
    expect(archive.data).toEqual([{ stage: "archived" }]);
  });

  it("match_scores_invalidate_on_jd_change: an employer changing the posting's seniority discards its cached scores", async () => {
    await seedScore();
    expect(await scoreCount()).toBe(1);
    const res = await owner.client.from("job_postings").update({ seniority: "senior" }).eq("id", jobId).select("seniority");
    expect(res.error).toBeNull();
    expect(res.data).toEqual([{ seniority: "senior" }]);
    expect(await scoreCount()).toBe(0);
  });

  it("match_scores_prune_on_posting_closed: an employer closing the posting discards its cached scores, and ONLY a close does", async () => {
    await seedScore();
    const unrelated = await owner.client.from("job_postings").update({ title: `DEFHARD-TEST Role ${stamp} renamed` }).eq("id", jobId).select("title");
    expect(unrelated.error).toBeNull();
    expect(await scoreCount(), "a rename must not prune").toBe(1);
    const close = await owner.client.from("job_postings").update({ status: "closed" }).eq("id", jobId).select("status");
    expect(close.error).toBeNull();
    expect(await scoreCount()).toBe(0);
  });

  it("employer_applicant_status_stamp: viewing a resume as an org member stamps updated_by with the caller", async () => {
    const res = await owner.client.rpc("record_employer_resume_view", { p_application_id: applicationId });
    expect(res.error).toBeNull();
    const { data } = await admin.from("employer_applicant_status").select("updated_by, updated_at").eq("application_id", applicationId).single();
    expect(data!.updated_by).toBe(owner.id);
    expect(data!.updated_at).toBeTruthy();
  });

  it("profiles_ensure_email_preferences: a new account gets its email_preferences row", async () => {
    const { data } = await admin.from("email_preferences").select("user_id").eq("user_id", seeker.id);
    expect(data).toEqual([{ user_id: seeker.id }]);
  });

  it("enforce_ad_campaign_transition: the service role may move a campaign's status, a signed-in owner may not", async () => {
    const campaign = await must(
      "campaign",
      admin.from("ad_campaigns").insert({ organization_id: orgId, job_posting_id: jobId, name: `Defhard ${stamp}`, daily_rate_ngn: 1000, total_budget_ngn: 30_000, created_by: owner.id, status: "draft" }).select("id").single(),
    );
    const viaService = await admin.from("ad_campaigns").update({ status: "pending_review" }).eq("id", campaign.id).select("status");
    expect(viaService.error).toBeNull();
    expect(viaService.data).toEqual([{ status: "pending_review" }]);
    const viaOwner = await owner.client.from("ad_campaigns").update({ status: "active" }).eq("id", campaign.id).select("status");
    expect(viaOwner.error, "an owner must not be able to set a campaign's status").not.toBeNull();
    const { data: after } = await admin.from("ad_campaigns").select("status").eq("id", campaign.id).single();
    expect(after!.status).toBe("pending_review");
    await admin.from("ad_campaigns").delete().eq("id", campaign.id);
  });
});

describe("referral_leaderboard", () => {
  const period = { p_period_start: new Date(Date.now() - 30 * 86_400_000).toISOString(), p_period_end: new Date(Date.now() + 86_400_000).toISOString(), p_limit: 5 };

  it("anon is refused (permission denied)", async () => {
    const { error } = await anon.rpc("referral_leaderboard", period);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
  });

  it("a signed-in user still gets the board", async () => {
    const { data, error } = await seeker.client.rpc("referral_leaderboard", period);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});

describe("pg_graphql is gone", () => {
  it("/graphql/v1 no longer answers a query", async () => {
    const res = await fetch(`${URL}/graphql/v1`, { method: "POST", headers: { "content-type": "application/json", apikey: ANON, authorization: `Bearer ${ANON}` }, body: JSON.stringify({ query: "{ __typename }" }) });
    expect(res.status, "an answered query is 200; a dropped extension is an error").toBeGreaterThanOrEqual(400);
  });

  it("the REST API is unaffected (a signed-out read of a public table still works)", async () => {
    const { error } = await anon.from("credit_packs").select("id").limit(1);
    expect(error).toBeNull();
  });
});
