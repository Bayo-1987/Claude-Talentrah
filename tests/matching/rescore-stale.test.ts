/**
 * The stale-only rescore: A2 caps a score when it is COMPUTED, but production already holds rows computed under the old rules (none
 * carries `explanation.roleFit`). This rescoring touches exactly those rows, for the users who have a base resume, so old and new scores
 * stop mixing in the readers that do not recompute (the Auto-Apply scan, the digest, employer ranking).
 *
 *   - only rows WITHOUT roleFit are touched (a row that has it is never read, never written);
 *   - a user with no base resume is skipped and LISTED (there is nothing to score against);
 *   - it is idempotent: a second run touches 0 rows;
 *   - a failed batch is REPORTED (failed, errors) and never counted as rescored;
 *   - a dry run only counts: nothing is loaded for scoring and nothing is written.
 *
 * Driven through injected ports with an in-memory match_scores, so it needs no database. The module does not exist when this file is first
 * committed, so it is loaded at runtime (loadModule).
 */
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";
import type { StructuredResume } from "@/lib/resume/types";
import type { ScoredJobLike } from "@/lib/matching/compute-and-store";

interface Posting {
  id: string;
  title: string;
  structuredJd: unknown;
  seniority: string | null;
  open: boolean;
}
interface Summary {
  ok: boolean;
  dryRun: boolean;
  staleRows: number;
  usersWithStaleRows: number;
  usersRescored: number;
  rowsToRescore: number;
  rowsRescored: number;
  skippedNoBaseResume: Array<{ userId: string; rows: number }>;
  skippedPostingGone: number;
  failed: number;
  errors: Array<{ userId: string; message: string }>;
  nextCursor: string | null;
  complete: boolean;
  stoppedBy: "maxRows" | "deadline" | null;
}
interface Opts {
  dryRun: boolean;
  batchSize?: number;
  maxRows?: number;
  cursor?: string | null;
  shouldStop?: () => boolean;
}
interface Core {
  rescoreStale(
    deps: {
      listStaleRows(afterUserId: string | null): Promise<Array<{ userId: string; jobId: string }>>;
      loadBaseResume(userId: string): Promise<StructuredResume | null>;
      loadPostings(ids: string[]): Promise<Posting[]>;
      persist(userId: string, scored: ScoredJobLike[]): Promise<{ ok: boolean; persisted: number }>;
    },
    opts: Opts,
  ): Promise<Summary>;
}
const load = () => loadModule<Core>("@/lib/matching/rescore-stale");

const resume = (title: string): StructuredResume =>
  ({
    contact: {},
    experience: [{ title, company: "Co", startDate: "2020", endDate: "2024", description: "" }],
    education: [],
    skills: ["sql", "python"],
    projects: [],
    certifications: [],
  }) as unknown as StructuredResume;

/** An in-memory match_scores plus the ports over it. `calls` records what the job asked for. */
function world(opts: {
  rows: Array<{ userId: string; jobId: string; hasRoleFit: boolean }>;
  resumes: Record<string, StructuredResume | null>;
  postings: Posting[];
  failFor?: (userId: string) => boolean;
}) {
  const store = new Map(opts.rows.map((r) => [`${r.userId}|${r.jobId}`, { ...r }]));
  const calls = { listStale: 0, listAfter: [] as Array<string | null>, loadBaseResume: [] as string[], loadPostings: [] as string[][], persist: [] as Array<{ userId: string; ids: string[] }> };
  const deps = {
    async listStaleRows(afterUserId: string | null) {
      calls.listStale++;
      calls.listAfter.push(afterUserId);
      // Ordered by user, then job, and only users AFTER the cursor, exactly what the real port promises.
      return [...store.values()]
        .filter((r) => !r.hasRoleFit && (afterUserId === null || r.userId > afterUserId))
        .sort((a, b) => (a.userId === b.userId ? a.jobId.localeCompare(b.jobId) : a.userId.localeCompare(b.userId)))
        .map(({ userId, jobId }) => ({ userId, jobId }));
    },
    async loadBaseResume(userId: string) {
      calls.loadBaseResume.push(userId);
      return opts.resumes[userId] ?? null;
    },
    async loadPostings(ids: string[]) {
      calls.loadPostings.push(ids);
      return opts.postings.filter((p) => ids.includes(p.id));
    },
    async persist(userId: string, scored: ScoredJobLike[]) {
      calls.persist.push({ userId, ids: scored.map((s) => s.job.id) });
      if (opts.failFor?.(userId)) return { ok: false, persisted: 0 };
      for (const s of scored) {
        const row = store.get(`${userId}|${s.job.id}`);
        if (row) row.hasRoleFit = (s.explanation as { roleFit?: string }).roleFit !== undefined;
      }
      return { ok: true, persisted: scored.length };
    },
  };
  return { deps, calls, store };
}

