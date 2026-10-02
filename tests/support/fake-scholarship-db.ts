/**
 * An in-memory stand-in for the `scholarships` table behind the Supabase query builder (send-508).
 *
 * It EVALUATES the PostgREST filters a call site really sends (`.or("close_at.is.null,close_at.gt.<iso>")`, `.gt`, `.lte`, `.not(c,"is",null)`,
 * `.eq`, `.contains`), so a test can put a row on either side of a closing instant and see whether the site includes it. A mock that only
 * records calls proves a function called the client, never what it would have returned.
 *
 * Rows get `close_at` the way the database trigger gives it (scholarshipCloseInstant), so what the sites filter on is what production holds.
 * An operator it does not know throws, so a new filter shape fails loudly instead of being silently ignored.
 */
import { scholarshipCloseInstant } from "@/lib/scholarships/close-instant";

export interface FakeScholarship {
  id: string;
  moderation_status: "verified" | "pending";
  funding_type: "full" | "partial";
  degree_levels: string[];
  application_deadline: string | null;
  close_time: string | null;
  close_tz: string | null;
  close_at: string | null;
  [key: string]: unknown;
}

export function scholarship(over: Partial<FakeScholarship> & { id: string }): FakeScholarship {
  const row: FakeScholarship = {
    moderation_status: "verified",
    funding_type: "full",
    degree_levels: ["msc"],
    application_deadline: null,
    close_time: null,
    close_tz: null,
    close_at: null,
    provider: "P",
    program_name: "N",
    ...over,
  };
  row.close_at = scholarshipCloseInstant(row)?.toISOString() ?? null;
  return row;
}

type Cmp = (a: unknown, b: string) => boolean;
const cmp = (a: unknown, b: string, op: (x: number, y: number) => boolean): boolean => {
  if (a === null || a === undefined) return false;
  const left = typeof a === "string" && /^\d{4}-\d{2}-\d{2}T/.test(a) ? Date.parse(a) : a;
  const right = /^\d{4}-\d{2}-\d{2}T/.test(b) ? Date.parse(b) : b;
  if (typeof left === "number" && typeof right === "number") return op(left, right);
  return op(String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0, 0);
};
const OPS: Record<string, Cmp> = {
  gt: (a, b) => cmp(a, b, (x, y) => x > y),
  gte: (a, b) => cmp(a, b, (x, y) => x >= y),
  lt: (a, b) => cmp(a, b, (x, y) => x < y),
  lte: (a, b) => cmp(a, b, (x, y) => x <= y),
};

function evalOr(row: FakeScholarship, expr: string): boolean {
  return expr.split(",").some((clause) => {
    const m = /^([a-z_]+)\.(is|gt|gte|lt|lte)\.(.+)$/.exec(clause);
    if (!m) throw new Error(`fake-scholarship-db: unsupported .or() clause "${clause}"`);
    const [, col, op, value] = m;
    if (op === "is") {
      if (value !== "null") throw new Error(`fake-scholarship-db: unsupported .is value ${value}`);
      return row[col] === null || row[col] === undefined;
    }
    return OPS[op](row[col], value);
  });
}

export interface FakeClient {
  from: (table: string) => unknown;
  rpc: (fn: string, args: Record<string, unknown>) => { single: () => Promise<{ data: unknown; error: null }> };
  calls: { rpc: Array<{ fn: string; args: Record<string, unknown> }> };
}

/** `rows` back the `scholarships` table; every other table answers empty. */
export function fakeClient(rows: FakeScholarship[], rpcResult: unknown = {}): FakeClient {
  const calls: FakeClient["calls"] = { rpc: [] };
  return {
    calls,
    rpc(fn, args) {
      calls.rpc.push({ fn, args });
      return { single: async () => ({ data: rpcResult, error: null }) };
    },
    from(table: string) {
      if (table !== "scholarships") {
        // Every other table answers empty, to whatever chain a caller builds (.is, .ilike, .or, .gte ...).
        const empty: Record<string, unknown> = new Proxy(
          {},
          {
            get: (_t, prop) => {
              if (prop === "then") return (ok?: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(ok, fail);
              return () => empty;
            },
          },
        );
        return empty;
      }
      const filters: Array<(r: FakeScholarship) => boolean> = [];
      let limit = Infinity;
      let headOnly = false;
      const chain: Record<string, unknown> = {
        select: (_cols?: string, opts?: { head?: boolean }) => {
          headOnly = !!opts?.head;
          return chain;
        },
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), chain),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), chain),
        contains: (c: string, v: unknown[]) => (filters.push((r) => Array.isArray(r[c]) && v.every((x) => (r[c] as unknown[]).includes(x))), chain),
        or: (expr: string) => (filters.push((r) => evalOr(r, expr)), chain),
        not: (c: string, op: string, v: unknown) => {
          if (op !== "is" || v !== null) throw new Error(`fake-scholarship-db: unsupported .not(${c}, ${op})`);
          filters.push((r) => r[c] !== null && r[c] !== undefined);
          return chain;
        },
        gt: (c: string, v: string) => (filters.push((r) => OPS.gt(r[c], v)), chain),
        gte: (c: string, v: string) => (filters.push((r) => OPS.gte(r[c], v)), chain),
        lt: (c: string, v: string) => (filters.push((r) => OPS.lt(r[c], v)), chain),
        lte: (c: string, v: string) => (filters.push((r) => OPS.lte(r[c], v)), chain),
        order: () => chain,
        limit: (n: number) => ((limit = n), chain),
        range: (from: number, to: number) => ((limit = to - from + 1), chain),
        // A real thenable: callers chain `.then(cb)` and expect a promise back (the sitemap does).
        then: (ok?: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => {
          const matched = rows.filter((r) => filters.every((f) => f(r)));
          return Promise.resolve({ data: headOnly ? null : matched.slice(0, limit), count: matched.length, error: null }).then(ok, fail);
        },
      };
      return chain;
    },
  };
}
