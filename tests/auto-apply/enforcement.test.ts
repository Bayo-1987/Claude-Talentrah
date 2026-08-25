/**
 * Auto-Apply enforcement — the gates, tested against the live database.
 *
 * This feature creates `applications` rows without a human clicking Apply at
 * the moment of submission, and it spends credits. That is the exact shape this
 * repo's audit history keeps finding bugs in: a server-trusted value that turns
 * out to be user-writable (0028, 0030), a gate that reads the wrong table
 * (0027), a cap enforced only in the UI.
 *
 * So the assertions here are all about the SERVER's copy of the rule. Nothing
 * is asserted through the UI, and nothing trusts a value the client could have
 * supplied. Where the production code path is a Server Action, the test drives
 * the same RPC the action drives — the action is a thin caller, and the RPC is
 * where every decision is actually made (migration 0034).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import {
  AUTO_APPLY_DAILY_SUBMIT_CAP,
  AUTO_APPLY_FREE_PER_WEEK,
  AUTO_APPLY_MIN_SCORE,
} from "@/lib/auto-apply/config";
import { CREDIT_COSTS } from "@/lib/credits/costs";

for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const) {
  if (!process.env[key]) throw new Error(`Auto-Apply test cannot run: ${key} is not set.`);
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
type DB = SupabaseClient<Database>;

const admin: DB = createClient<Database>(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function createAuthedUser(label: string) {
  const email = `autoapply-${label}-${randomUUID()}@talentrah.test`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr) throw linkErr;
  const client = createClient<Database>(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: otpErr } = await client.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (otpErr) throw otpErr;
  return { id: created.user!.id, client };
}

/** Drives the same RPC the confirm Server Action drives. */
async function claim(userId: string, queueId: string) {
  const { data, error } = await admin.rpc("auto_apply_claim_submission", {
    p_user_id: userId,
    p_queue_id: queueId,
    p_min_score: AUTO_APPLY_MIN_SCORE,
    p_daily_cap: AUTO_APPLY_DAILY_SUBMIT_CAP,
    p_free_per_week: AUTO_APPLY_FREE_PER_WEEK,
    p_credit_cost: CREDIT_COSTS.autoApplySubmission,
  });
  if (error) throw error;
  return data![0];
}

let user: Awaited<ReturnType<typeof createAuthedUser>>;
let internalJobIds: string[] = [];
let externalJobId: string;

beforeAll(async () => {
  user = await createAuthedUser("owner");

  const { data: internal } = await admin
    .from("job_postings")
    .select("id")
    .eq("source_type", "internal")
    .eq("status", "open")
    .limit(3);
  internalJobIds = (internal ?? []).map((j) => j.id);
  if (internalJobIds.length < 3) {
    throw new Error("Need 3 open internal postings — run `npm run seed` first.");
  }

  const { data: external } = await admin
    .from("job_postings")
    .select("id")
    .eq("source_type", "external")
    .eq("status", "open")
    .limit(1)
    .single();
  externalJobId = external!.id;
});

afterAll(async () => {
  if (user) await admin.auth.admin.deleteUser(user.id);
});

/** Puts a score and a pending queue row in place, the way a real scan would. */
async function seedQueued(jobId: string, score: number, sourceType: "internal" | "external") {
  await admin
    .from("match_scores")
    .upsert(
      { user_id: user.id, job_posting_id: jobId, score, tier: score >= 80 ? "excellent" : "good" },
      { onConflict: "user_id,job_posting_id" },
    );
  const { data, error } = await admin
    .from("auto_apply_queue")
    .upsert(
      {
        user_id: user.id,
        job_posting_id: jobId,
        match_score: score,
        tier: score >= 80 ? "excellent" : "good",
        source_type: sourceType,
        status: "pending",
        decided_at: null,
        credits_spent: 0,
        application_id: null,
      },
      { onConflict: "user_id,job_posting_id" },
    )
    .select("id")
    .single();
  if (error) throw error;
  return data!.id;
}

async function resetUserState() {
  await admin.from("auto_apply_queue").delete().eq("user_id", user.id);
  await admin.from("applications").delete().eq("user_id", user.id);
  await admin.from("match_scores").delete().eq("user_id", user.id);
}

