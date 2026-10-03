/**
 * The per-user loop of the match-score refresh, as a pure function over injected ports (so it is tested without a database).
 *
 * WHY IT EXISTS (post-ingest refresh): ingest changes postings several times a day (GitHub Actions every 3 hours plus the daily Vercel cron),
 * a new posting has no stored score, and a posting whose JD or seniority changes LOSES every user's score (trigger 0069), while the refresh
 * used to run once a day. Every reader of stored `match_scores` (the weekly digest, the Auto-Apply queue page, employer ranking) skips an
 * unscored posting. The refresh now also runs at the end of the ingest route, inside a time budget, so the loop must be:
 *   - gap-driven: it scores exactly the (user, posting) pairs that have no row, and a second run scores nothing;
 *   - bounded: `shouldStop` is asked before each user; it stops on a USER boundary and says `complete: false`, never half a user;
 *   - resumable: a re-run does only what is left, nothing twice;
 *   - failure-isolated: one user's failure is counted and does not stop the others.
 */
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";
import type { StructuredResume } from "@/lib/resume/types";
import type { ScoredJobLike } from "@/lib/matching/compute-and-store";

interface Posting {
  id: string;
  title: string;
  structuredJd: unknown;
  seniority: null;
  organizationId: null;
}
interface Result {
  usersUpToDate: number;
  usersRefreshed: number;
  postingsScored: number;
  distinctPostingsScored: number;
  failed: number;
  errors: Array<{ userId: string; message: string }>;
  complete: boolean;
  stoppedBy: "deadline" | null;
}
interface Core {
  refreshUsers(
    deps: {
      scoredPostingIds(userId: string): Promise<Set<string>>;
      loadBaseResume(userId: string): Promise<StructuredResume | null>;
      persist(userId: string, scored: ScoredJobLike[]): Promise<{ persisted: number; ok: boolean }>;
    },
    eligible: Posting[],
    userIds: string[],
    opts?: { shouldStop?: () => boolean },
  ): Promise<Result>;
}
const load = () => loadModule<Core>("@/lib/matching/refresh-users");

const resume = { contact: {}, experience: [], education: [], skills: ["sql", "python"], projects: [], certifications: [] } as unknown as StructuredResume;
const posting = (id: string): Posting => ({ id, title: "Product Manager", structuredJd: { skills: ["sql", "python"] }, seniority: null, organizationId: null });

/** An in-memory match_scores per user, and the ports over it. */
function world(initial: Record<string, string[]>, opts: { noResume?: string[]; failFor?: string[]; throwFor?: string[] } = {}) {
  const store = new Map(Object.entries(initial).map(([u, ids]) => [u, new Set(ids)]));
  const persisted: Array<{ userId: string; ids: string[] }> = [];
  const deps = {
    async scoredPostingIds(userId: string) {
      if (opts.throwFor?.includes(userId)) throw new Error("read failed");
      return new Set(store.get(userId) ?? []);
    },
    async loadBaseResume(userId: string) {
      return opts.noResume?.includes(userId) ? null : resume;
    },
    async persist(userId: string, scored: ScoredJobLike[]) {
      if (opts.failFor?.includes(userId)) return { persisted: 0, ok: false };
      persisted.push({ userId, ids: scored.map((s) => s.job.id) });
      const set = store.get(userId) ?? new Set<string>();
      for (const s of scored) set.add(s.job.id);
      store.set(userId, set);
      return { persisted: scored.length, ok: true };
    },
  };
  return { deps, store, persisted };
}

describe("gap-driven: it scores exactly the missing pairs", () => {
  it("scores only the postings a user has no row for, and a second run scores nothing", async () => {
    const { refreshUsers } = await load();
    const w = world({ u1: ["p1", "p2"] });
    const eligible = ["p1", "p2", "p3", "p4"].map(posting);
    const first = await refreshUsers(w.deps, eligible, ["u1"]);
    expect(w.persisted).toEqual([{ userId: "u1", ids: ["p3", "p4"] }]);
    expect(first.postingsScored).toBe(2);
    expect(first.usersRefreshed).toBe(1);
    const second = await refreshUsers(w.deps, eligible, ["u1"]);
    expect(second.postingsScored).toBe(0);
    expect(second.usersUpToDate).toBe(1);
    expect(w.persisted).toHaveLength(1);
  });

  it("INVALIDATED postings (their rows deleted by the JD-change trigger) are re-scored for EVERY user, and counted once as postings and per pair as rows", async () => {
    const { refreshUsers } = await load();
    // p2 lost its score for all three users (trigger 0069); p1 and p3 kept theirs.
    const w = world({ u1: ["p1", "p3"], u2: ["p1", "p3"], u3: ["p1", "p3"] });
    const r = await refreshUsers(w.deps, ["p1", "p2", "p3"].map(posting), ["u1", "u2", "u3"]);
    expect(w.persisted.map((p) => p.ids)).toEqual([["p2"], ["p2"], ["p2"]]);
    expect(r.postingsScored, "rows written, one per pair").toBe(3);
    expect(r.distinctPostingsScored, "distinct postings refreshed").toBe(1);
  });

  it("a user whose base resume is gone is up to date, not a failure", async () => {
    const { refreshUsers } = await load();
    const w = world({ u1: [] }, { noResume: ["u1"] });
    const r = await refreshUsers(w.deps, [posting("p1")], ["u1"]);
    expect(r.failed).toBe(0);
    expect(r.usersUpToDate).toBe(1);
    expect(w.persisted).toEqual([]);
  });
});