const job = (id: string, title = "Senior Product Manager"): Posting => ({ id, title, structuredJd: { skills: ["sql", "python"] }, seniority: null, open: true });

describe("only rows without roleFit are touched", () => {
  it("rescores the stale rows and never reads or writes a row that already has roleFit", async () => {
    const { rescoreStale } = await load();
    const w = world({
      rows: [
        { userId: "u1", jobId: "j1", hasRoleFit: false },
        { userId: "u1", jobId: "j2", hasRoleFit: true },
        { userId: "u1", jobId: "j3", hasRoleFit: false },
      ],
      resumes: { u1: resume("Product Manager") },
      postings: [job("j1"), job("j2"), job("j3")],
    });
    const s = await rescoreStale(w.deps, { dryRun: false });
    expect(s.ok).toBe(true);
    expect(s.staleRows).toBe(2);
    expect(s.rowsRescored).toBe(2);
    expect(w.calls.persist).toEqual([{ userId: "u1", ids: ["j1", "j3"] }]);
    expect(w.calls.loadPostings.flat().sort()).toEqual(["j1", "j3"]);
  });

  it("writes the A2 fields: the rescored explanation carries roleFit", async () => {
    const { rescoreStale } = await load();
    const w = world({
      rows: [{ userId: "u1", jobId: "j1", hasRoleFit: false }],
      resumes: { u1: resume("Product Manager") },
      postings: [job("j1", "Global MEL Manager/Senior Manager")],
    });
    let seen: ScoredJobLike | undefined;
    const persist = w.deps.persist;
    w.deps.persist = async (u, scored) => {
      seen = scored[0];
      return persist(u, scored);
    };
    await rescoreStale(w.deps, { dryRun: false });
    expect((seen!.explanation as { roleFit?: string }).roleFit).toBe("different");
    expect(seen!.score).toBeLessThanOrEqual(59);
  });

  it("a stale row for a posting that is closed or gone is left alone and counted, not rescored", async () => {
    const { rescoreStale } = await load();
    const w = world({
      rows: [
        { userId: "u1", jobId: "open", hasRoleFit: false },
        { userId: "u1", jobId: "closed", hasRoleFit: false },
        { userId: "u1", jobId: "gone", hasRoleFit: false },
      ],
      resumes: { u1: resume("Product Manager") },
      postings: [job("open"), { ...job("closed"), open: false }],
    });
    const s = await rescoreStale(w.deps, { dryRun: false });
    expect(s.rowsRescored).toBe(1);
    expect(s.skippedPostingGone).toBe(2);
    expect(w.calls.persist).toEqual([{ userId: "u1", ids: ["open"] }]);
  });
});

describe("users without a base resume are skipped and listed", () => {
  it("lists them with their row counts, reads no postings for them and writes nothing for them", async () => {
    const { rescoreStale } = await load();
    const w = world({
      rows: [
        { userId: "has", jobId: "j1", hasRoleFit: false },
        { userId: "none", jobId: "j1", hasRoleFit: false },
        { userId: "none", jobId: "j2", hasRoleFit: false },
      ],
      resumes: { has: resume("Product Manager"), none: null },
      postings: [job("j1"), job("j2")],
    });
    const s = await rescoreStale(w.deps, { dryRun: false });
    expect(s.skippedNoBaseResume).toEqual([{ userId: "none", rows: 2 }]);
    expect(s.usersRescored).toBe(1);
    expect(w.calls.persist.map((c) => c.userId)).toEqual(["has"]);
    expect(w.calls.loadPostings.flat()).not.toContain("j2");
    expect(s.ok).toBe(true);
  });
});

