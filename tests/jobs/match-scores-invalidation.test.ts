/**
 * 0069 — a posting's cached match scores must not outlive its requirements.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 *
 * `match_scores` caches "how well does this resume fit this posting", and
 * nothing invalidated it when the posting changed. Aggregation re-ingests
 * continuously and upserts `structured_jd` in place, so a score computed
 * against one set of requirements survived them being replaced. Six of the 642
 * rows on production carried an explanation naming skills the posting no
 * longer listed.
 *
 * Not cosmetic: `scanAndQueue` reads a user's above-threshold scores straight
 * out of this table — all of them, not only the ones the feed just recomputed
 * — so a stale row is a route to queueing an application against requirements
 * that no longer exist.
 *
 * ── WHAT MAKES THIS TEST MEAN ANYTHING ────────────────────────────────────
 *
 * A test that only asserts "the row disappeared" would pass against a trigger
 * that deleted the cache on EVERY update, which would throw away the whole
 * cache each time a posting's title or applicant count changed. So the
 * negative case is the load-bearing one: updating a column the score was never
 * computed from must leave the row alone. The two together pin the trigger's
 * WHEN clause, which is the part with a real decision in it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCleanups, mustDelete } from "../support/teardown";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`match-scores invalidation test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const createdJobs: string[] = [];
const createdUsers: string[] = [];

async function makePosting(skills: string[], seniority: "mid" | "senior" = "mid") {
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "external",
      company_name: "MS-INVALIDATION Co",
      title: "MS-INVALIDATION Role",
      description: "Fixture posting owned by tests/jobs/match-scores-invalidation.",
      structured_jd: { skills },
      seniority,
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
      external_source: "match-scores-invalidation-test",
      external_url: `https://example.test/${randomUUID()}`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not create fixture posting: ${error?.message}`);
  createdJobs.push(data.id);
  return data.id;
}

/*
 * TWO users for the whole file, created once.
 *
 * Every suite here creates real auth users against the one shared CI project,
 * ~20 files in parallel, and CLAUDE.md warns that back-to-back runs hit
 * Supabase's auth rate limit. The first version of this file created a user
 * per test — six — and the CI run failed in an unrelated suite
 * (tests/rls/admin-mfa) whose own fixture operator had not been created. The
 * tests here care about how many match_scores rows a posting has, not about
 * who owns them, so six accounts bought nothing and cost another suite its
 * setup.
 */
let users: string[] = [];

beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `ms-inval-${randomUUID()}@talentrah.test`,
      password: randomUUID(),
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`Could not create fixture user: ${error?.message}`);
    createdUsers.push(data.user.id);
  }
  users = [...createdUsers];
}, 60_000);

async function score(userId: string, jobId: string) {
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

/*
 * Counts only the rows THIS test seeded, not every row for the posting.
 *
 * Scoped deliberately: a fixture posting is inserted `open`, so anything else
 * pointed at the same database — a dev server rendering the feed, another
 * suite — will score it too and inflate a naive count. That happened while
 * this was being written and looked exactly like a broken trigger.
 */
async function scoreRows(jobId: string, userIds: string[]) {
  const { count, error } = await admin
    .from("match_scores")
    .select("job_posting_id", { count: "exact", head: true })
    .eq("job_posting_id", jobId)
    .in("user_id", userIds);
  if (error) throw new Error(`Could not count match scores: ${error.message}`);
  return count ?? 0;
}

afterAll(async () => {
  /*
   * Every step runs even if an earlier one fails. Written as sequential
   * throw-on-error deletes, a refused posting delete abandoned the user
   * cleanup entirely and leaked accounts into the shared CI project — a
   * failure that surfaces later, somewhere unrelated. See runCleanups.
   */
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

describe("changing what the score was computed from clears the cache", () => {
  it("drops the cached scores when the skills change", async () => {
    const jobId = await makePosting(["sql", "python"]);
    await score(users[0]!, jobId);
    expect(await scoreRows(jobId, users)).toBe(1);

    const { error } = await admin
      .from("job_postings")
      .update({ structured_jd: { skills: ["sql", "kubernetes"] } })
      .eq("id", jobId);
    expect(error).toBeNull();

    expect(await scoreRows(jobId, users)).toBe(0);
  });

  it("drops them when the seniority changes", async () => {
    // The second input to computeMatchScore, and easy to forget in a WHEN
    // clause that only names structured_jd.
    const jobId = await makePosting(["sql"], "mid");
    await score(users[0]!, jobId);

    const { error } = await admin.from("job_postings").update({ seniority: "senior" }).eq("id", jobId);
    expect(error).toBeNull();

    expect(await scoreRows(jobId, users)).toBe(0);
  });

  it("clears every user's row for that posting, not just one", async () => {
    const jobId = await makePosting(["sql"]);
    for (const u of users) await score(u, jobId);
    expect(await scoreRows(jobId, users)).toBe(2);

    await admin.from("job_postings").update({ structured_jd: { skills: ["figma"] } }).eq("id", jobId);
    expect(await scoreRows(jobId, users)).toBe(0);
  });
});

describe("changing anything else leaves the cache alone", () => {
  it("keeps the scores when only the title changes", async () => {
    /*
     * The discriminating case. Without it, a trigger firing on every update
     * would pass the tests above while throwing away the entire cache
     * whenever any unrelated column moved.
     */
    const jobId = await makePosting(["sql"]);
    await score(users[0]!, jobId);

    const { error } = await admin
      .from("job_postings")
      .update({ title: "MS-INVALIDATION Role (retitled)" })
      .eq("id", jobId);
    expect(error).toBeNull();

    expect(await scoreRows(jobId, users)).toBe(1);
  });

  it("keeps them when structured_jd is rewritten to an equal value", async () => {
    // `is distinct from` compares values, not writes. A re-ingest that finds
    // nothing changed must not evict a still-correct cache.
    const jobId = await makePosting(["sql", "python"]);
    await score(users[0]!, jobId);

    await admin
      .from("job_postings")
      .update({ structured_jd: { skills: ["sql", "python"] } })
      .eq("id", jobId);

    expect(await scoreRows(jobId, users)).toBe(1);
  });
});
