/**
 * Auto-Apply submissions beyond the free weekly allowance are pass-covered
 * (Part A) — tested by driving `auto_apply_claim_submission` (0034/0088)
 * directly, the same way tests/auto-apply/enforcement.test.ts drives every
 * other decision this RPC makes, since the free-vs-charge decision lives
 * entirely inside its single locked transaction (see 0088's own header for
 * why bolting pass-coverage on around the RPC in TS would reopen the
 * double-submission race 0034 exists to close).
 *
 * Free-allowance behaviour itself (5 submissions/week free regardless of a
 * pass) is unchanged and already covered by enforcement.test.ts — these
 * tests start from an allowance already exhausted, which is the only state
 * where pass-coverage has anything to decide.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { deletePostingsCascade } from "../support/delete-orgs";
import {
  AUTO_APPLY_DAILY_SUBMIT_CAP,
  AUTO_APPLY_FREE_PER_WEEK,
  AUTO_APPLY_MIN_SCORE,
} from "@/lib/auto-apply/config";
import { CREDIT_COSTS } from "@/lib/credits/costs";

let userId: string;
let fixtureOrgId: string;
const jobIds: string[] = [];

beforeAll(async () => {
  const user = await createTestUser("autoapplypass");
  userId = user.id;

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `AUTOAPPLYPASS-TEST Org ${randomUUID().slice(0, 8)}`, created_by: userId, verified: true })
    .select("id, name")
    .single();
  if (orgErr || !org) throw new Error(`fixture org: ${orgErr?.message}`);
  fixtureOrgId = org.id;

  // AUTO_APPLY_FREE_PER_WEEK + 1 internal postings — enough to exhaust the
  // free weekly allowance with real distinct submissions, plus one more to
  // actually test coverage on.
  for (let i = 0; i < AUTO_APPLY_FREE_PER_WEEK + 1; i++) {
    const { data: job, error: jobErr } = await admin
      .from("job_postings")
      .insert({
        source_type: "internal",
        organization_id: fixtureOrgId,
        company_name: org.name,
        title: `AUTOAPPLYPASS-TEST Role ${i}`,
        description: "Fixture posting.",
        status: "open",
        dedup_fingerprint: `autoapplypass-${randomUUID()}`,
      })
      .select("id")
      .single();
    if (jobErr || !job) throw new Error(`fixture posting: ${jobErr?.message}`);
    jobIds.push(job.id);
  }
}, 60_000);

afterAll(async () => {
  await admin.from("auto_apply_queue").delete().eq("user_id", userId);
  await admin.from("applications").delete().eq("user_id", userId);
  await admin.from("match_scores").delete().eq("user_id", userId);
  if (jobIds.length) await deletePostingsCascade(admin, jobIds);
  if (fixtureOrgId) await admin.from("organizations").delete().eq("id", fixtureOrgId);
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

async function seedQueued(jobId: string): Promise<string> {
  await admin
    .from("match_scores")
    .upsert(
      { user_id: userId, job_posting_id: jobId, score: 90, tier: "excellent" },
      { onConflict: "user_id,job_posting_id" },
    );
  const { data, error } = await admin
    .from("auto_apply_queue")
    .upsert(
      {
        user_id: userId,
        job_posting_id: jobId,
        match_score: 90,
        tier: "excellent",
        source_type: "internal",
        status: "pending",
        decided_at: null,
        credits_spent: 0,
        application_id: null,
      },
      { onConflict: "user_id,job_posting_id" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture queue row: ${error?.message}`);
  return data.id;
}

async function claim(queueId: string, hasActivePass: boolean) {
  const { data, error } = await admin.rpc("auto_apply_claim_submission", {
    p_user_id: userId,
    p_queue_id: queueId,
    p_min_score: AUTO_APPLY_MIN_SCORE,
    p_daily_cap: AUTO_APPLY_DAILY_SUBMIT_CAP,
    p_free_per_week: AUTO_APPLY_FREE_PER_WEEK,
    p_credit_cost: CREDIT_COSTS.autoApplySubmission,
    p_has_active_pass: hasActivePass,
  });
  if (error) throw error;
  return data![0];
}

beforeEach(async () => {
  await admin.from("auto_apply_queue").delete().eq("user_id", userId);
  await admin.from("match_scores").delete().eq("user_id", userId);
  await admin.from("profiles").update({ credits_balance: 0 }).eq("id", userId);
});

/**
 * Puts AUTO_APPLY_FREE_PER_WEEK submissions on the books, backdated to 2
 * days ago — inside the 7-day free-allowance window this test needs to
 * exhaust, but OUTSIDE the rolling 24h window the DAILY cap also counts.
 * AUTO_APPLY_DAILY_SUBMIT_CAP and AUTO_APPLY_FREE_PER_WEEK are both 5
 * (config.ts) and the RPC checks the daily cap FIRST — five submissions
 * made live, right now, would trip the daily cap before the free-allowance
 * logic this test is actually about ever runs. Inserted directly rather
 * than claimed through the RPC for the same reason: the RPC always stamps
 * decided_at = now().
 */