describe("bounded: it stops on a user boundary and a re-run carries on, nothing twice", () => {
  const eligible = ["p1", "p2", "p3"].map(posting);

  it("asks shouldStop before EACH user: once it says stop, the remaining users are untouched, the run says complete:false/deadline, and finished users are whole", async () => {
    const { refreshUsers } = await load();
    const w = world({ u1: [], u2: [], u3: [] });
    let asked = 0;
    const r = await refreshUsers(w.deps, eligible, ["u1", "u2", "u3"], { shouldStop: () => ++asked > 1 });
    expect(asked).toBeGreaterThanOrEqual(2);
    expect(r.complete).toBe(false);
    expect(r.stoppedBy).toBe("deadline");
    expect(w.persisted).toEqual([{ userId: "u1", ids: ["p1", "p2", "p3"] }]);
    expect(w.store.get("u2")?.size, "no half-written user").toBe(0);
    expect(w.store.get("u3")?.size).toBe(0);
  });

  it("a re-run after a deadline stop finishes the rest and scores nothing twice", async () => {
    const { refreshUsers } = await load();
    const w = world({ u1: [], u2: [], u3: [] });
    let asked = 0;
    await refreshUsers(w.deps, eligible, ["u1", "u2", "u3"], { shouldStop: () => ++asked > 1 });
    const second = await refreshUsers(w.deps, eligible, ["u1", "u2", "u3"]);
    expect(second.complete).toBe(true);
    expect(second.stoppedBy).toBeNull();
    const all = w.persisted.flatMap((p) => p.ids.map((id) => `${p.userId}:${id}`));
    expect(all).toHaveLength(9);
    expect(new Set(all).size, "no pair written twice").toBe(9);
  });

  it("with no deadline it is complete", async () => {
    const { refreshUsers } = await load();
    const r = await refreshUsers(world({ u1: [] }).deps, eligible, ["u1"]);
    expect(r.complete).toBe(true);
    expect(r.stoppedBy).toBeNull();
  });
});

describe("failure-isolated", () => {
  it("a failed write is counted, not counted as scored, and the other users are still done", async () => {
    const { refreshUsers } = await load();
    const w = world({ u1: [], u2: [] }, { failFor: ["u1"] });
    const r = await refreshUsers(w.deps, [posting("p1")], ["u1", "u2"]);
    expect(r.failed).toBe(1);
    expect(r.errors.map((e) => e.userId)).toEqual(["u1"]);
    expect(r.postingsScored).toBe(1);
    expect(w.store.get("u2")?.has("p1")).toBe(true);
  });

  it("a port that THROWS is a failed user too, and the loop carries on", async () => {
    const { refreshUsers } = await load();
    const w = world({ u1: [], u2: [] }, { throwFor: ["u1"] });
    const r = await refreshUsers(w.deps, [posting("p1")], ["u1", "u2"]);
    expect(r.failed).toBe(1);
    expect(w.store.get("u2")?.has("p1")).toBe(true);
  });
});

describe("overlapping writers (two refresh runs at the same time): nothing is double counted", () => {
  /** A store whose persist is INSERT ... ON CONFLICT DO NOTHING with a yield in the middle, so two runs really interleave. */
  function insertOnlyWorld(initial: Record<string, string[]>) {
    const store = new Map(Object.entries(initial).map(([u, ids]) => [u, new Set(ids)]));
    return {
      store,
      deps: {
        async scoredPostingIds(userId: string) {
          const snapshot = new Set(store.get(userId) ?? []);
          await Promise.resolve();
          return snapshot;
        },
        async loadBaseResume() {
          await Promise.resolve();
          return resume;
        },
        async persist(userId: string, scored: ScoredJobLike[]) {
          await Promise.resolve();
          const set = store.get(userId) ?? new Set<string>();
          const insertedIds: string[] = [];
          for (const s of scored) {
            if (!set.has(s.job.id)) {
              set.add(s.job.id);
              insertedIds.push(s.job.id);
            }
          }
          store.set(userId, set);
          return { persisted: insertedIds.length, ok: true, insertedIds };
        },
      },
    };
  }

  it("two simultaneous runs over the same users write each missing pair exactly once between them, and the rows-written counts add up to that, not double", async () => {
    const { refreshUsers } = await load();
    const w = insertOnlyWorld({ u1: ["p1"], u2: [] });
    const eligible = ["p1", "p2", "p3"].map(posting);
    const [a, b] = await Promise.all([refreshUsers(w.deps, eligible, ["u1", "u2"]), refreshUsers(w.deps, eligible, ["u1", "u2"])]);
    const missingPairs = 2 + 3; // u1 lacked p2,p3; u2 lacked p1,p2,p3
    expect(a.postingsScored + b.postingsScored, "rows written by both runs together").toBe(missingPairs);
    expect(a.failed + b.failed).toBe(0);
    expect([...(w.store.get("u1") ?? [])].sort()).toEqual(["p1", "p2", "p3"]);
    expect([...(w.store.get("u2") ?? [])].sort()).toEqual(["p1", "p2", "p3"]);
  });

  it("the distinct-postings figure counts only postings THIS run actually inserted (a run that lost every race reports 0)", async () => {
    const { refreshUsers } = await load();
    const w = insertOnlyWorld({ u1: [] });
    const eligible = ["p1", "p2"].map(posting);
    const first = await refreshUsers(w.deps, eligible, ["u1"]);
    expect(first.distinctPostingsScored).toBe(2);
    // a stale reader that still believes u1 has no rows, writing after another writer got there first:
    const stale = {
      ...w.deps,
      async scoredPostingIds() {
        return new Set<string>();
      },
    };
    const lost = await refreshUsers(stale, eligible, ["u1"]);
    expect(lost.postingsScored).toBe(0);
    expect(lost.distinctPostingsScored).toBe(0);
  });
});
