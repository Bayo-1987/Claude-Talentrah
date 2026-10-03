/**
 * Retention for the homepage-demo attempt log (0208): rows older than 90 days are purged, in bounded batches, by id.
 * No personal data is in the table, but an attempt log should not grow forever.
 *
 * Unit-level here, against an in-memory fake of exactly the PostgREST calls the purge makes, so the SHAPE of the work
 * is pinned (strict cutoff, batch size, delete by id with the predicate re-asserted, a fixed number of rounds). The
 * same behaviour against the real table, with real created_at values, is tests/demo/attempt-retention-db.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  ATTEMPT_RETENTION_DAYS,
  PURGE_BATCH_SIZE,
  PURGE_MAX_ROUNDS,
  purgeOldDemoAttempts,
} from "@/lib/demo/attempt-retention";

const DAY = 86_400_000;
const NOW = new Date("2026-10-02T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString();

type Row = { id: string; created_at: string };

/** In-memory stand-in for `.from("anonymous_demo_attempts")`, recording every call so tests can assert the shape. */
function fakeClient(rows: Row[], opts: { failDeleteOnRound?: number } = {}) {
  const calls: { op: string; args: unknown[] }[] = [];
  let deleteRounds = 0;
  const table = {
    select(cols: string) {
      calls.push({ op: "select", args: [cols] });
      let cutoff: string | null = null;
      let limit = Infinity;
      const b: Record<string, unknown> = {
        lt(col: string, v: string) {
          calls.push({ op: "select.lt", args: [col, v] });
          cutoff = v;
          return b;
        },
        order(col: string, o: unknown) {
          calls.push({ op: "select.order", args: [col, o] });
          return b;
        },
        limit(n: number) {
          calls.push({ op: "select.limit", args: [n] });
          limit = n;
          return b;
        },
        then(resolve: (v: unknown) => void) {
          const eligible = rows.filter((r) => cutoff !== null && r.created_at < cutoff).sort((a, c) => a.created_at.localeCompare(c.created_at));
          resolve({ data: eligible.slice(0, limit).map((r) => ({ id: r.id })), error: null });
        },
      };
      return b;
    },
    delete() {
      calls.push({ op: "delete", args: [] });
      let ids: string[] | null = null;
      let cutoff: string | null = null;
      const b: Record<string, unknown> = {
        in(col: string, v: string[]) {
          calls.push({ op: "delete.in", args: [col, v] });
          ids = v;
          return b;
        },
        lt(col: string, v: string) {
          calls.push({ op: "delete.lt", args: [col, v] });
          cutoff = v;
          return b;
        },
        select(cols: string) {
          calls.push({ op: "delete.select", args: [cols] });
          return b;
        },
        then(resolve: (v: unknown) => void) {
          deleteRounds += 1;
          if (opts.failDeleteOnRound === deleteRounds) return resolve({ data: null, error: { message: "boom" } });
          const gone = rows.filter((r) => ids?.includes(r.id) && (cutoff === null || r.created_at < cutoff));
          for (const g of gone) rows.splice(rows.indexOf(g), 1);
          resolve({ data: gone.map((r) => ({ id: r.id })), error: null });
        },
      };
      return b;
    },
  };
  const client = {
    from(name: string) {
      calls.push({ op: "from", args: [name] });
      return table;
    },
  };
  return { client, calls, rows };
}

const mk = (n: number, age: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `id-${age}-${i}`, created_at: daysAgo(age) }));

describe("the retention constants are the agreed ones", () => {
  it("90 days, 1,000 per batch, a fixed number of rounds per run", () => {
    expect(ATTEMPT_RETENTION_DAYS).toBe(90);
    expect(PURGE_BATCH_SIZE).toBe(1000);
    expect(PURGE_MAX_ROUNDS).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(PURGE_MAX_ROUNDS)).toBe(true);
  });
});

describe("what is deleted", () => {
  it("a row at 91 days is deleted", async () => {
    const f = fakeClient([...mk(1, 91)]);
    const r = await purgeOldDemoAttempts({ now: NOW, client: f.client as never });
    expect(r.deleted).toBe(1);
    expect(f.rows).toHaveLength(0);
  });

  it("a row at 89 days is KEPT", async () => {
    const f = fakeClient([...mk(1, 89)]);
    const r = await purgeOldDemoAttempts({ now: NOW, client: f.client as never });
    expect(r.deleted).toBe(0);
    expect(f.rows).toHaveLength(1);
  });

  it("a mixed table: only the old rows go, the recent ones stay", async () => {
    const f = fakeClient([...mk(3, 120), ...mk(2, 91), ...mk(4, 89), ...mk(5, 1), ...mk(2, 0)]);
    const r = await purgeOldDemoAttempts({ now: NOW, client: f.client as never });
    expect(r.deleted).toBe(5);
    expect(f.rows).toHaveLength(11);
    expect(f.rows.every((x) => x.created_at >= daysAgo(90))).toBe(true);
  });

  it("the cutoff is STRICT: a row exactly 90 days old is kept, one a millisecond older is deleted", async () => {
    const exact: Row = { id: "exact", created_at: daysAgo(90) };
    const older: Row = { id: "older", created_at: new Date(NOW.getTime() - 90 * DAY - 1).toISOString() };
    const f = fakeClient([exact, older]);
    const r = await purgeOldDemoAttempts({ now: NOW, client: f.client as never });
    expect(r.deleted).toBe(1);
    expect(f.rows.map((x) => x.id)).toEqual(["exact"]);
    expect(r.cutoff).toBe(daysAgo(90));
  });

  it("an empty table is a no-op that reports zeros, not an error", async () => {
    const f = fakeClient([]);
    expect(await purgeOldDemoAttempts({ now: NOW, client: f.client as never })).toEqual({ cutoff: daysAgo(90), deleted: 0, rounds: 0, hitCap: false });
  });
});

