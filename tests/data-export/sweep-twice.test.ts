/**
 * Two sweeps that overlap (a Vercel cron and the GitHub workflow can both fire, and a cron can be delivered twice) must behave like one: each object is removed once, each row is marked once,
 * exactly one people.export_deleted row is written per deletion, and neither run reports an alert. Real local database and bucket; the bucket lock keeps other files out.
 *
 * The overlap is made certain, not left to timing: a barrier holds the FIRST storage remove of each run until both runs have reached it, so both have already read the same rows / listed the same
 * objects before either one acts.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { acquireBucketLock, releaseBucketLock } from "../support/bucket-lock";
import { auditRowsSince, bucketPaths, cleanupAll, countedService, emptyBucket, flags, makePerson, putObject, releaseCreated } from "../support/data-export-fixtures";
import { ageAttempt, getRow, insertGenerating, pathFor, setRow, finish } from "../support/data-export-db";
import { sweepDataExports, type SweepSummary } from "@/lib/data-export/sweep";

vi.mock("@/lib/supabase/service-role", async () => {
  const { countedService } = await import("../support/data-export-fixtures");
  return { createServiceRoleClient: () => countedService().client };
});

beforeAll(async () => {
  await acquireBucketLock();
  await emptyBucket();
}, 300_000);
beforeEach(async () => {
  flags.failRemove = 0;
  flags.failAuditInsert = false;
  await emptyBucket();
});
afterEach(releaseCreated, 60_000);
afterAll(async () => {
  try {
    await cleanupAll();
  } finally {
    releaseBucketLock();
  }
}, 120_000);

/** A barrier for `parties` runs: resolves when all have arrived, or after `timeoutMs` so a run that never reaches it cannot hang the test. */
function barrier(parties = 2, timeoutMs = 4000) {
  let arrived = 0;
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  const timer = setTimeout(open, timeoutMs);
  return async () => {
    arrived += 1;
    if (arrived >= parties) {
      clearTimeout(timer);
      open();
    }
    await opened;
  };
}

