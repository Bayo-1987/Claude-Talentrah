/**
 * Employer job import, PR 2, the FIRST red test: an IMPORTED posting reaches Auto-Apply as a hand-off, never as an in-app submission.
 *
 * An imported posting is an `internal` row of the employer's verified organisation (so the 0027 gate applies by itself) that carries import_feed_id; the application happens on the employer's OWN site.
 * auto_apply_claim_submission decides "hand off or submit" from the QUEUE ROW's source_type, which scanAndQueue copies from job_postings.source_type when it queues. Copied as-is, an imported job
 * is queued as 'internal', the claim SUBMITS an application inside Talentrah and spends the allowance or credits, and the seeker believes they applied while the employer receives nothing.
 * So scanAndQueue must queue it as the apply mode it really has: 'external' (link-out).
 *
 * Real database: the scan, the queue and the locked claim all run for real. The control is an ordinary internal posting of the same organisation: it stays 'internal'.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { scanAndQueue } from "@/lib/auto-apply/queue";
import { AUTO_APPLY_DAILY_SUBMIT_CAP, AUTO_APPLY_FREE_PER_WEEK, AUTO_APPLY_MIN_SCORE } from "@/lib/auto-apply/config";
import { deleteOrgsCascade } from "../support/delete-orgs";
import { deleteTestUsers } from "../support/auth";

const admin: SupabaseClient<Database> = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
const tag = randomUUID().slice(0, 6);

let userId = "";
let orgId = "";
let feedId = "";
let importedJobId = "";
let ownJobId = "";

const posting = (title: string, extra: Record<string, unknown> = {}) => ({
  source_type: "internal" as const, organization_id: orgId, company_name: "Handoff Co", title: `${title} ${tag}`, description: "Fixture posting for the imported-job hand-off test.", structured_jd: {},
  status: "open" as const, posted_at: new Date().toISOString(), dedup_fingerprint: randomUUID(), ...extra,
});

beforeAll(async () => {
  const { data: created, error } = await admin.auth.admin.createUser({ email: `import-handoff-${randomUUID()}@talentrah.test`, email_confirm: true });
  if (error || !created.user) throw new Error(`fixture user: ${error?.message}`);
  userId = created.user.id;
  await admin.from("auto_apply_settings").upsert({ user_id: userId, enabled: true, enabled_at: new Date().toISOString() });
  const { data: org } = await admin.from("organizations").insert({ name: `HANDOFF-TEST Org ${tag}`, created_by: userId, verified: true }).select("id").single();
  orgId = org!.id;
  const host = `handoff-${tag}.example.test`;
  const { data: feed, error: feedErr } = await (admin as unknown as SupabaseClient)
    .from("employer_job_feeds")
    .insert({ organization_id: orgId, url: `https://${host}/careers`, host, site_proof_code: `h${"A".repeat(42)}`, consent_text_version: 1, consented_by: userId, consented_at: new Date().toISOString(), consent_host: host })
    .select("id")
    .single();
  if (feedErr || !feed) throw new Error(`fixture feed: ${feedErr?.message}`);
  feedId = feed.id;
  const imported = await (admin as unknown as SupabaseClient).from("job_postings").insert(posting("Imported role", { import_feed_id: feedId, import_key: `key-${tag}`, external_url: `https://${host}/careers/1` })).select("id").single();
  if (imported.error) throw new Error(`fixture imported posting: ${imported.error.message}`);
  importedJobId = imported.data.id;
  const own = await admin.from("job_postings").insert(posting("Own role")).select("id").single();
  if (own.error || !own.data) throw new Error(`fixture own posting: ${own.error?.message}`);
  ownJobId = own.data.id;
  const rich = { matchedSkills: ["s1", "s2", "s3"], missingSkills: [], seniorityAlignment: "unknown" as const };
  const { error: scoreErr } = await admin.from("match_scores").upsert(
    [importedJobId, ownJobId].map((id) => ({ user_id: userId, job_posting_id: id, score: AUTO_APPLY_MIN_SCORE, tier: "excellent", explanation: rich })),
    { onConflict: "user_id,job_posting_id" },
  );
  if (scoreErr) throw new Error(`fixture scores: ${scoreErr.message}`);
}, 120_000);

afterAll(async () => {
  await admin.from("auto_apply_queue").delete().eq("user_id", userId);
  await admin.from("match_scores").delete().eq("user_id", userId);
  await admin.from("auto_apply_settings").delete().eq("user_id", userId);
  await admin.from("job_postings").delete().eq("organization_id", orgId);
  await (admin as unknown as SupabaseClient).from("employer_job_feeds").delete().eq("organization_id", orgId);
  await deleteOrgsCascade(admin as never, [orgId]);
  await deleteTestUsers([userId]);
}, 120_000);

describe("an imported posting in Auto-Apply", () => {
  it("is queued as a LINK-OUT (external), and the ordinary internal posting of the same organisation stays internal", async () => {
    await scanAndQueue(userId);
    const { data: rows } = await admin.from("auto_apply_queue").select("job_posting_id, source_type, status").eq("user_id", userId);
    const byJob = new Map((rows ?? []).map((r) => [r.job_posting_id, r]));
    expect(byJob.get(importedJobId)?.source_type, "MONEY/TRUST BUG: an imported job was queued as an in-app application").toBe("external");
    expect(byJob.get(ownJobId)?.source_type).toBe("internal");
  });

  it("confirming it HANDS OFF to the employer's page: no submission, no charge, no allowance used", async () => {
    const { data: queued } = await admin.from("auto_apply_queue").select("id").eq("user_id", userId).eq("job_posting_id", importedJobId).single();
    const { data: verdicts, error } = await admin.rpc("auto_apply_claim_submission", {
      p_user_id: userId, p_queue_id: queued!.id, p_min_score: AUTO_APPLY_MIN_SCORE, p_daily_cap: AUTO_APPLY_DAILY_SUBMIT_CAP, p_free_per_week: AUTO_APPLY_FREE_PER_WEEK, p_credit_cost: 3, p_has_active_pass: false,
    });
    expect(error, error?.message).toBeNull();
    expect(verdicts![0].reason).toBe("handed_off");
    expect(verdicts![0].charge).toBe(0);
    const { data: after } = await admin.from("auto_apply_queue").select("status, credits_spent").eq("id", queued!.id).single();
    expect(after!.status).toBe("handed_off");
    expect(after!.credits_spent ?? 0).toBe(0);
  });

  it("the queue and the claim never produced an 'applied' application for the imported job", async () => {
    const { data } = await admin.from("applications").select("stage").eq("user_id", userId).eq("job_posting_id", importedJobId);
    expect((data ?? []).filter((a) => a.stage === "applied")).toEqual([]);
  });
});