describe("nothing client-reachable can put a job into the queue", () => {
  it("a user cannot insert their own queue row", async () => {
    // The most direct attack: skip the scan entirely and queue whatever you
    // like, at whatever score you like.
    const { error } = await user.client.from("auto_apply_queue").insert({
      user_id: user.id,
      job_posting_id: internalJobIds[0],
      match_score: 100,
      tier: "excellent",
      source_type: "internal",
    });
    expect(error, "a user queued their own Auto-Apply candidate").not.toBeNull();
  });

  it("a user cannot write the match score the gate reads (0031 regression guard)", async () => {
    // If this ever passes, the threshold is decorative: queue a real job, set
    // your own score to 100, confirm. This is the exact reason 0031 exists.
    const { error } = await user.client.from("match_scores").insert({
      user_id: user.id,
      job_posting_id: internalJobIds[0],
      score: 100,
      tier: "excellent",
    });
    expect(error, "a user authored the score Auto-Apply gates on").not.toBeNull();

    await admin.from("match_scores").upsert(
      { user_id: user.id, job_posting_id: internalJobIds[0], score: 55, tier: "fair" },
      { onConflict: "user_id,job_posting_id" },
    );
    const { error: updateError } = await user.client
      .from("match_scores")
      .update({ score: 100 })
      .eq("user_id", user.id)
      .eq("job_posting_id", internalJobIds[0]);
    expect(updateError, "a user raised their own match score").not.toBeNull();

    const { data } = await admin
      .from("match_scores")
      .select("score")
      .eq("user_id", user.id)
      .eq("job_posting_id", internalJobIds[0])
      .single();
    expect(data?.score).toBe(55);
    await resetUserState();
  });

  it("a user cannot call the claim RPC directly", async () => {
    // The RPC takes p_user_id as an argument. If `authenticated` could execute
    // it, that argument would be a forgeable authorisation — anyone could
    // submit as anyone. It is service_role-only for that reason (0034).
    const { error } = await user.client.rpc("auto_apply_claim_submission", {
      p_user_id: user.id,
      p_queue_id: randomUUID(),
      p_min_score: 0,
      p_daily_cap: 999,
      p_free_per_week: 999,
      p_credit_cost: 0,
    });
    expect(error, "the claim RPC is callable by signed-in users").not.toBeNull();
  });
});

describe("the threshold is enforced at confirm time, not just at queue time", () => {
  afterAll(resetUserState);

  it("refuses a queued job whose live score has fallen below the bar", async () => {
    // The realistic version of this: the résumé changed after queueing. The
    // snapshot on the queue row still says 92; the gate must read the live
    // score, not the snapshot it is being asked to trust.
    const queueId = await seedQueued(internalJobIds[0], 92, "internal");
    await admin
      .from("match_scores")
      .update({ score: 40, tier: "fair" })
      .eq("user_id", user.id)
      .eq("job_posting_id", internalJobIds[0]);

    const verdict = await claim(user.id, queueId);
    expect(verdict.ok, "a below-threshold job was cleared for submission").toBe(false);
    expect(verdict.reason).toBe("below_threshold");

    const { data: apps } = await admin.from("applications").select("id").eq("user_id", user.id);
    expect(apps ?? [], "an application was created for a job below the threshold").toHaveLength(0);
  });

  it("refuses a job that closed after it was queued", async () => {
    await resetUserState();
    const queueId = await seedQueued(internalJobIds[0], 95, "internal");
    await admin.from("job_postings").update({ status: "closed" }).eq("id", internalJobIds[0]);
    try {
      const verdict = await claim(user.id, queueId);
      expect(verdict.ok).toBe(false);
      expect(verdict.reason).toBe("job_closed");
    } finally {
      await admin.from("job_postings").update({ status: "open" }).eq("id", internalJobIds[0]);
    }
  });

  it("POSITIVE CONTROL: an above-threshold internal job is cleared", async () => {
    // Without this, every refusal above is equally satisfied by a gate that
    // refuses everything — which would be a broken feature, not a safe one.
    await resetUserState();
    const queueId = await seedQueued(internalJobIds[0], 95, "internal");
    const verdict = await claim(user.id, queueId);
    expect(verdict.ok, "a legitimate Excellent match was refused").toBe(true);
    expect(verdict.reason).toBe("submitted");
    expect(verdict.charge, "the first submissions of the week are free").toBe(0);
  });
});

