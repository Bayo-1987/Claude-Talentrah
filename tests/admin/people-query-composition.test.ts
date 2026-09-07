/**
 * Does the query actually apply what the filters say?
 *
 * The pure tests next door prove the arithmetic and the projection. They cannot
 * prove that `listSignups` puts those values onto the query — a page that
 * computed a perfect range and then forgot to call `.range()` would pass every
 * one of them and return the whole table.
 *
 * There is no database available in this environment (no Docker, no Supabase
 * CLI, and the hosted project is paused), so this stands in a recording client
 * and asserts the calls. That is weaker than running it: it proves the builder
 * is driven correctly, not that Postgres answers correctly. The PR body says so
 * plainly rather than letting a green tick imply more.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

interface Recorded {
  table: string;
  select?: [string, unknown];
  calls: Array<[string, unknown[]]>;
}

const recorded: Recorded[] = [];
/** Rows the fake returns for the main query, and the count it reports. */
let mainRows: Record<string, unknown>[] = [];
let mainCount = 0;
let referrerRows: { id: string; email: string }[] = [];

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      const entry: Recorded = { table, calls: [] };
      recorded.push(entry);

      const isReferrerLookup = () => entry.calls.some(([m]) => m === "in");

      const chain: Record<string, unknown> = {
        select(cols: string, opts?: unknown) {
          entry.select = [cols, opts];
          return chain;
        },
        then(resolve: (v: unknown) => void) {
          // Whichever query it turned out to be, answered the way PostgREST
          // would: `{ data, error, count }`.
          return Promise.resolve(
            isReferrerLookup()
              ? { data: referrerRows, error: null, count: referrerRows.length }
              : { data: mainRows, error: null, count: mainCount },
          ).then(resolve);
        },
      };
      for (const method of ["order", "range", "ilike", "gte", "lt", "lte", "gt", "eq", "in"]) {
        chain[method] = (...args: unknown[]) => {
          entry.calls.push([method, args]);
          return chain;
        };
      }
      return chain;
    },
  }),
}));

const { listSignups, countSignupsSince } = await import("@/lib/admin/people/queries");
const { PAGE_SIZE } = await import("@/lib/admin/people/signups");

const main = () => recorded[0];
const callArgs = (entry: Recorded, method: string) =>
  entry.calls.filter(([m]) => m === method).map(([, a]) => a);

beforeEach(() => {
  recorded.length = 0;
  mainRows = [];
  mainCount = 0;
  referrerRows = [];
});

describe("the list query", () => {
  it("asks for one page, newest first, with an exact count", async () => {
    await listSignups({ page: 2 });

    expect(main().table).toBe("profiles");
    expect(main().select?.[1]).toEqual({ count: "exact" });
    expect(callArgs(main(), "order")[0]).toEqual(["created_at", { ascending: false }]);
    // Page 2 of 50 is rows 50..99 inclusive — not 50..100, which would overlap
    // page 3 and return 51 rows.
    expect(callArgs(main(), "range")[0]).toEqual([PAGE_SIZE, PAGE_SIZE * 2 - 1]);
  });

  it("applies NO filters when none were given", async () => {
    await listSignups({ page: 1 });
    // A stray always-on filter here would quietly hide people from the list.
    expect(callArgs(main(), "ilike")).toHaveLength(0);
    expect(callArgs(main(), "gte")).toHaveLength(0);
    expect(callArgs(main(), "lt")).toHaveLength(0);
  });

  it("composes email, both date bounds and paging together", async () => {
    await listSignups({ page: 3, email: "ada@", from: "2026-09-01", to: "2026-09-07" });

    expect(callArgs(main(), "ilike")[0]).toEqual(["email", "%ada@%"]);
    expect(callArgs(main(), "gte")[0]).toEqual(["created_at", "2026-09-01T00:00:00.000Z"]);
    // Half-open upper bound, so the whole of the 7th is included.
    expect(callArgs(main(), "lt")[0]).toEqual(["created_at", "2026-09-08T00:00:00.000Z"]);
    expect(callArgs(main(), "range")[0]).toEqual([PAGE_SIZE * 2, PAGE_SIZE * 3 - 1]);

    // All four on ONE query object — filters landing on separate builders
    // would silently drop all but the last.
    expect(main().calls.map(([m]) => m)).toEqual(
      expect.arrayContaining(["order", "range", "ilike", "gte", "lt"]),
    );
  });

  it("reports a page count from the filtered total, not the table", async () => {
    mainRows = [{ id: "a", email: "a@b.c", created_at: "t" }];
    mainCount = 120;
    const result = await listSignups({ page: 1 });
    expect(result.total).toBe(120);
    expect(result.pageCount).toBe(3); // ceil(120 / 50)
  });

  it("resolves referrer emails for the rows on this page only", async () => {
    mainRows = [
      { id: "a", email: "a@b.c", created_at: "t", referred_by: "ref-1" },
      { id: "b", email: "b@b.c", created_at: "t", referred_by: "ref-1" },
      { id: "c", email: "c@b.c", created_at: "t", referred_by: null },
    ];
    mainCount = 3;
    referrerRows = [{ id: "ref-1", email: "referrer@example.com" }];

    const result = await listSignups({ page: 1 });

    const lookup = recorded[1];
    expect(lookup, "expected a second query for referrer emails").toBeDefined();
    // Deduplicated, and scoped to ids already on screen — this must not become
    // a second way to enumerate.
    expect(callArgs(lookup, "in")[0]).toEqual(["id", ["ref-1"]]);
    expect(lookup.select?.[0]).toBe("id, email");

    expect(result.rows[0].referredByEmail).toBe("referrer@example.com");
    expect(result.rows[2].referredByEmail).toBeNull();
  });

  it("does not run a referrer query when nobody was referred", async () => {
    mainRows = [{ id: "a", email: "a@b.c", created_at: "t", referred_by: null }];
    mainCount = 1;
    await listSignups({ page: 1 });
    expect(recorded).toHaveLength(1);
  });
});

describe("the new-signups counter", () => {
  it("counts only, fetching no rows at all", async () => {
    mainCount = 7;
    const n = await countSignupsSince("2026-09-07T12:00:00.000Z");

    expect(n).toBe(7);
    // `head: true` is what makes this safe to poll: it returns a number and no
    // personal data, which is why it is exempt from the audit entry.
    expect(main().select?.[1]).toEqual({ count: "exact", head: true });
    expect(callArgs(main(), "gt")[0]).toEqual(["created_at", "2026-09-07T12:00:00.000Z"]);
  });
});
