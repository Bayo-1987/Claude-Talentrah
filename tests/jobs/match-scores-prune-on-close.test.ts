/**
 * 0166 — a posting's cached match scores must not outlive it closing (#149).
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 *
 * `match_scores` caches "how well does this resume fit this posting", and
 * nothing removed a row when the posting it was computed against closed. The
 * feed doesn't revisit it either — it only ever scores postings it fetched,
 * and it fetches `status = 'open'` — so a row whose posting has since closed
 * was simply orphaned forever. Measured on production: 49 stale rows of 950
 * (5.2%) two weeks before this migration, growing with posting churn.
 *
 * Every live reader (the feed, `scanAndQueue`, `promoted_jobs()`,
 * `auto_apply_claim_submission`) already scopes to open postings, so this is
 * hygiene rather than a user-facing fix — see 0166's own migration header.
 *
 * ── WHAT MAKES THIS TEST MEAN ANYTHING ────────────────────────────────────
 *
 * Mirrors tests/jobs/match-scores-invalidation.test.ts (0069)'s own shape:
 * the negative case is load-bearing. A trigger firing on every update to
 * `job_postings`, not just the open→closed transition, would pass the
 * positive case while discarding scores whenever an unrelated column (or a
 * status transition that isn't a close) changed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCleanups, mustDelete } from "../support/teardown";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`match-scores prune-on-close test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const createdJobs: string[] = [];
const createdUsers: string[] = [];

async function makePosting(status: "open" | "closed" = "open") {
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "external",
      company_name: "MS-PRUNE Co",
      title: "MS-PRUNE Role",
      description: "Fixture posting owned by tests/jobs/match-scores-prune-on-close.",
      structured_jd: { skills: ["sql"] },
      seniority: "mid",
      status,
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
      external_source: "match-scores-prune-on-close-test",
      external_url: `https://example.test/${randomUUID()}`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not create fixture posting: ${error?.message}`);
  createdJobs.push(data.id);
  return data.id;
}

let userId = "";

beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: `ms-prune-${randomUUID()}@talentrah.test`,
    password: randomUUID(),
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`Could not create fixture user: ${error?.message}`);
  userId = data.user.id;
  createdUsers.push(userId);
}, 60_000);

async function score(jobId: string) {
  const { error } = await admin.from("match_scores").insert({
    user_id: userId,
    job_posting_id: jobId,
    score: 90,
    tier: "excellent",
    explanation: { matchedSkills: ["sql"], missingSkills: [], seniorityAlignment: "match" },
    computed_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Could not seed match score: ${error.message}`);
}

// Scoped to this fixture's own job + user, same reasoning as 0069's test:
// another process scoring the same (open) posting concurrently would
// otherwise inflate the count and look like a broken trigger.
async function rowCount(jobId: string) {
  const { count, error } = await admin
    .from("match_scores")
    .select("job_posting_id", { count: "exact", head: true })
    .eq("job_posting_id", jobId)
    .eq("user_id", userId);
  if (error) throw new Error(`Could not count match scores: ${error.message}`);
  return count ?? 0;
}

afterAll(async () => {
  await runCleanups(
    ["postings", async () => {
      if (createdJobs.length) {
        await mustDelete("job_postings", admin.from("job_postings").delete().in("id", createdJobs));
      }
    }],
    ...createdUsers.map(
      (id) =>
        [`user ${id}`, async () => {
          const { error } = await admin.auth.admin.deleteUser(id);
          if (error) throw new Error(error.message);
        }] as const,
    ),
  );
});

describe("a posting closing clears its cached scores", () => {
  it("drops the cached score when status transitions open -> closed", async () => {
    const jobId = await makePosting("open");
    await score(jobId);
    expect(await rowCount(jobId)).toBe(1);

    const { error } = await admin.from("job_postings").update({ status: "closed" }).eq("id", jobId);
    expect(error).toBeNull();

    expect(await rowCount(jobId)).toBe(0);
  });
});

describe("anything else leaves the cache alone", () => {
  it("keeps the score when the posting is created already closed (no transition)", async () => {
    // The WHEN clause fires on a transition (`old.status is distinct from
    // new.status`), not on the value at insert time. A row scored against
    // an already-closed posting is a pre-existing-data question, handled by
    // 0166's one-time backfill, not by this trigger.
    const jobId = await makePosting("closed");
    await score(jobId);
    expect(await rowCount(jobId)).toBe(1);
  });

  it("keeps the score when an unrelated column changes", async () => {
    // The discriminating case, same role as 0069's title-only-change test:
    // without the `of status` scoping, any update to the row would evict it.
    const jobId = await makePosting("open");
    await score(jobId);

    const { error } = await admin
      .from("job_postings")
      .update({ title: "MS-PRUNE Role (retitled)" })
      .eq("id", jobId);
    expect(error).toBeNull();

    expect(await rowCount(jobId)).toBe(1);
  });

  it("keeps the score when status is set but stays 'open'", async () => {
    // `old.status is distinct from new.status` guards against a same-value
    // rewrite firing the trigger for no reason.
    const jobId = await makePosting("open");
    await score(jobId);

    const { error } = await admin.from("job_postings").update({ status: "open" }).eq("id", jobId);
    expect(error).toBeNull();

    expect(await rowCount(jobId)).toBe(1);
  });
});