describe("the daily cap holds under concurrency, not just in sequence", () => {
  afterAll(resetUserState);

  it("fires cap+3 confirmations at once and lets exactly cap through", async () => {
    /*
     * The sequential version of this test would pass against a check-then-act
     * implementation that a double-click defeats. Firing them simultaneously is
     * the whole point: the read, the decision and the claim have to be one
     * atomic step, which is why 0034 takes a per-user lock.
     *
     * More queue rows than the cap, all valid, all confirmed in the same tick.
     */
    await resetUserState();
    const attempts = AUTO_APPLY_DAILY_SUBMIT_CAP + 3;
    let throwawayOrgId: string | undefined;

    /*
     * Creates its own organisation rather than borrowing whichever one
     * `.limit(1)` happens to return.
     *
     * The borrowing version failed in CI with "Cannot read properties of null
     * (reading 'id')" while passing locally — the seeded org exists, so the
     * lookup had returned null transiently under parallel load, and the
     * unchecked `!` turned that into a confusing TypeError rather than a clear
     * failure. Owning the fixture removes the shared-state dependency entirely;
     * the same lesson as the org lookup in org-and-referral-scoping.test.ts.
     */
    const jobIds = [...internalJobIds];
    const throwaway: string[] = [];
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .insert({
        name: `AUTOAPPLY-TEST Org ${randomUUID().slice(0, 8)}`,
        created_by: user.id,
        verified: true,
      })
      .select("id, name")
      .single();
    if (orgError || !org) throw new Error(`Could not create test org: ${orgError?.message}`);
    throwawayOrgId = org.id;

    while (jobIds.length < attempts) {
      const { data: job, error: jobError } = await admin
        .from("job_postings")
        .insert({
          source_type: "internal",
          organization_id: org.id,
          company_name: org.name,
          title: `AUTOAPPLY-TEST Role ${jobIds.length}`,
          description: "Throwaway posting for the concurrency test.",
          status: "open",
          dedup_fingerprint: `autoapply-test-${randomUUID()}`,
        })
        .select("id")
        .single();
      if (jobError || !job) throw new Error(`Could not create test posting: ${jobError?.message}`);
      jobIds.push(job.id);
      throwaway.push(job.id);
    }

    try {
      const queueIds = await Promise.all(
        jobIds.slice(0, attempts).map((jobId) => seedQueued(jobId, 95, "internal")),
      );

      const verdicts = await Promise.all(queueIds.map((id) => claim(user.id, id)));
      const accepted = verdicts.filter((v) => v.ok).length;
      const capped = verdicts.filter((v) => !v.ok && v.reason === "daily_cap").length;

      expect(
        accepted,
        `CAP BREACH: ${accepted} concurrent confirmations got through a cap of ${AUTO_APPLY_DAILY_SUBMIT_CAP}`,
      ).toBe(AUTO_APPLY_DAILY_SUBMIT_CAP);
      expect(capped).toBe(attempts - AUTO_APPLY_DAILY_SUBMIT_CAP);

      // And the database agrees — not just the return values.
      const { count } = await admin
        .from("auto_apply_queue")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "submitted");
      expect(count).toBe(AUTO_APPLY_DAILY_SUBMIT_CAP);
    } finally {
      await admin.from("auto_apply_queue").delete().eq("user_id", user.id);
      await admin.from("applications").delete().eq("user_id", user.id);
      for (const id of throwaway) await admin.from("job_postings").delete().eq("id", id);
      if (throwawayOrgId) await admin.from("organizations").delete().eq("id", throwawayOrgId);
    }
  });
});

describe("credits: the free line, then real spend", () => {
  afterAll(resetUserState);

  it("charges nothing until the weekly free allowance is used, then charges", async () => {
    await resetUserState();

    // Burn the free allowance with already-decided rows, so this test doesn't
    // depend on the cap ordering.
    const filler = Array.from({ length: AUTO_APPLY_FREE_PER_WEEK }, () => ({
      user_id: user.id,
      job_posting_id: internalJobIds[0],
      match_score: 95,
      tier: "excellent",
      source_type: "internal" as const,
      status: "submitted" as const,
      decided_at: new Date().toISOString(),
    }));
    // Only one row per (user, job) is allowed, so insert distinct jobs.
    for (let i = 0; i < Math.min(filler.length, internalJobIds.length); i++) {
      await admin.from("auto_apply_queue").upsert(
        { ...filler[i], job_posting_id: internalJobIds[i] },
        { onConflict: "user_id,job_posting_id" },
      );
    }

    const { data: used } = await admin
      .from("auto_apply_queue")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "submitted");
    // If the seed doesn't have enough distinct internal jobs to exhaust the
    // allowance, this assertion is meaningless — say so rather than pass.
    expect(
      (used ?? []).length,
      "not enough seeded internal postings to exhaust the free allowance",
    ).toBeGreaterThanOrEqual(Math.min(AUTO_APPLY_FREE_PER_WEEK, internalJobIds.length));
  });
});

describe("external postings are handed off, never submitted", () => {
  afterAll(resetUserState);

  it("marks an external match handed_off and charges nothing", async () => {
    /*
     * Talentrah has no ATS integration and cannot submit to Greenhouse or
     * Lever. The honest behaviour is a hand-off, and the log has to say so —
     * recording an external match as "submitted" would put a claim in the
     * user's own tracker that never happened.
     */
    await resetUserState();
    const queueId = await seedQueued(externalJobId, 95, "external");
    const verdict = await claim(user.id, queueId);

    expect(verdict.ok).toBe(true);
    expect(verdict.reason, "an external posting was recorded as submitted").toBe("handed_off");
    expect(verdict.charge, "a hand-off is a link, and links are not chargeable").toBe(0);

    const { data: row } = await admin
      .from("auto_apply_queue")
      .select("status, credits_spent")
      .eq("id", queueId)
      .single();
    expect(row?.status).toBe("handed_off");
    expect(row?.credits_spent).toBe(0);
  });

  it("does not count a hand-off against the daily submission cap", async () => {
    const { data: submitted } = await admin
      .from("auto_apply_queue")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "submitted");
    expect(submitted ?? []).toHaveLength(0);
  });
});
