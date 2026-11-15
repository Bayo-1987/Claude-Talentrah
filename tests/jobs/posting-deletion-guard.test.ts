/**
 * JOBS-LIFECYCLE-1 W-1, against a recording fake of the service client (no database): the nightly delete goes ONLY through job_posting_delete_unreferenced, and when that function is missing or errors
 * it deletes NOTHING MORE, says so, and NEVER falls back to the old unguarded delete. The database-backed behaviour (what is kept, what is deleted) is tests/jobs/posting-deletion.test.ts.
 *
 * Mutant (named in the report): fall back to the unguarded `.delete()` when the function errors = red here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rec = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; args?: unknown }>,
  eligible: [] as Array<{ id: string }>,
  rpcResults: [] as Array<{ data: unknown; error: { message: string } | null } | Error>,
  removed: [] as string[][],
}));

vi.mock("@/lib/supabase/service-role", () => {
  const select = () => {
    const q: Record<string, unknown> = {};
    for (const m of ["eq", "not", "lt", "in"]) q[m] = (...args: unknown[]) => { rec.calls.push({ op: `select.${m}`, args }); return q; };
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: rec.eligible, error: null });
    return q;
  };
  return {
    createServiceRoleClient: () => ({
      from: (table: string) => ({
        select: (cols: string) => { rec.calls.push({ op: "select", args: [table, cols] }); return select(); },
        // The unguarded path: a test that sees this call has found the data loss W-1 removes.
        delete: () => { rec.calls.push({ op: "UNGUARDED_DELETE", args: [table] }); const d: Record<string, unknown> = {}; for (const m of ["in", "eq", "not", "lt"]) d[m] = () => d; d.select = async () => ({ data: [], error: null }); return d; },
      }),
      rpc: async (name: string, args: unknown) => {
        rec.calls.push({ op: "rpc", args: [name, args] });
        const next = rec.rpcResults.shift();
        if (next instanceof Error) throw next;
        return next ?? { data: [], error: null };
      },
      storage: { from: () => ({ remove: async (paths: string[]) => { rec.removed.push(paths); return { data: paths.map((name) => ({ name })), error: null }; } }) },
    }),
  };
});

import { CLOSED_STALE_AFTER_DAYS, deleteStaleClosedPostings } from "@/lib/jobs/posting-deletion";

const NOW = new Date("2026-11-14T12:00:00Z");
const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `job-${i}` }));
const calls = (op: string) => rec.calls.filter((c) => c.op === op);
const FN = "job_posting_delete_unreferenced";

beforeEach(() => {
  rec.calls.length = 0;
  rec.eligible = [];
  rec.rpcResults.length = 0;
  rec.removed.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("the nightly delete goes through the guarded function, with today's rule", () => {
  it("POSITIVE CONTROL: it calls job_posting_delete_unreferenced with the eligible ids and the 30-day cutoff, and never the unguarded delete", async () => {
    rec.eligible = ids(2);
    rec.rpcResults.push({ data: [{ deleted_job_id: "job-0", deleted_banner_path: null }, { deleted_job_id: "job-1", deleted_banner_path: null }], error: null });
    const result = await deleteStaleClosedPostings(NOW);
    expect(CLOSED_STALE_AFTER_DAYS).toBe(30);
    expect(calls("UNGUARDED_DELETE")).toEqual([]);
    expect(calls("rpc")).toHaveLength(1);
    expect(calls("rpc")[0].args).toEqual([FN, { p_ids: ["job-0", "job-1"], p_closed_before: "2026-10-15T12:00:00.000Z" }]);
    expect(result).toEqual({ eligible: 2, deleted: 2, ids: ["job-0", "job-1"], kept: 0 });
  });

  it("rows the guard keeps are counted as kept, not as an error, and only the rows it deleted lose their banner", async () => {
    rec.eligible = ids(3);
    rec.rpcResults.push({ data: [{ deleted_job_id: "job-1", deleted_banner_path: "org/job-1.png" }], error: null });
    const result = await deleteStaleClosedPostings(NOW);
    expect(result).toEqual({ eligible: 3, deleted: 1, ids: ["job-1"], kept: 2 });
    expect(rec.removed).toEqual([["org/job-1.png"]]);
  });

  it("nothing eligible: no call at all", async () => {
    const result = await deleteStaleClosedPostings(NOW);
    expect(result).toEqual({ eligible: 0, deleted: 0, ids: [] });
    expect(calls("rpc")).toEqual([]);
  });
});

describe("if the guard is missing or fails, NOTHING is deleted and there is NO fallback", () => {
  it("the function is missing (the migration is not applied yet): the run reports the error, deletes nothing, and does not fall back to the unguarded delete", async () => {
    rec.eligible = ids(2);
    rec.rpcResults.push({ data: null, error: { message: "Could not find the function public.job_posting_delete_unreferenced(p_ids, p_closed_before) in the schema cache" } });
    const result = await deleteStaleClosedPostings(NOW);
    expect(result.error).toMatch(/Could not find the function/);
    expect(result.deleted).toBe(0);
    expect(result.ids).toEqual([]);
    expect(result.kept).toBe(2);
    expect(calls("UNGUARDED_DELETE"), "no fallback to the unguarded delete").toEqual([]);
    expect(rec.removed, "no banner removed for a row that was not deleted").toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });

  it("the function errors for any other reason: the same, and the error is logged", async () => {
    rec.eligible = ids(1);
    rec.rpcResults.push({ data: null, error: { message: "permission denied for function job_posting_delete_unreferenced" } });
    const result = await deleteStaleClosedPostings(NOW);
    expect(result).toMatchObject({ eligible: 1, deleted: 0, error: "permission denied for function job_posting_delete_unreferenced" });
    expect(calls("UNGUARDED_DELETE")).toEqual([]);
  });

  it("a failure in a LATER batch stops the run there: earlier deletions stand, nothing more is deleted, no fallback", async () => {
    rec.eligible = ids(450); // chunkInList's batches are 200 ids
    rec.rpcResults.push({ data: ids(200).map((r) => ({ deleted_job_id: r.id, deleted_banner_path: null })), error: null });
    rec.rpcResults.push({ data: null, error: { message: "boom" } });
    const result = await deleteStaleClosedPostings(NOW);
    expect(result.error).toBe("boom");
    expect(result.deleted).toBe(200);
    expect(calls("rpc")).toHaveLength(2);
    expect(calls("UNGUARDED_DELETE")).toEqual([]);
  });

  it("if the call itself throws, the run rejects (the route answers 500) and still does not fall back", async () => {
    rec.eligible = ids(1);
    rec.rpcResults.push(new Error("network down"));
    await expect(deleteStaleClosedPostings(NOW)).rejects.toThrow("network down");
    expect(calls("UNGUARDED_DELETE")).toEqual([]);
  });
});

describe("the source has no unguarded delete of job_postings left in the nightly path", () => {
  it("posting-deletion.ts deletes a job_postings row by id in exactly one place, the employer's own direct delete (deleteJobPosting), not in deleteStaleClosedPostings", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/jobs/posting-deletion.ts", "utf8");
    // Code only: the comments explain the old unguarded delete and may quote it.
    const body = src.slice(src.indexOf("export async function deleteStaleClosedPostings")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(body).not.toMatch(/\.delete\(\)/);
    expect(body).toContain('rpc("job_posting_delete_unreferenced"');
  });
});
