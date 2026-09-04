/**
 * getQuotaState's nextSubmissionCovered field — the Auto-Apply review
 * queue's own display of "what will my next confirm cost" must agree with
 * what confirmAutoApplyAction (and, ultimately, the auto_apply_claim_
 * submission RPC) will actually charge. Free-allowance behaviour itself is
 * covered by tests/auto-apply/enforcement.test.ts; this is only the display
 * flag's agreement with checkPassCoverage once the free allowance is spent —
 * the same class of bug Part A's other pass-coverage tests exist for, here
 * caught on a REVIEW QUEUE screen instead of a confirm click.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { deletePostingsCascade } from "../support/delete-orgs";
import { getQuotaState } from "@/lib/auto-apply/queue";
import { AUTO_APPLY_FREE_PER_WEEK } from "@/lib/auto-apply/config";

let userId: string;
let passId: string;
let fixtureOrgId: string;
const jobIds: string[] = [];

beforeAll(async () => {
  const user = await createTestUser("autoapplyquota");
  userId = user.id;

  const { data: pass, error } = await admin.from("passes").select("id").limit(1).single();
  if (error || !pass) throw new Error("No passes seeded — run `npm run seed`.");
  passId = pass.id;

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `AUTOAPPLYQUOTA-TEST Org ${randomUUID().slice(0, 8)}`, created_by: userId, verified: true })
    .select("id, name")
    .single();
  if (orgErr || !org) throw new Error(`fixture org: ${orgErr?.message}`);
  fixtureOrgId = org.id;

  // auto_apply_queue has a unique (user_id, job_posting_id) constraint — one
  // row per user per job — so exhausting a multi-submission free allowance
  // needs that many DISTINCT postings, not one reused across inserts.
  for (let i = 0; i < AUTO_APPLY_FREE_PER_WEEK; i++) {
    const { data: job, error: jobErr } = await admin
      .from("job_postings")
      .insert({
        source_type: "internal",
        organization_id: fixtureOrgId,
        company_name: org.name,
        title: `AUTOAPPLYQUOTA-TEST Role ${i}`,
        description: "Fixture posting.",
        status: "open",
        dedup_fingerprint: `autoapplyquota-${randomUUID()}`,
      })
      .select("id")
      .single();
    if (jobErr || !job) throw new Error(`fixture posting: ${jobErr?.message}`);
    jobIds.push(job.id);
  }
}, 60_000);

afterAll(async () => {
  await admin.from("auto_apply_queue").delete().eq("user_id", userId);
  if (jobIds.length) await deletePostingsCascade(admin, jobIds);
  if (fixtureOrgId) await admin.from("organizations").delete().eq("id", fixtureOrgId);
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

beforeEach(async () => {
  await admin.from("auto_apply_queue").delete().eq("user_id", userId);
  await admin.from("user_passes").delete().eq("user_id", userId);
});

/**
 * Backdated, same technique as tests/auto-apply/pass-coverage.test.ts and
 * for the same reason: lands inside the 7-day free-allowance window this
 * test needs to exhaust, without also tripping the 24h daily cap that would
 * otherwise mask what's actually being tested.
 */
async function exhaustFreeAllowance() {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  for (const jobId of jobIds) {
    const { error } = await admin.from("auto_apply_queue").insert({
      user_id: userId,
      job_posting_id: jobId,
      match_score: 90,
      tier: "excellent",
      source_type: "internal",
      status: "submitted",
      decided_at: twoDaysAgo,
      credits_spent: 0,
    });
    if (error) throw new Error(`backdated allowance fixture: ${error.message}`);
  }
}

async function insertActivePass(): Promise<void> {
  const { error } = await admin.from("user_passes").insert({
    user_id: userId,
    pass_id: passId,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    payment_method: "card",
    status: "active",
  });
  if (error) throw new Error(`fixture pass: ${error.message}`);
}

describe("getQuotaState.nextSubmissionCovered", () => {
  it("false when still under the free weekly allowance — nothing to cover yet", async () => {
    const quota = await getQuotaState(userId);
    expect(quota.nextSubmissionCostsCredits).toBe(false);
    expect(quota.nextSubmissionCovered).toBe(false);
  });

  it("false once the free allowance is used and there is no active pass — the unaffected baseline", async () => {
    await exhaustFreeAllowance();
    const quota = await getQuotaState(userId);
    expect(quota.nextSubmissionCostsCredits).toBe(true);
    expect(
      quota.nextSubmissionCovered,
      "no pass exists — this must not read as covered",
    ).toBe(false);
  });

  it(
    "true once the free allowance is used AND an active pass exists " +
      "— the review queue must not show a credit price for a submission that will actually be free",
    async () => {
      await exhaustFreeAllowance();
      await insertActivePass();
      const quota = await getQuotaState(userId);
      expect(quota.nextSubmissionCostsCredits).toBe(true);
      expect(quota.nextSubmissionCovered).toBe(true);
    },
  );
});
