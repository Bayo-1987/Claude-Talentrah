/**
 * The database cursor of the stale-only rescore (S3-65 item 2), against the real database: unit tests drive the cursor through an in-memory
 * port and cannot see a wrong comparison or a missing ordering in the real query. A `>=` instead of `>` would visit the cursor's user twice; a
 * missing ORDER BY would let a page boundary skip or repeat users.
 *
 * Runs the real `listStaleRows` port (the one the production route uses) under the pure orchestration, with every other port stubbed so
 * NOTHING IS WRITTEN: this is a read-only walk. The database is shared with other suites, so ambient users' stale rows are in the walk too:
 * every assertion about "exactly once" is made for this file's own fixture users, and about "no user twice, in order" for the whole walk.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { rescoreStale } from "@/lib/matching/rescore-stale";
import { countStaleRowsSingleQuery, realDeps } from "@/lib/matching/rescore-stale-job";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Rescore cursor test cannot run: ${key} is not set.`);
}

const users: string[] = [];
const postings: string[] = [];
const ROWS_PER_USER = 3;
const USER_COUNT = 5;

beforeAll(async () => {
  for (let i = 0; i < ROWS_PER_USER; i++) {
    const { data, error } = await admin
      .from("job_postings")
      .insert({
        title: "RSCUR Fixture Role",
        company_name: "RSCUR Fixture Co",
        description: "Fixture posting for the rescore cursor suite.",
        structured_jd: { skills: ["sql"] },
        status: "open",
        source_type: "external",
        external_source: "rscur-test",
        external_url: `https://example.test/${randomUUID()}`,
        posted_at: new Date().toISOString(),
        last_checked_at: new Date().toISOString(),
        dedup_fingerprint: randomUUID(),
      })
      .select("id")
      .single();
    if (error) throw error;
    postings.push(data!.id as string);
  }
  for (let u = 0; u < USER_COUNT; u++) {
    const user = await createTestUser(`rscur-${u}`);
    users.push(user.id);
    for (const jobId of postings) {
      // An explanation WITHOUT roleFit: exactly what the rescore lists as stale.
      const { error } = await admin.from("match_scores").insert({ user_id: user.id, job_posting_id: jobId, score: 65, tier: "fair", explanation: {} });
      if (error) throw error;
    }
  }
}, 120_000);

afterAll(async () => {
  if (postings.length) {
    const { error } = await admin.from("job_postings").delete().in("id", postings);
    if (error) console.warn(`[cleanup] could not delete fixture postings: ${error.message}`);
  }
  await deleteTestUsers(users);
}, 60_000);

/** A dry-run walk with the REAL listing port, recording the user ids visited, in the order visited. Nothing is written. */
async function walk(maxRows: number) {
  const visited: string[] = [];
  let rows = 0;
  const base = realDeps();
  const deps = {
    listStaleRows: base.listStaleRows,
    async loadBaseResume(userId: string) {
      visited.push(userId);
      return { contact: {}, experience: [], education: [], skills: [], projects: [], certifications: [] } as never;
    },
    async loadPostings() {
      return [];
    },
    async persist(): Promise<{ ok: boolean; persisted: number }> {
      throw new Error("the cursor test must never write");
    },
  };
  let cursor: string | null = null;
  let guard = 0;
  for (;;) {
    const s = await rescoreStale(deps, { dryRun: true, maxRows, cursor });
    rows += s.rowsVisited;
    if (s.complete) break;
    expect(s.nextCursor, "an unfinished call hands back a cursor").not.toBeNull();
    expect(cursor === null || s.nextCursor! > cursor, "the cursor strictly advances").toBe(true);
    cursor = s.nextCursor;
    if (++guard > 5000) throw new Error("the walk did not finish");
  }
  return { visited, rows };
}

describe("the real database cursor", () => {
  it("pages with a small maxRows, visits every fixture user exactly once, in a stable ascending order, and no user twice anywhere", async () => {
    const { visited } = await walk(ROWS_PER_USER); // about one user per call
    expect(new Set(visited).size, "no user visited twice in the whole walk").toBe(visited.length);
    for (const id of users) expect(visited.filter((v) => v === id), `fixture user ${id.slice(0, 8)} visited once`).toHaveLength(1);
    expect([...visited].sort(), "visited in ascending user-id order").toEqual(visited);
  });

  it("a second walk with a different page size visits the same users in the same order (stable ordering)", async () => {
    const a = await walk(ROWS_PER_USER);
    const b = await walk(ROWS_PER_USER * 3 + 1);
    const ours = (v: string[]) => v.filter((id) => users.includes(id));
    expect(ours(b.visited)).toEqual(ours(a.visited));
    expect(new Set(b.visited).size).toBe(b.visited.length);
  });

  it("the single-query count includes this file's fixture rows (the chain's total is reconciled against this number in production)", async () => {
    const n = await countStaleRowsSingleQuery();
    expect(n).toBeGreaterThanOrEqual(USER_COUNT * ROWS_PER_USER);
  });
});