describe("idempotent", () => {
  it("a second run finds nothing to touch", async () => {
    const { rescoreStale } = await load();
    const w = world({
      rows: [
        { userId: "u1", jobId: "j1", hasRoleFit: false },
        { userId: "u2", jobId: "j1", hasRoleFit: false },
      ],
      resumes: { u1: resume("Product Manager"), u2: resume("Software Engineer") },
      postings: [job("j1")],
    });
    const first = await rescoreStale(w.deps, { dryRun: false });
    expect(first.rowsRescored).toBe(2);
    const persistedBefore = w.calls.persist.length;
    const second = await rescoreStale(w.deps, { dryRun: false });
    expect(second.staleRows).toBe(0);
    expect(second.rowsRescored).toBe(0);
    expect(w.calls.persist.length).toBe(persistedBefore);
  });
});

describe("a failed batch reports, never half-claims success", () => {
  it("counts a failed user as failed with an error, does not count its rows as rescored, and carries on with the others", async () => {
    const { rescoreStale } = await load();
    const w = world({
      rows: [
        { userId: "bad", jobId: "j1", hasRoleFit: false },
        { userId: "bad", jobId: "j2", hasRoleFit: false },
        { userId: "good", jobId: "j1", hasRoleFit: false },
      ],
      resumes: { bad: resume("Product Manager"), good: resume("Product Manager") },
      postings: [job("j1"), job("j2")],
      failFor: (u) => u === "bad",
    });
    const s = await rescoreStale(w.deps, { dryRun: false });
    expect(s.ok).toBe(false);
    expect(s.failed).toBe(1);
    expect(s.errors.map((e) => e.userId)).toEqual(["bad"]);
    expect(s.rowsRescored).toBe(1); // only good's row
    expect(w.store.get("bad|j1")!.hasRoleFit).toBe(false); // still stale, so the next run retries it
  });

  it("a port that THROWS is a failed user too (not an unhandled crash, not a success)", async () => {
    const { rescoreStale } = await load();
    const w = world({
      rows: [{ userId: "u1", jobId: "j1", hasRoleFit: false }],
      resumes: { u1: resume("Product Manager") },
      postings: [job("j1")],
    });
    w.deps.persist = async () => {
      throw new Error("connection reset");
    };
    const s = await rescoreStale(w.deps, { dryRun: false });
    expect(s.ok).toBe(false);
    expect(s.failed).toBe(1);
    expect(s.errors[0].message).toMatch(/connection reset/);
    expect(s.rowsRescored).toBe(0);
  });

  it("splits a user's rows into batches, and a failure part-way reports the rows that did land and the ones that did not", async () => {
    const { rescoreStale } = await load();
    const ids = Array.from({ length: 5 }, (_, i) => `j${i}`);
    const w = world({
      rows: ids.map((jobId) => ({ userId: "u1", jobId, hasRoleFit: false })),
      resumes: { u1: resume("Product Manager") },
      postings: ids.map((id) => job(id)),
    });
    let n = 0;
    const persist = w.deps.persist;
    w.deps.persist = async (u, scored) => (++n === 2 ? { ok: false, persisted: 0 } : persist(u, scored));
    const s = await rescoreStale(w.deps, { dryRun: false, batchSize: 2 });
    expect(s.rowsRescored).toBe(3); // batches of 2, 2 (failed), 1
    expect(s.failed).toBe(1);
    expect(s.ok).toBe(false);
  });
});

