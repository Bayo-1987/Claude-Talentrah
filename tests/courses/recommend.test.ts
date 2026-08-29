import { describe, expect, it, vi } from "vitest";
import { recommendCoursesForGapAnalysis } from "@/lib/courses/recommend";
import { ALTSCHOOL_SEED } from "@/lib/courses/seed-catalog";
import type { GapAnalysisItem } from "@/lib/tailoring/types";

/**
 * The catalog query layer. The ranking itself is covered exhaustively in
 * match.test.ts against fixtures; what is worth proving here is the behaviour
 * that only exists because a database is involved — the short-circuit, the
 * active filter, and above all that a failed query cannot take a paid
 * tailoring run down with it.
 */

const ROWS = ALTSCHOOL_SEED.map((row, i) => ({ ...row, id: `seed-${i}`, active: true }));

/**
 * Minimal stand-in for the PostgREST builder: `.select().eq()` resolves to
 * `{ data, error }`. Records the calls so the query itself can be asserted
 * rather than assumed.
 */
function fakeSupabase({
  data = ROWS,
  error = null,
}: { data?: unknown; error?: unknown } = {}) {
  const calls: { table?: string; select?: string; eq?: [string, unknown] } = {};
  const client = {
    from(table: string) {
      calls.table = table;
      return {
        select(cols: string) {
          calls.select = cols;
          return {
            eq(col: string, val: unknown) {
              calls.eq = [col, val];
              return Promise.resolve({ data, error });
            },
          };
        },
      };
    },
  };
  // The helper only ever uses from/select/eq; the cast keeps the fake honest
  // about that rather than pulling in the whole generated client type.
  return { client: client as never, calls };
}

function gap(keyword: string, status: GapAnalysisItem["status"] = "missing"): GapAnalysisItem {
  return { keyword, status };
}

describe("querying the catalog for a gap analysis", () => {
  it("asks only for active rows, from the right table", async () => {
    const { client, calls } = fakeSupabase();
    await recommendCoursesForGapAnalysis(client, [gap("SQL")]);
    expect(calls.table).toBe("course_recommendations");
    expect(calls.eq).toEqual(["active", true]);
    // The ranker needs every one of these; a narrower select would make it
    // silently mis-rank rather than fail.
    for (const col of ["id", "skill_tag", "provider", "title", "affiliate_url", "price_tier"]) {
      expect(calls.select).toContain(col);
    }
  });

  it("does not touch the database when nothing is missing", async () => {
    const { client, calls } = fakeSupabase();
    const result = await recommendCoursesForGapAnalysis(client, [
      gap("SQL", "matched"),
      gap("React", "matched"),
    ]);
    expect(result).toEqual([]);
    expect(calls.table).toBeUndefined();
  });

  it("returns an empty list — not a throw — when the query errors", async () => {
    /*
     * THE POINT OF THIS MODULE. By the time it runs, the user has been charged
     * and the model has produced a result. A catalog outage must cost them a
     * suggestion, not the thing they paid for.
     */
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeSupabase({ data: null, error: { message: "boom" } });
    await expect(recommendCoursesForGapAnalysis(client, [gap("SQL")])).resolves.toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("survives a null data payload with no error", async () => {
    const { client } = fakeSupabase({ data: null, error: null });
    await expect(recommendCoursesForGapAnalysis(client, [gap("SQL")])).resolves.toEqual([]);
  });

  it("ranks what it gets back, capped at two by default", async () => {
    const { client } = fakeSupabase();
    const result = await recommendCoursesForGapAnalysis(client, [
      gap("SQL"),
      gap("React.js"),
      gap("Python"),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].course.skill_tag).toBe("sql");
    expect(result[0].matchedKeyword).toBe("SQL");
  });

  it("honours an explicit limit", async () => {
    const { client } = fakeSupabase();
    const result = await recommendCoursesForGapAnalysis(client, [gap("SQL"), gap("React")], 1);
    expect(result).toHaveLength(1);
  });

  it("returns nothing when the missing keywords match no seeded course", async () => {
    const { client } = fakeSupabase();
    const result = await recommendCoursesForGapAnalysis(client, [
      gap("Blockchain"),
      gap("Welding"),
    ]);
    expect(result).toEqual([]);
  });
});
