/**
 * The hourly sweep when the file is ALREADY gone from storage but the row still has no deleted_at (the file was removed and the row update then failed, or the file was lost some other way).
 * A due row must still be marked: the missing object is a successful removal, not a failure, so the next run finishes the row once, counts it once, audits it once and raises no alert.
 * Against the real local database and bucket; the bucket is shared by the whole stack, so the suite takes the cross-file bucket lock.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireBucketLock, releaseBucketLock } from "../support/bucket-lock";
import { auditRowsSince, bucketPaths, cleanupAll, countedService, emptyBucket, flags, makePerson, putObject, releaseCreated } from "../support/data-export-fixtures";
import { finish, getRow, insertGenerating, pathFor, setRow } from "../support/data-export-db";
import { sweepDataExports } from "@/lib/data-export/sweep";

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

const run = () => sweepDataExports(countedService().client);
const auditFor = async (exportId: string) => (await auditRowsSince()).filter((r) => r.action === "people.export_deleted" && (r.detail as { export_id?: string }).export_id === exportId);
const CLEAN = { staleCancelled: 0, expired: 0, downloadedCleaned: 0, failedCleaned: 0, orphansDeleted: 0, alerts: 0, ok: true };

describe("a due row whose object is already gone", () => {
  it("generated and past its end date: marked expired, counted once, ONE audit row, no alert; a second sweep changes nothing", async () => {
    const p = await makePerson();
    const g = await insertGenerating(p.id);
    await finish(g.id, g.attempt);
    await setRow(g.id, { expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(await bucketPaths()).toEqual([]);

    const first = await run();
    expect(first).toMatchObject({ ...CLEAN, expired: 1 });
    const row = (await getRow(g.id))!;
    expect(row.status).toBe("expired");
    expect(row.deleted_at).toBeTruthy();
    expect(await auditFor(g.id)).toHaveLength(1);

    expect(await run()).toMatchObject(CLEAN);
    expect((await getRow(g.id))!.deleted_at).toBe(row.deleted_at);
    expect(await auditFor(g.id)).toHaveLength(1);
  });

  it("claimed more than ten minutes ago: marked deleted, counted once, ONE audit row, no alert", async () => {
    const p = await makePerson();
    const g = await insertGenerating(p.id);
    await finish(g.id, g.attempt);
    await setRow(g.id, { status: "downloaded", claimed_at: new Date(Date.now() - 20 * 60_000).toISOString() });

    const first = await run();
    expect(first).toMatchObject({ ...CLEAN, downloadedCleaned: 1 });
    const row = (await getRow(g.id))!;
    expect(row.status).toBe("deleted");
    expect(row.deleted_at).toBeTruthy();
    expect(await auditFor(g.id)).toHaveLength(1);
    expect(await run()).toMatchObject(CLEAN);
  });

  it("failed: deleted_at set, counted once, ONE audit row, no alert", async () => {
    const p = await makePerson();
    const g = await insertGenerating(p.id);
    await setRow(g.id, { status: "failed" });

    const first = await run();
    expect(first).toMatchObject({ ...CLEAN, failedCleaned: 1 });
    const row = (await getRow(g.id))!;
    expect(row.status).toBe("failed");
    expect(row.deleted_at).toBeTruthy();
    expect(await auditFor(g.id)).toHaveLength(1);
    expect(await run()).toMatchObject(CLEAN);
  });

  it("the file was removed by an earlier run whose row update then failed: the next run marks the row and does not alert", async () => {
    const p = await makePerson();
    const g = await insertGenerating(p.id);
    await putObject(pathFor(g.id, g.attempt));
    await finish(g.id, g.attempt);
    await setRow(g.id, { expires_at: new Date(Date.now() - 1000).toISOString() });

    // Run 1: the object goes (the row pass and the bucket pass each try once, the first removal works), then the row is left unmarked by hand to stand for the failed update.
    const first = await run();
    expect(first.expired).toBe(1);
    await setRow(g.id, { status: "generated", deleted_at: null });
    expect(await bucketPaths()).toEqual([]);

    const second = await run();
    expect(second).toMatchObject({ ...CLEAN, expired: 1 });
    expect((await getRow(g.id))!.deleted_at).toBeTruthy();
  });

  it("a young generated row whose object is gone is left alone until it falls due", async () => {
    const p = await makePerson();
    const g = await insertGenerating(p.id);
    await finish(g.id, g.attempt);

    expect(await run()).toMatchObject(CLEAN);
    const row = (await getRow(g.id))!;
    expect(row.status).toBe("generated");
    expect(row.deleted_at).toBeNull();
  });
});
