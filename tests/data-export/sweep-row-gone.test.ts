/**
 * A row that disappears between the sweep's read and its mark (an account deleted in the same moment: the row cascades away). If THIS run's own removal took the file, nobody else can record that: pass 2
 * lists the bucket after the file is gone. So the row pass counts it once as an orphan (the way pass 2 counts one) and writes ONE people.export_deleted row with reason "orphan" and no user id.
 * If the run removed nothing (the file was already gone), or another run already marked the row, it stays quiet. A mark that does not take on a row that is not marked and not gone is still an alert.
 *
 * The moment is made certain: the service client deletes (or changes) the row right AFTER the run's first storage remove returns, i.e. after the select and before the mark.
 * Real local database and bucket; the bucket lock keeps other files out.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { acquireBucketLock, releaseBucketLock } from "../support/bucket-lock";
import { auditRowsSince, bucketPaths, cleanupAll, countedService, emptyBucket, flags, makePerson, putObject, releaseCreated } from "../support/data-export-fixtures";
import { finish, getRow, insertGenerating, pathFor, setRow, svc, type Answer } from "../support/data-export-db";
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

/** The service client; once the FIRST storage remove has returned, `then` runs (after the sweep's select, before its mark). */
function clientThat(then: () => Promise<void>) {
  const base = countedService().client;
  let done = false;
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
                    const out = await ft.remove(paths);
                    if (!done) {
                      done = true;
                      await then();
                    }
                    return out;
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

const dropRow = (id: string) => async () => {
  const { error } = await (svc.from("data_export_files").delete().eq("id", id) as unknown as PromiseLike<Answer>);
  if (error) throw new Error(`drop row: ${error.message}`);
};
const deletedRows = async () => (await auditRowsSince()).filter((r) => r.action === "people.export_deleted");
const auditFor = async (exportId: string) => (await deletedRows()).filter((r) => (r.detail as { export_id?: string }).export_id === exportId);
const reasonsOf = (rows: Awaited<ReturnType<typeof deletedRows>>) => rows.map((r) => (r.detail as { reason: string }).reason);
const QUIET: Partial<SweepSummary> = { staleCancelled: 0, expired: 0, downloadedCleaned: 0, failedCleaned: 0, orphansDeleted: 0, alerts: 0, ok: true };

describe("the row is gone after this run removed the file", () => {
  const kinds: Array<[string, (id: string, attempt: string) => Promise<void>]> = [
    ["generated and past its end date", async (id, a) => { await finish(id, a); await setRow(id, { expires_at: new Date(Date.now() - 1000).toISOString() }); }],
    ["downloaded and claimed more than ten minutes ago", async (id, a) => { await finish(id, a); await setRow(id, { status: "downloaded", claimed_at: new Date(Date.now() - 20 * 60_000).toISOString() }); }],
    ["failed", async (id) => { await setRow(id, { status: "failed" }); }],
  ];

  it.each(kinds)("%s: counted once as an orphan, ONE audit row (reason orphan), no alert, and a second sweep changes nothing", async (_name, prepare) => {
    const p = await makePerson();
    const g = await insertGenerating(p.id);
    await putObject(pathFor(g.id, g.attempt));
    await prepare(g.id, g.attempt);

    const first = await sweepDataExports(clientThat(dropRow(g.id)));
    expect(await getRow(g.id), "the row is gone").toBeNull();
    expect(await bucketPaths()).toEqual([]);
    expect(first).toMatchObject({ ...QUIET, orphansDeleted: 1 });
    expect(reasonsOf(await auditFor(g.id))).toEqual(["orphan"]);
    const [audit] = await auditFor(g.id);
    expect(audit.target_table, "no user id: the target is the export, not a person").toBe("data_export_files");
    expect(audit.target_id).toBe(g.id);

    const before = (await deletedRows()).length;
    expect(await sweepDataExports(countedService().client)).toMatchObject(QUIET);
    expect(await deletedRows()).toHaveLength(before);
  });

  it("the file was already gone (this run removed nothing): quiet, no count, no audit row, no alert", async () => {
    const p = await makePerson();
    const g = await insertGenerating(p.id);
    await finish(g.id, g.attempt);
    await setRow(g.id, { expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(await bucketPaths()).toEqual([]);

    const first = await sweepDataExports(clientThat(dropRow(g.id)));
    expect(await getRow(g.id)).toBeNull();
    expect(first).toMatchObject(QUIET);
    expect(await auditFor(g.id)).toEqual([]);
  });
});

describe("a mark that does not take", () => {
  it("on a FAILED row that is not marked and not gone (its attempt changed under the run) is an alert, nothing is counted or audited, and the next run finishes it", async () => {
    const p = await makePerson();
    const g = await insertGenerating(p.id);
    await putObject(pathFor(g.id, g.attempt));
    await setRow(g.id, { status: "failed" });

    const first = await sweepDataExports(clientThat(async () => setRow(g.id, { attempt_id: randomUUID() })));
    expect(first.alerts).toBeGreaterThanOrEqual(1);
    expect(first.ok).toBe(false);
    expect(first.failedCleaned).toBe(0);
    expect(first.orphansDeleted).toBe(0);
    expect((await getRow(g.id))!.deleted_at, "the row was not marked").toBeNull();
    expect(await auditFor(g.id)).toEqual([]);

    const second = await sweepDataExports(countedService().client);
    expect(second).toMatchObject({ ...QUIET, failedCleaned: 1 });
    expect((await getRow(g.id))!.deleted_at).toBeTruthy();
    expect(reasonsOf(await auditFor(g.id))).toEqual(["failed"]);
  });
});
