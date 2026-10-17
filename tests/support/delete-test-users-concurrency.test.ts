/**
 * deleteTestUsers (tests/support/auth.ts) used to start EVERY deleteUser call and every release_test_pool_user call at once (Promise.all over all ids). tests/admin/people-signups-qa-filter.test.ts creates 68 real
 * auth users and its afterAll passes all 68, so 68 requests hit the CI job's local auth service together, and the teardown line "N/68 test accounts could not be released/deleted ... Database error loading
 * user" appeared on most runs after that file landed. Cleanup now runs with at most 5 requests in flight (the same limit the creation side uses). The return value, the log lines, and the rule that a failed
 * delete or release is collected and REPORTED, never thrown, are unchanged. The Supabase client is faked (a stub installed where `admin` is created), so this needs no database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  pooled: new Set<string>(),
  inFlight: 0,
  maxInFlight: 0,
  deleted: [] as string[],
  released: [] as { id: string; lease: unknown }[],
  rejectIds: new Set<string>(),
  errorIds: new Set<string>(),
  fromCalls: 0,
  deleteCalls: 0,
  rpcCalls: 0,
}));

const tick = async <T>(value: T): Promise<T> => {
  h.inFlight += 1;
  h.maxInFlight = Math.max(h.maxInFlight, h.inFlight);
  await new Promise((r) => setTimeout(r, 8));
  h.inFlight -= 1;
  return value;
};

vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: () => ({
    from: () => {
      h.fromCalls += 1;
      return {
        select: () => ({
          in: async (_col: string, ids: string[]) => ({ data: ids.filter((id) => h.pooled.has(id)).map((user_id) => ({ user_id })), error: null }),
        }),
      };
    },
    rpc: (_name: string, args: { p_user_id: string; p_lease_id: unknown }) => {
      h.rpcCalls += 1;
      return tick({ error: null }).then((r) => (h.released.push({ id: args.p_user_id, lease: args.p_lease_id }), r));
    },
    auth: {
      admin: {
        deleteUser: (id: string) => {
          h.deleteCalls += 1;
          return tick(null).then(() => {
            if (h.rejectIds.has(id)) throw new Error(`Database error loading user (${id})`);
            if (h.errorIds.has(id)) return { error: { message: `Database error deleting user (${id})` } };
            h.deleted.push(id);
            return { error: null };
          });
        },
      },
    },
  }),
}));

import { deleteTestUsers } from "./auth";

const ids = (n: number, prefix = "u") => Array.from({ length: n }, (_, i) => `${prefix}-${String(i).padStart(2, "0")}`);
let written: string[];

beforeEach(() => {
  h.pooled = new Set();
  h.inFlight = 0;
  h.maxInFlight = 0;
  h.deleted = [];
  h.released = [];
  h.rejectIds = new Set();
  h.errorIds = new Set();
  h.fromCalls = 0;
  h.deleteCalls = 0;
  h.rpcCalls = 0;
  written = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => (written.push(String(chunk)), true)) as typeof process.stdout.write);
});
afterEach(() => vi.restoreAllMocks());

describe("1. the number of requests in flight is bounded", () => {
  it("40 unpooled ids: at most 5 deleteUser calls run at once, and all 40 are deleted", async () => {
    const all = ids(40);
    await deleteTestUsers(all);
    expect(h.maxInFlight).toBeGreaterThan(1); // the stub really overlaps calls, so the bound below means something
    expect(h.maxInFlight).toBeLessThanOrEqual(5);
    expect([...h.deleted].sort()).toEqual(all);
  });
  it("40 pooled ids: at most 5 release calls run at once, and all 40 are released", async () => {
    const all = ids(40, "p");
    h.pooled = new Set(all);
    await deleteTestUsers(all);
    expect(h.maxInFlight).toBeGreaterThan(1);
    expect(h.maxInFlight).toBeLessThanOrEqual(5);
    expect(h.released.map((r) => r.id).sort()).toEqual(all);
  });
});

describe("2. pooled and unpooled ids still take their own path", () => {
  it("a pooled id is released (with the run's lease), an unpooled id is deleted, and neither is sent down the other path", async () => {
    h.pooled = new Set(["pool-1", "pool-2"]);
    await deleteTestUsers(["pool-1", "plain-1", "pool-2", "plain-2"]);
    expect(h.released.map((r) => r.id).sort()).toEqual(["pool-1", "pool-2"]);
    expect(h.released.every((r) => typeof r.lease === "string" && r.lease !== "")).toBe(true);
    expect(h.deleted.sort()).toEqual(["plain-1", "plain-2"]);
    expect(written.join("")).toMatch(/releasing pooled user=pool-1/);
    expect(written.join("")).toMatch(/deleting user=plain-1/);
  });
});

describe("3. failures are collected and reported, never thrown", () => {
  it("3 rejections and 2 error objects among 40: the call resolves and the failure line names all 5 ids", async () => {
    const all = ids(40);
    const rejected = [all[3], all[17], all[29]];
    const errored = [all[8], all[35]];
    h.rejectIds = new Set(rejected);
    h.errorIds = new Set(errored);
    await expect(deleteTestUsers(all)).resolves.toBeUndefined();
    const line = written.find((l) => l.startsWith("[cleanup]")) ?? "";
    expect(line).toContain("5/40 test accounts could not be released/deleted");
    for (const id of [...rejected, ...errored]) expect(line).toContain(id);
    expect(h.deleted).toHaveLength(35);
    expect(h.maxInFlight).toBeLessThanOrEqual(5);
  });
  it("no failure: no failure line", async () => {
    await deleteTestUsers(ids(7));
    expect(written.some((l) => l.startsWith("[cleanup]"))).toBe(false);
  });
});

describe("4. an empty list", () => {
  it("returns at once and calls nothing", async () => {
    await expect(deleteTestUsers([])).resolves.toBeUndefined();
    expect(h.fromCalls + h.deleteCalls + h.rpcCalls).toBe(0);
    expect(written).toEqual([]);
  });
});