describe("dry run only counts", () => {
  it("reports what it would do and loads no postings, reads no resumes' postings and writes nothing", async () => {
    const { rescoreStale } = await load();
    const w = world({
      rows: [
        { userId: "has", jobId: "j1", hasRoleFit: false },
        { userId: "has", jobId: "j2", hasRoleFit: false },
        { userId: "none", jobId: "j1", hasRoleFit: false },
      ],
      resumes: { has: resume("Product Manager"), none: null },
      postings: [job("j1"), job("j2")],
    });
    const s = await rescoreStale(w.deps, { dryRun: true });
    expect(s.dryRun).toBe(true);
    expect(s.staleRows).toBe(3);
    expect(s.usersWithStaleRows).toBe(2);
    expect(s.rowsToRescore).toBe(2);
    expect(s.skippedNoBaseResume).toEqual([{ userId: "none", rows: 1 }]);
    expect(s.rowsRescored).toBe(0);
    expect(w.calls.persist).toEqual([]);
    expect(w.calls.loadPostings).toEqual([]);
  });
});

describe("bounded batches with a cursor: a timeout leaves consistent data and a re-run carries on", () => {
  const users = ["u1", "u2", "u3", "u4"];
  const rowsFor = () => users.flatMap((u) => ["a", "b", "c"].map((j) => ({ userId: u, jobId: `${u}-${j}`, hasRoleFit: false })));
  const make = (extra: { failFor?: (u: string) => boolean } = {}) =>
    world({
      rows: rowsFor(),
      resumes: Object.fromEntries(users.map((u) => [u, resume("Product Manager")])),
      postings: users.flatMap((u) => ["a", "b", "c"].map((j) => job(`${u}-${j}`))),
      ...extra,
    });
  const written = (w: ReturnType<typeof make>) => w.calls.persist.flatMap((p) => p.ids);

  it("stops at maxRows on a user boundary (never half a user), reports a cursor, and says it is not complete", async () => {
    const { rescoreStale } = await load();
    const w = make();
    const s = await rescoreStale(w.deps, { dryRun: false, maxRows: 6 });
    expect(s.rowsRescored).toBe(6);
    expect(s.stoppedBy).toBe("maxRows");
    expect(s.complete).toBe(false);
    expect(s.nextCursor).toBe("u2");
    expect(written(w).sort()).toEqual(["u1-a", "u1-b", "u1-c", "u2-a", "u2-b", "u2-c"]);
  });

  it("carrying on with the cursor finishes the rest and processes no row twice; the last run is complete with a null cursor", async () => {
    const { rescoreStale } = await load();
    const w = make();
    let cursor: string | null = null;
    let guard = 0;
    let last: Summary | undefined;
    do {
      last = await rescoreStale(w.deps, { dryRun: false, maxRows: 5, cursor });
      cursor = last.nextCursor;
    } while (!last.complete && ++guard < 10);
    expect(last.complete).toBe(true);
    expect(last.nextCursor).toBeNull();
    const all = written(w);
    expect(all.length).toBe(12);
    expect(new Set(all).size, "no row written twice").toBe(12);
    // every list call after the first was asked only for users after the cursor it was given
    expect(w.calls.listAfter[0]).toBeNull();
    expect(w.calls.listAfter.slice(1).every((a) => a !== null)).toBe(true);
  });

  it("a run interrupted after N rows (a deadline), then re-run, processes nothing twice and finishes everything", async () => {
    const { rescoreStale } = await load();
    const w = make();
    let persists = 0;
    const origPersist = w.deps.persist;
    w.deps.persist = async (u, scored) => {
      persists++;
      return origPersist(u, scored);
    };
    // batchSize 2 means a user's 3 rows are two writes, so the deadline can land in the MIDDLE of a user.
    const first = await rescoreStale(w.deps, { dryRun: false, batchSize: 2, shouldStop: () => persists >= 3 });
    expect(first.stoppedBy).toBe("deadline");
    expect(first.complete).toBe(false);
    expect(first.rowsRescored).toBe(5); // u1 (2+1) and the first batch (2) of u2
    const second = await rescoreStale(w.deps, { dryRun: false, batchSize: 2, cursor: first.nextCursor });
    expect(second.complete).toBe(true);
    const all = written(w);
    expect(all.length).toBe(12);
    expect(new Set(all).size, "nothing was processed twice").toBe(12);
    expect([...w.store.values()].every((r) => r.hasRoleFit)).toBe(true);
  });

  it("an interrupted run's cursor never skips the half-done user: its unwritten rows are still stale and the re-run picks them up", async () => {
    const { rescoreStale } = await load();
    const w = make();
    let persists = 0;
    const origPersist = w.deps.persist;
    w.deps.persist = async (u, scored) => {
      persists++;
      return origPersist(u, scored);
    };
    const first = await rescoreStale(w.deps, { dryRun: false, batchSize: 2, shouldStop: () => persists >= 3 });
    expect(first.nextCursor, "u2 is only half done, so the cursor stays at the last FULLY done user").toBe("u1");
    const second = await rescoreStale(w.deps, { dryRun: false, batchSize: 2, cursor: first.nextCursor });
    expect(w.calls.persist.filter((p) => p.userId === "u2").flatMap((p) => p.ids).sort()).toEqual(["u2-a", "u2-b", "u2-c"]);
    expect(second.rowsRescored).toBe(7); // u2's last row + u3 + u4
  });

  it("a user skipped for having no base resume is passed over by the cursor, not retried forever", async () => {
    const { rescoreStale } = await load();
    const w = world({
      rows: [
        { userId: "u1", jobId: "u1-a", hasRoleFit: false },
        { userId: "u2", jobId: "u2-a", hasRoleFit: false },
        { userId: "u3", jobId: "u3-a", hasRoleFit: false },
      ],
      resumes: { u1: resume("Product Manager"), u2: null, u3: resume("Product Manager") },
      postings: [job("u1-a"), job("u2-a"), job("u3-a")],
    });
    const first = await rescoreStale(w.deps, { dryRun: false, maxRows: 2 });
    expect(first.nextCursor).toBe("u2");
    expect(first.skippedNoBaseResume).toEqual([{ userId: "u2", rows: 1 }]);
    const second = await rescoreStale(w.deps, { dryRun: false, maxRows: 2, cursor: first.nextCursor });
    expect(second.complete).toBe(true);
    expect(second.skippedNoBaseResume).toEqual([]);
    expect(w.calls.loadBaseResume.filter((u) => u === "u2")).toEqual(["u2"]);
  });

  it("a failed user does not move the cursor past rows that stayed stale for a re-run without a cursor", async () => {
    const { rescoreStale } = await load();
    const w = make({ failFor: (u) => u === "u2" });
    const s = await rescoreStale(w.deps, { dryRun: false });
    expect(s.ok).toBe(false);
    expect(s.failed).toBeGreaterThan(0);
    const stale = [...w.store.values()].filter((r) => !r.hasRoleFit).map((r) => r.userId);
    expect(new Set(stale)).toEqual(new Set(["u2"]));
    // the next uncursored run lists exactly the failed user's rows again
    const again = await rescoreStale(w.deps, { dryRun: true });
    expect(again.staleRows).toBe(3);
  });

  it("a dry run honours maxRows and the cursor too, and writes nothing", async () => {
    const { rescoreStale } = await load();
    const w = make();
    const s = await rescoreStale(w.deps, { dryRun: true, maxRows: 4, cursor: "u1" });
    expect(s.stoppedBy).toBe("maxRows");
    expect(s.rowsToRescore).toBe(6);
    expect(s.nextCursor).toBe("u3");
    expect(w.calls.persist).toEqual([]);
  });
});

describe("the admin route", () => {
  it("is POST-only behind the admin secret, and a request without write:true is a dry run", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/api/admin/rescore-stale-match-scores/route.ts", "utf8");
    expect(src).toMatch(/requireAdminSecret/);
    expect(src).toMatch(/export async function POST/);
    expect(src).not.toMatch(/export async function GET/);
    expect(src).toMatch(/dryRun/);
  });
});
