/**
 * `scanAndQueue` against a real database — proving it actually calls
 * `filterQueueableJobs` correctly, not just that the pure function is
 * correct in isolation (that's `tests/auto-apply/filter-queueable-jobs.test.ts`).
 *
 * Matches this feature's own standing convention (`tests/auto-apply/
 * enforcement.test.ts`): Auto-Apply creates real applications and spends
 * real credits, so its gates are tested against the live database, not
 * mocked.
 *
 * ── THE SCENARIO ───────────────────────────────────────────────────────────
 *
 * An organisation verifies, a posting scores Excellent for a seeker
 * (`match_scores` row written), then the organisation un-verifies —
 * `saveCompanyProfileAction` re-runs verification in both directions on a
 * domain change (src/lib/employer/actions.ts). The `match_scores` row does
 * not expire when that happens. Before this fix, `scanAndQueue` trusted the
 * row's mere existence and queued the posting anyway.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { deleteTestOrgs } from "../support/cleanup";
import { scanAndQueue } from "@/lib/auto-apply/queue";
import { AUTO_APPLY_MIN_SCORE } from "@/lib/auto-apply/config";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
type DB = SupabaseClient<Database>;

const admin: DB = createClient<Database>(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let userId: string;
let verifiedOrgId: string;
let unverifiedOrgId: string;
let verifiedJobId: string;
let staleJobId: string; // scored while the org was verified, then org un-verified

beforeAll(async () => {
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email: `autoapply-verify-gate-${randomUUID()}@talentrah.test`,
    email_confirm: true,
  });
  if (userErr || !created.user) throw new Error(`fixture user: ${userErr?.message}`);
  userId = created.user.id;

  await admin.from("auto_apply_settings").upsert({ user_id: userId, enabled: true, enabled_at: new Date().toISOString() });

  const { data: verifiedOrg, error: verifiedOrgErr } = await admin
    .from("organizations")
    .insert({ name: `AUTOAPPLY-TEST Verified Org ${randomUUID().slice(0, 8)}`, created_by: userId, verified: true })
    .select("id")
    .single();
  if (verifiedOrgErr || !verifiedOrg) throw new Error(`fixture org: ${verifiedOrgErr?.message}`);
  verifiedOrgId = verifiedOrg.id;

  // Created verified, then flipped false — reproducing saveCompanyProfileAction
  // re-running verification in both directions on a domain change, not just
  // "an org that was never verified".
  const { data: unverifiedOrg, error: unverifiedOrgErr } = await admin
    .from("organizations")
    .insert({ name: `AUTOAPPLY-TEST Unverified Org ${randomUUID().slice(0, 8)}`, created_by: userId, verified: true })
    .select("id")
    .single();
  if (unverifiedOrgErr || !unverifiedOrg) throw new Error(`fixture org: ${unverifiedOrgErr?.message}`);
  unverifiedOrgId = unverifiedOrg.id;

  const { data: verifiedJob, error: verifiedJobErr } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: verifiedOrgId,
      company_name: "AUTOAPPLY-TEST Verified Co",
      title: `AUTOAPPLY-TEST Verified Role ${randomUUID().slice(0, 8)}`,
      description: "Fixture posting, verified org, tests/auto-apply.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: `autoapply-verify-gate-verified-${randomUUID()}`,
    })
    .select("id")
    .single();
  if (verifiedJobErr || !verifiedJob) throw new Error(`fixture posting: ${verifiedJobErr?.message}`);
  verifiedJobId = verifiedJob.id;

  const { data: staleJob, error: staleJobErr } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: unverifiedOrgId,
      company_name: "AUTOAPPLY-TEST Stale Co",
      title: `AUTOAPPLY-TEST Stale Role ${randomUUID().slice(0, 8)}`,
      description: "Fixture posting, org un-verifies after scoring, tests/auto-apply.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: `autoapply-verify-gate-stale-${randomUUID()}`,
    })
    .select("id")
    .single();
  if (staleJobErr || !staleJob) throw new Error(`fixture posting: ${staleJobErr?.message}`);
  staleJobId = staleJob.id;

  // The score is written WHILE the org is still verified — exactly the
  // sequence that produces the bug (score first, un-verify after).
  const { error: scoreErr } = await admin.from("match_scores").upsert(
    [
      { user_id: userId, job_posting_id: verifiedJobId, score: AUTO_APPLY_MIN_SCORE, tier: "excellent" },
      { user_id: userId, job_posting_id: staleJobId, score: AUTO_APPLY_MIN_SCORE, tier: "excellent" },
    ],
    { onConflict: "user_id,job_posting_id" },
  );
  if (scoreErr) throw new Error(`fixture scores: ${scoreErr.message}`);

  // NOW un-verify the second org — after its posting already has a score,
  // matching saveCompanyProfileAction's own re-verify-on-domain-change timing.
  const { error: unverifyErr } = await admin
    .from("organizations")
    .update({ verified: false })
    .eq("id", unverifiedOrgId);
  if (unverifyErr) throw new Error(`fixture un-verify: ${unverifyErr.message}`);
});

beforeEach(async () => {
  await admin.from("auto_apply_queue").delete().eq("user_id", userId);
});

afterAll(async () => {
  await admin.from("auto_apply_queue").delete().eq("user_id", userId);
  await admin.from("match_scores").delete().eq("user_id", userId);
  if (verifiedOrgId) await deleteTestOrgs([verifiedOrgId]);
  if (unverifiedOrgId) await deleteTestOrgs([unverifiedOrgId]);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("SABOTAGE-PROOF TARGET: scanAndQueue never queues a posting whose organisation has since un-verified", () => {
  it("queues the posting from the currently-verified org", async () => {
    const result = await scanAndQueue(userId);
    expect(result.reason).toBeUndefined();

    const { data: queued } = await admin
      .from("auto_apply_queue")
      .select("job_posting_id")
      .eq("user_id", userId);
    expect((queued ?? []).map((q) => q.job_posting_id)).toContain(verifiedJobId);
  });

  it("does NOT queue the posting whose organisation un-verified after it was scored", async () => {
    await scanAndQueue(userId);

    const { data: queued } = await admin
      .from("auto_apply_queue")
      .select("job_posting_id")
      .eq("user_id", userId);
    const queuedIds = (queued ?? []).map((q) => q.job_posting_id);

    expect(queuedIds).not.toContain(staleJobId);
    // The positive case still holds in the same scan — this isn't queuing
    // nothing at all, it's excluding exactly the stale one.
    expect(queuedIds).toContain(verifiedJobId);
  });
});