/** The service client, with the first storage remove of THIS client held at the barrier. */
function gatedClient(wait: () => Promise<void>) {
  const base = countedService().client;
  let held = false;
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "storage") {
        return {
          from: (bucket: string) => {
            const files = target.storage.from(bucket);
            return new Proxy(files, {
              get(ft, fp) {
                if (fp === "remove") {
                  return async (paths: string[]) => {
                    if (!held) {
                      held = true;
                      await wait();
                    }
                    return ft.remove(paths);
                  };
                }
                const v = Reflect.get(ft, fp);
                return typeof v === "function" ? v.bind(ft) : v;
              },
            });
          },
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/** Two sweeps at the same moment, overlapping on their first removal. */
async function twoSweeps(): Promise<[SweepSummary, SweepSummary]> {
  const wait = barrier();
  return Promise.all([sweepDataExports(gatedClient(wait)), sweepDataExports(gatedClient(wait))]);
}

const sum = (pair: [SweepSummary, SweepSummary], key: keyof SweepSummary) => Number(pair[0][key]) + Number(pair[1][key]);
const deletedFor = async (exportId: string) => (await auditRowsSince()).filter((r) => r.action === "people.export_deleted" && (r.detail as { export_id?: string } | null)?.export_id === exportId);
const reasons = (rows: Awaited<ReturnType<typeof deletedFor>>) => rows.map((r) => (r.detail as { reason: string }).reason).sort();

describe("two overlapping sweeps behave like one", () => {
  it("an expired generated export: removed once, marked expired once, ONE audit row, no alert from either run", async () => {
    const p = await makePerson();
    const g = await insertGenerating(p.id);
    await putObject(pathFor(g.id, g.attempt));
    await finish(g.id, g.attempt);
    await setRow(g.id, { expires_at: new Date(Date.now() - 1000).toISOString() });

    const pair = await twoSweeps();
    expect(await bucketPaths()).toEqual([]);
    expect((await getRow(g.id))!.status).toBe("expired");
    expect(reasons(await deletedFor(g.id))).toEqual(["expired"]);
    expect(sum(pair, "expired")).toBe(1);
    expect(sum(pair, "alerts"), "neither run reports an alert").toBe(0);
    expect(pair.every((s) => s.ok)).toBe(true);
  });

  it("a failed attempt's row (with an object left behind): cleaned once, ONE audit row, no alert", async () => {
    const p = await makePerson();
    const g = await insertGenerating(p.id);
    await putObject(pathFor(g.id, g.attempt));
    await setRow(g.id, { status: "failed" });

    const pair = await twoSweeps();
    expect(await bucketPaths()).toEqual([]);
    const row = (await getRow(g.id))!;
    expect(row.status).toBe("failed");
    expect(row.deleted_at).toBeTruthy();
    expect(reasons(await deletedFor(g.id))).toEqual(["failed"]);
    expect(sum(pair, "failedCleaned")).toBe(1);
    expect(sum(pair, "alerts")).toBe(0);
  });

  it("an orphan object (no row at all): removed once, counted once, ONE audit row", async () => {
    const orphan = `${randomUUID()}/${randomUUID()}.json`;
    await putObject(orphan);

    const pair = await twoSweeps();
    expect(await bucketPaths()).toEqual([]);
    const rows = (await auditRowsSince()).filter((r) => r.action === "people.export_deleted" && (r.detail as { reason?: string } | null)?.reason === "orphan");
    expect(rows).toHaveLength(1);
    expect(sum(pair, "orphansDeleted")).toBe(1);
    expect(sum(pair, "alerts")).toBe(0);
  });

  it("a claimed export whose delete never finished: cleaned once, marked deleted once, ONE audit row, no alert", async () => {
    const p = await makePerson();
    const g = await insertGenerating(p.id);
    await putObject(pathFor(g.id, g.attempt));
    await finish(g.id, g.attempt);
    await setRow(g.id, { status: "downloaded", claimed_at: new Date(Date.now() - 20 * 60_000).toISOString() });

    const pair = await twoSweeps();
    expect(await bucketPaths()).toEqual([]);
    expect((await getRow(g.id))!.status).toBe("deleted");
    expect(reasons(await deletedFor(g.id))).toEqual(["downloaded"]);
    expect(sum(pair, "downloadedCleaned")).toBe(1);
    expect(sum(pair, "alerts")).toBe(0);
  });

  it("a stale generating export: cancelled once, and the audit rows are exactly what ONE sweep writes for the same state", async () => {
    // The baseline: one sweep alone on an identical fixture.
    const p1 = await makePerson();
    const solo = await insertGenerating(p1.id);
    await putObject(pathFor(solo.id, solo.attempt));
    await ageAttempt(solo.id, 30);
    const alone = await sweepDataExports(countedService().client);
    const baseline = reasons(await deletedFor(solo.id));
    expect(alone.staleCancelled).toBe(1);

    const p2 = await makePerson();
    const twin = await insertGenerating(p2.id);
    await putObject(pathFor(twin.id, twin.attempt));
    await ageAttempt(twin.id, 30);
    const pair = await twoSweeps();
    expect(sum(pair, "staleCancelled")).toBe(1);
    expect(reasons(await deletedFor(twin.id))).toEqual(baseline);
    expect(sum(pair, "alerts")).toBe(0);
    expect((await getRow(twin.id))!.status).toBe("failed");
  });

  it("a mark that does not take on a row that is NOT marked is still an alert (the next run looks again); only a row another run already marked is quiet", async () => {
    const p = await makePerson();
    const g = await insertGenerating(p.id);
    await putObject(pathFor(g.id, g.attempt));
    await finish(g.id, g.attempt);
    await setRow(g.id, { expires_at: new Date(Date.now() - 1000).toISOString() });
    // The database answers the mark with "nothing matched" although nobody marked the row.
    const base = countedService().client;
    const refusing = new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === "rpc") return (fn: string, args?: Record<string, unknown>) => (fn === "mark_data_export_object_deleted" ? Promise.resolve({ data: null, error: null }) : target.rpc(fn as never, args as never));
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const summary = await sweepDataExports(refusing);
    expect(summary.alerts).toBeGreaterThanOrEqual(1);
    expect(summary.expired).toBe(0);
    expect((await getRow(g.id))!.deleted_at, "the row was not marked").toBeNull();
    expect(reasons(await deletedFor(g.id))).toEqual([]);
  });

  it("two sweeps one after the other: the second changes nothing and writes nothing (already pinned by sweep.test.ts T-A6; here for the orphan and the expired row too)", async () => {
    const p = await makePerson();
    const g = await insertGenerating(p.id);
    await putObject(pathFor(g.id, g.attempt));
    await finish(g.id, g.attempt);
    await setRow(g.id, { expires_at: new Date(Date.now() - 1000).toISOString() });
    await putObject(`${randomUUID()}/${randomUUID()}.json`);
    const first = await sweepDataExports(countedService().client);
    expect(first.expired + first.orphansDeleted).toBe(2);
    const auditBefore = (await auditRowsSince()).length;
    const second = await sweepDataExports(countedService().client);
    expect(second).toMatchObject({ staleCancelled: 0, expired: 0, downloadedCleaned: 0, failedCleaned: 0, orphansDeleted: 0, alerts: 0, ok: true });
    expect((await auditRowsSince()).length).toBe(auditBefore);
  });
});