describe("how it deletes", () => {
  it("selects ids older than the cutoff in batches, and deletes BY ID (never an unfiltered delete)", async () => {
    const f = fakeClient(mk(7, 100));
    await purgeOldDemoAttempts({ now: NOW, client: f.client as never, batchSize: 5 });
    const ops = f.calls.map((c) => c.op);
    expect(ops.filter((o) => o === "delete")).toHaveLength(ops.filter((o) => o === "delete.in").length);
    expect(ops.filter((o) => o === "delete").length).toBeGreaterThan(0);
    for (const c of f.calls.filter((x) => x.op === "select.limit")) expect(c.args[0]).toBe(5);
    for (const c of f.calls.filter((x) => x.op === "delete.in")) {
      expect(c.args[0]).toBe("id");
      expect((c.args[1] as string[]).length).toBeLessThanOrEqual(5);
    }
  });

  it("re-asserts the age predicate inside every delete, so a row cannot be removed that stopped being old", async () => {
    const f = fakeClient(mk(3, 100));
    await purgeOldDemoAttempts({ now: NOW, client: f.client as never });
    const deletes = f.calls.filter((c) => c.op === "delete.lt");
    expect(deletes.length).toBeGreaterThan(0);
    for (const d of deletes) expect(d.args).toEqual(["created_at", daysAgo(90)]);
  });

  it("touches only anonymous_demo_attempts", async () => {
    const f = fakeClient(mk(2, 100));
    await purgeOldDemoAttempts({ now: NOW, client: f.client as never });
    expect([...new Set(f.calls.filter((c) => c.op === "from").map((c) => c.args[0]))]).toEqual(["anonymous_demo_attempts"]);
  });
});

describe("the batch cap holds", () => {
  it("25 old rows, batch 10, 2 rounds: exactly 20 are deleted, it says it hit the cap, and a third round is never started", async () => {
    const f = fakeClient(mk(25, 100));
    const r = await purgeOldDemoAttempts({ now: NOW, client: f.client as never, batchSize: 10, maxRounds: 2 });
    expect(r).toMatchObject({ deleted: 20, rounds: 2, hitCap: true });
    expect(f.rows).toHaveLength(5);
    expect(f.calls.filter((c) => c.op === "delete")).toHaveLength(2);
  });

  it("the next run continues where the cap stopped it, and the second run reports it is done", async () => {
    const f = fakeClient(mk(25, 100));
    await purgeOldDemoAttempts({ now: NOW, client: f.client as never, batchSize: 10, maxRounds: 2 });
    const second = await purgeOldDemoAttempts({ now: NOW, client: f.client as never, batchSize: 10, maxRounds: 2 });
    expect(second).toMatchObject({ deleted: 5, hitCap: false });
    expect(f.rows).toHaveLength(0);
  });

  it("exactly one full batch of rows, with room for more rounds: it checks once more, finds nothing, and does not claim the cap", async () => {
    const f = fakeClient(mk(10, 100));
    const r = await purgeOldDemoAttempts({ now: NOW, client: f.client as never, batchSize: 10, maxRounds: 5 });
    expect(r).toMatchObject({ deleted: 10, hitCap: false });
  });

  it("stops as soon as a batch comes back short (no wasted rounds)", async () => {
    const f = fakeClient(mk(3, 100));
    const r = await purgeOldDemoAttempts({ now: NOW, client: f.client as never, batchSize: 10, maxRounds: 50 });
    expect(r).toMatchObject({ deleted: 3, rounds: 1, hitCap: false });
  });

  it("with the defaults it can never run unbounded: at most PURGE_MAX_ROUNDS x PURGE_BATCH_SIZE rows per run", async () => {
    const f = fakeClient(mk(PURGE_MAX_ROUNDS * PURGE_BATCH_SIZE + 500, 100));
    const r = await purgeOldDemoAttempts({ now: NOW, client: f.client as never });
    expect(r.deleted).toBe(PURGE_MAX_ROUNDS * PURGE_BATCH_SIZE);
    expect(r.hitCap).toBe(true);
    expect(f.rows).toHaveLength(500);
  });
});

describe("failure", () => {
  it("a failed delete is REPORTED, with what was already deleted, and stops (it does not swallow the error)", async () => {
    const f = fakeClient(mk(25, 100), { failDeleteOnRound: 2 });
    const r = await purgeOldDemoAttempts({ now: NOW, client: f.client as never, batchSize: 10, maxRounds: 5 });
    expect(r.error).toMatch(/boom/);
    expect(r.deleted).toBe(10);
    expect(f.calls.filter((c) => c.op === "delete")).toHaveLength(2);
  });
});
