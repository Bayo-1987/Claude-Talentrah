/**
 * Auto-Apply must not act on a thin-tag "Excellent" — the confirm-time gate,
 * tested against the live database.
 *
 * Per docs/stage8-match-accuracy.md: 65% of every "Excellent" score this
 * system has ever computed sits on a screenable-tag denominator of 1 or
 * fewer. Auto-Apply is Excellent-only (0034), and until this migration
 * `auto_apply_claim_submission` re-read `match_scores.score` live at confirm
 * time but never `match_scores.explanation` — so a thin-tag "Excellent"
 * sailed through the same gate that is supposed to be the real backstop.
 *
 * This mirrors `tests/auto-apply/enforcement.test.ts`'s own pattern (drive
 * the RPC directly, the same one the confirm Server Action drives, since
 * that is where every real decision is made) rather than re-deriving one.
 *
 * The boundary asserted here comes from `THIN_SCREENABLE_TAG_MAX`
 * (src/lib/match-tier.ts), not a second hardcoded literal — see that
 * constant's own comment and 0164's migration header for why the SQL and TS
 * definitions of "thin" have to agree, and how this test is what actually
 * pins that.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { deleteTestOrgs } from "../support/cleanup";
import {
  AUTO_APPLY_DAILY_SUBMIT_CAP,
  AUTO_APPLY_FREE_PER_WEEK,
  AUTO_APPLY_MIN_SCORE,
} from "@/lib/auto-apply/config";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { THIN_SCREENABLE_TAG_MAX } from "@/lib/match-tier";

for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const) {
  if (!process.env[key]) throw new Error(`Auto-Apply thin-match test cannot run: ${key} is not set.`);
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
type DB = SupabaseClient<Database>;

const admin: DB = createClient<Database>(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function createAuthedUser(label: string) {
  const email = `autoapply-thin-${label}-${randomUUID()}@talentrah.test`;
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
    p_has_active_pass: false,
  });
  if (error) throw error;
  return data![0];
}

function explanationWithTags(matchedCount: number, missingCount: number) {
  return {
    matchedSkills: Array.from({ length: matchedCount }, (_, i) => `matched-${i}`),
    missingSkills: Array.from({ length: missingCount }, (_, i) => `missing-${i}`),
    seniorityAlignment: "unknown" as const,
  };
}

let user: Awaited<ReturnType<typeof createAuthedUser>>;
let fixtureOrgId: string;
const jobIds: string[] = [];

beforeAll(async () => {
  user = await createAuthedUser("owner");

  // Owns its own postings — same reasoning as enforcement.test.ts's own
  // header: a borrowed row can be deleted by its owner mid-suite under
  // parallel load against the shared hosted dev database.
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({
      name: `AUTOAPPLY-THIN-TEST Org ${randomUUID().slice(0, 8)}`,
      created_by: user.id,
      verified: true,
    })
    .select("id, name")
    .single();
  if (orgError || !org) throw new Error(`Could not create fixture org: ${orgError?.message}`);
  fixtureOrgId = org.id;

  for (let i = 0; i < 3; i += 1) {
    const { data: job, error: jobError } = await admin
      .from("job_postings")
      .insert({
        source_type: "internal",
        organization_id: fixtureOrgId,
        company_name: org.name,
        title: `AUTOAPPLY-THIN-TEST Seed Role ${i}`,
        description: "Fixture posting owned by tests/auto-apply/thin-match-gate.",
        status: "open",
        dedup_fingerprint: `autoapply-thin-seed-${randomUUID()}`,
      })
      .select("id")
      .single();
    if (jobError || !job) throw new Error(`Could not create fixture posting: ${jobError?.message}`);
    jobIds.push(job.id);
  }
});

afterAll(async () => {
  if (fixtureOrgId) await deleteTestOrgs([fixtureOrgId]);
  if (user) await admin.auth.admin.deleteUser(user.id);
});

/** Puts a score (with a real explanation) and a pending queue row in place. */
async function seedQueued(
  jobId: string,
  score: number,
  explanation: ReturnType<typeof explanationWithTags>,
) {
  const { error: scoreErr } = await admin
    .from("match_scores")
    .upsert(
      { user_id: user.id, job_posting_id: jobId, score, tier: "excellent", explanation },
      { onConflict: "user_id,job_posting_id" },
    );
  if (scoreErr) throw scoreErr;
  const { data, error } = await admin
    .from("auto_apply_queue")
    .upsert(
      {
        user_id: user.id,
        job_posting_id: jobId,
        match_score: score,
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
  if (error) throw error;
  return data!.id;
}

async function resetUserState() {
  await admin.from("auto_apply_queue").delete().eq("user_id", user.id);
  await admin.from("applications").delete().eq("user_id", user.id);
  await admin.from("match_scores").delete().eq("user_id", user.id);
}

describe("the confirm-time gate refuses a thin-tag Excellent, regardless of score", () => {
  afterAll(resetUserState);

  it("REGRESSION: refuses a single-tag Excellent match (the real, measured production shape)", async () => {
    // This is the exact shape the production hand-off sat on: a screenable-tag
    // total of 1, a score comfortably above the 80 threshold.
    await resetUserState();
    const queueId = await seedQueued(jobIds[0], 99, explanationWithTags(1, 0));
    const verdict = await claim(user.id, queueId);
    expect(verdict.ok, "a thin-tag Excellent match was cleared for submission").toBe(false);
    expect(verdict.reason).toBe("thin_match");

    const { data: apps } = await admin.from("applications").select("id").eq("user_id", user.id);
    expect(apps ?? [], "an application was created for a thin-tag match").toHaveLength(0);

    const { data: row } = await admin
      .from("auto_apply_queue")
      .select("status")
      .eq("id", queueId)
      .single();
    // Refused, but left decidable — same as below_threshold: this is not a
    // job_closed-style terminal state, the row just wasn't claimed.
    expect(row?.status).toBe("pending");
  });

  it("refuses exactly at the thin boundary (THIN_SCREENABLE_TAG_MAX total tags)", async () => {
    await resetUserState();
    const queueId = await seedQueued(
      jobIds[0],
      95,
      explanationWithTags(THIN_SCREENABLE_TAG_MAX, 0),
    );
    const verdict = await claim(user.id, queueId);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("thin_match");
  });

  it("refuses a thin match even at a perfect 100 score — thin overrides the threshold entirely", async () => {
    await resetUserState();
    const queueId = await seedQueued(jobIds[0], 100, explanationWithTags(0, 0));
    const verdict = await claim(user.id, queueId);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("thin_match");
  });

  it("POSITIVE CONTROL: a rich-tag Excellent match still succeeds — this must not break the feature for real matches", async () => {
    // Without this, every refusal above is equally satisfied by a gate that
    // refuses everything — see enforcement.test.ts's own identically-named
    // control for the same reasoning.
    //
    // Only the RPC is driven here (not the Server Action), so this checks
    // what the RPC itself is responsible for: the verdict and the queue row
    // it claims. `applications` row creation happens one layer up in
    // confirmAutoApplyAction (src/lib/auto-apply/actions.ts) after the RPC
    // returns ok — enforcement.test.ts's own positive control makes the same
    // scope choice.
    await resetUserState();
    const queueId = await seedQueued(
      jobIds[0],
      95,
      explanationWithTags(THIN_SCREENABLE_TAG_MAX + 1, 0),
    );
    const verdict = await claim(user.id, queueId);
    expect(verdict.ok, "a legitimate rich-tag Excellent match was refused").toBe(true);
    expect(verdict.reason).toBe("submitted");
    expect(verdict.charge, "the first submissions of the week are free").toBe(0);

    const { data: row } = await admin
      .from("auto_apply_queue")
      .select("status")
      .eq("id", queueId)
      .single();
    expect(row?.status).toBe("submitted");
  });

  it("counts matched + missing together: a mixed thin total is still refused", async () => {
    await resetUserState();
    // 1 matched + 1 missing = 2 = THIN_SCREENABLE_TAG_MAX when that constant
    // is 2; written from the constant rather than the literal so this stays
    // correct if the constant ever changes.
    const missing = Math.max(0, THIN_SCREENABLE_TAG_MAX - 1);
    const queueId = await seedQueued(jobIds[0], 90, explanationWithTags(1, missing));
    const verdict = await claim(user.id, queueId);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("thin_match");
  });
});
