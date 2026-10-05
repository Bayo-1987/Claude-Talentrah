/**
 * The bounded multi-call chain (S3-65 item 2): a dry run walked in pages of `maxRows` must visit every stale row exactly once, and the
 * summary must say how many rows and users each call VISITED (including users skipped for having no base resume), so the sum over the chain
 * can be set against an independent single-query count before a write run is approved.
 */
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";
import type { StructuredResume } from "@/lib/resume/types";

interface Visit {
  rowsVisited: number;
  usersVisited: number;
  complete: boolean;
  nextCursor: string | null;
}
interface Core {
  rescoreStale(deps: unknown, opts: { dryRun: boolean; maxRows?: number; cursor?: string | null }): Promise<Visit>;
}
const load = () => loadModule<Core>("@/lib/matching/rescore-stale");

const resume = { contact: {}, experience: [], education: [], skills: ["sql"], projects: [], certifications: [] } as unknown as StructuredResume;

// u1: 3 rows, u2: 4 rows (no resume), u3: 1 row, u4: 6 rows, u5: 2 rows
const ROWS: Record<string, number> = { u1: 3, u2: 4, u3: 1, u4: 6, u5: 2 };
const TOTAL_ROWS = 16;

function deps(visitedUsers: string[]) {
  const all = Object.entries(ROWS).flatMap(([u, n]) => Array.from({ length: n }, (_, i) => ({ userId: u, jobId: `${u}-${i}`, score: 90, explanation: {} })));
  return {
    async listStaleRows(after: string | null) {
      return all.filter((r) => after === null || r.userId > after);
    },
    async loadBaseResume(u: string) {
      visitedUsers.push(u);
      return u === "u2" ? null : resume;
    },
    async loadPostings() {
      return [];
    },
    async persist() {
      throw new Error("a dry run must never write");
    },
  };
}

describe("a dry run walked in pages visits every stale row exactly once", () => {
  it("sums to the total, counts a no-resume user's rows as visited, and never visits a user twice", async () => {
    const { rescoreStale } = await load();
    const visitedUsers: string[] = [];
    const d = deps(visitedUsers);
    let cursor: string | null = null;
    let rows = 0;
    let users = 0;
    let calls = 0;
    const cursors: string[] = [];
    let last: Visit;
    do {
      last = await rescoreStale(d, { dryRun: true, maxRows: 5, cursor });
      rows += last.rowsVisited;
      users += last.usersVisited;
      cursor = last.nextCursor;
      if (cursor) cursors.push(cursor);
    } while (!last.complete && ++calls < 20);
    expect(last.complete).toBe(true);
    expect(rows, "rows visited over the chain equals the stale rows that exist").toBe(TOTAL_ROWS);
    expect(users).toBe(5);
    expect(visitedUsers, "every user once, in order").toEqual(["u1", "u2", "u3", "u4", "u5"]);
    expect(cursors, "the cursor strictly increases").toEqual([...cursors].sort().filter((c, i, a) => a.indexOf(c) === i));
  });

  it("one call with no maxRows visits everything and reports the same total", async () => {
    const { rescoreStale } = await load();
    const v = await rescoreStale(deps([]), { dryRun: true });
    expect(v.rowsVisited).toBe(TOTAL_ROWS);
    expect(v.usersVisited).toBe(5);
    expect(v.complete).toBe(true);
  });
});