async function exhaustFreeAllowance() {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  for (let i = 0; i < AUTO_APPLY_FREE_PER_WEEK; i++) {
    await admin
      .from("match_scores")
      .upsert(
        { user_id: userId, job_posting_id: jobIds[i], score: 90, tier: "excellent" },
        { onConflict: "user_id,job_posting_id" },
      );
    const { error } = await admin.from("auto_apply_queue").upsert(
      {
        user_id: userId,
        job_posting_id: jobIds[i],
        match_score: 90,
        tier: "excellent",
        source_type: "internal",
        status: "submitted",
        decided_at: twoDaysAgo,
        credits_spent: 0,
      },
      { onConflict: "user_id,job_posting_id" },
    );
    if (error) throw new Error(`backdated allowance fixture: ${error.message}`);
  }
}

describe("beyond the free weekly allowance", () => {
  it("without an active pass: charges normally and fails on insufficient credits (unaffected baseline)", async () => {
    await exhaustFreeAllowance();
    const queueId = await seedQueued(jobIds[AUTO_APPLY_FREE_PER_WEEK]);
    const verdict = await claim(queueId, false);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("insufficient_credits");
    expect(verdict.charge).toBe(CREDIT_COSTS.autoApplySubmission);
    expect(verdict.pass_covered).toBe(false);
  });

  it("with an active pass: submits at zero charge, flagged pass_covered", async () => {
    await exhaustFreeAllowance();
    const queueId = await seedQueued(jobIds[AUTO_APPLY_FREE_PER_WEEK]);
    const verdict = await claim(queueId, true);
    expect(verdict.ok, "MONEY BUG: pass-covered submission was refused").toBe(true);
    expect(verdict.reason).toBe("submitted");
    expect(verdict.charge, "MONEY BUG: a pass-covered submission still charged credits").toBe(0);
    expect(verdict.pass_covered).toBe(true);

    const { data: queueRow } = await admin
      .from("auto_apply_queue")
      .select("status, credits_spent")
      .eq("id", queueId)
      .single();
    expect(queueRow?.status).toBe("submitted");
    expect(queueRow?.credits_spent).toBe(0);
  });

  it("p_has_active_pass has no effect UNDER the free allowance — still free, still not flagged pass_covered", async () => {
    // The free allowance and pass-coverage are two different reasons a
    // submission can be free; conflating them in the funnel would make
    // "how many people are actually using their pass for Auto-Apply"
    // unanswerable.
    const queueId = await seedQueued(jobIds[0]);
    const verdict = await claim(queueId, true);
    expect(verdict.ok).toBe(true);
    expect(verdict.charge).toBe(0);
    expect(
      verdict.pass_covered,
      "a free-allowance submission must not be counted as pass-covered",
    ).toBe(false);
  });
});
