/**
 * The hourly sweep (src/lib/data-export/sweep.ts and GET /api/admin/sweep-data-exports), against the real local database and bucket.
 *
 * Pass 1 works from ROWS; pass 2 works from the BUCKET, which is the one that finds what rows cannot (an account deleted inside the 72 hours takes its row with it and leaves the object).
 * The bucket is shared by the whole stack, so the suite takes the cross-file bucket lock.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin as realService } from "../support/auth";
import { acquireBucketLock, releaseBucketLock } from "../support/bucket-lock";
import { auditRowsSince, bucketPaths, cleanupAll, releaseCreated, countedService, emptyBucket, flags, makePerson, putObject } from "../support/data-export-fixtures";
import { ageAttempt, finish, getRow, insertGenerating, pathFor, setRow } from "../support/data-export-db";
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

const run = (opts: Parameters<typeof sweepDataExports>[1] = {}) => sweepDataExports(countedService().client, opts);
const deletedAudit = async () => (await auditRowsSince()).filter((r) => r.action === "people.export_deleted");

describe("pass 2: the bucket", () => {
  it("ORPHAN, account deleted inside the 72 hours: the row cascades, the object stays; the sweep deletes it and records the reason orphan", async () => {
    const created = await realService.auth.admin.createUser({ email: `dx-orphan-${randomUUID()}@talentrah.test`, email_confirm: true });
    expect(created.error).toBeNull();
    const userId = created.data.user!.id;
    const g = await insertGenerating(userId);
    await putObject(pathFor(g.id, g.attempt));
    await finish(g.id, g.attempt);
    expect(await bucketPaths()).toContain(pathFor(g.id, g.attempt));

    expect((await realService.auth.admin.deleteUser(userId)).error).toBeNull();
    expect(await getRow(g.id), "the row cascaded away").toBeNull();
    expect(await bucketPaths(), "the object did not").toContain(pathFor(g.id, g.attempt));

    const summary = await run();
    expect(summary.orphansDeleted).toBe(1);
    expect(await bucketPaths()).toEqual([]);
    const rows = await deletedAudit();
    expect(rows.map((r) => (r.detail as { reason: string }).reason)).toContain("orphan");
  });

  it("an object with no row ever, and names that are not <uuid>/<uuid>.json, are all deleted; a LIVE object with a live row is untouched", async () => {
    const p = await makePerson();
    const live = await insertGenerating(p.id);
    await putObject(pathFor(live.id, live.attempt));
    await finish(live.id, live.attempt);

    const stray = [`${randomUUID()}/${randomUUID()}.json`, `${randomUUID()}.json`, "notes.json", `${randomUUID()}/${randomUUID()}.txt`.replace(".txt", ".json").replace("/", "/x-")];
    for (const path of stray) await putObject(path);
    expect((await bucketPaths()).length).toBe(1 + stray.length);

    const summary = await run();
    expect(summary.orphansDeleted).toBe(stray.length);
    expect(await bucketPaths()).toEqual([pathFor(live.id, live.attempt)]);
    expect((await getRow(live.id))!.status).toBe("generated");
  });

  it("lists the WHOLE bucket: more folders than one list page, with a small page size", async () => {
    for (let i = 0; i < 8; i++) await putObject(`${randomUUID()}/${randomUUID()}.json`);
    const summary = await run({ pageSize: 3 });
    expect(summary.listed).toBe(8);
    expect(summary.orphansDeleted).toBe(8);
    expect(await bucketPaths()).toEqual([]);
  });

  it("lists the whole bucket at the REAL page size too: more than 100 objects at the root do not stop it after the first page", async () => {
    const names = Array.from({ length: 105 }, () => `${randomUUID()}.json`);
    for (let i = 0; i < names.length; i += 15) await Promise.all(names.slice(i, i + 15).map((n) => putObject(n)));
    const summary = await run({ deleteCap: 1000 });
    expect(summary.listed).toBe(105);
    expect(summary.orphansDeleted).toBe(105);
    expect(await bucketPaths()).toEqual([]);
  }, 120_000);

  it("is bounded: a run deletes at most the cap and the rest waits for the next run", async () => {
    for (let i = 0; i < 6; i++) await putObject(`${randomUUID()}.json`);
    const first = await run({ deleteCap: 4 });
    expect(first.orphansDeleted).toBe(4);
    expect(first.capped).toBe(true);
    const second = await run({ deleteCap: 4 });
    expect(second.orphansDeleted).toBe(2);
    expect(await bucketPaths()).toEqual([]);
  });

  it("a mid-generation object (row generating, young) is NOT deleted; one stuck in generating over 15 minutes becomes failed and its object is removed", async () => {
    const p1 = await makePerson();
    const p2 = await makePerson();
    const young = await insertGenerating(p1.id);
    await putObject(pathFor(young.id, young.attempt));
    const stuck = await insertGenerating(p2.id);
    await putObject(pathFor(stuck.id, stuck.attempt));
    await ageAttempt(stuck.id, 20);

    const summary = await run();
    expect(summary.staleCancelled).toBeGreaterThanOrEqual(1);
    expect(await bucketPaths()).toEqual([pathFor(young.id, young.attempt)]);
    expect((await getRow(young.id))!.status).toBe("generating");
    expect((await getRow(stuck.id))!.status).toBe("failed");
  });

  it("an object of a CANCELLED attempt (same export id, an attempt id the row no longer owns) is deleted; the live attempt's object is not", async () => {
    const p = await makePerson();
    const g = await insertGenerating(p.id);
    await putObject(pathFor(g.id, g.attempt));
    await finish(g.id, g.attempt);
    const stale = pathFor(g.id, randomUUID());
    await putObject(stale);
    const summary = await run();
    expect(summary.orphansDeleted).toBe(1);
    expect(await bucketPaths()).toEqual([pathFor(g.id, g.attempt)]);
    expect((await getRow(g.id))!.status).toBe("generated");
  });

  it("an object a download is still reading (claimed in the last ten minutes) is not deleted", async () => {
    const p = await makePerson();
    const g = await insertGenerating(p.id);
    await putObject(pathFor(g.id, g.attempt));
    await finish(g.id, g.attempt);
    await setRow(g.id, { status: "downloaded", claimed_at: new Date().toISOString() });
    const summary = await run();
    expect(summary.orphansDeleted).toBe(0);
    expect(await bucketPaths()).toEqual([pathFor(g.id, g.attempt)]);
  });

  it("a cancelled export's object left behind by a failed delete is removed (a cancelled row is not live)", async () => {
    const p = await makePerson();
    const g = await insertGenerating(p.id);
    await putObject(pathFor(g.id, g.attempt));
    await finish(g.id, g.attempt);
    await setRow(g.id, { status: "cancelled", deleted_at: new Date().toISOString() });
    const summary = await run();
    expect(summary.orphansDeleted).toBe(1);
    expect(await bucketPaths()).toEqual([]);
  });
});

describe("pass 1: rows", () => {
  it("a generated export past its 72 hours: object deleted, row `expired`, audited; a young one is untouched", async () => {
    const p1 = await makePerson();
    const p2 = await makePerson();
    const old = await insertGenerating(p1.id);
    await putObject(pathFor(old.id, old.attempt));
    await finish(old.id, old.attempt);
    await setRow(old.id, { expires_at: new Date(Date.now() - 1000).toISOString() });
    const fresh = await insertGenerating(p2.id);
    await putObject(pathFor(fresh.id, fresh.attempt));
    await finish(fresh.id, fresh.attempt);

    const summary = await run();
    expect(summary.expired).toBe(1);
    expect((await getRow(old.id))!.status).toBe("expired");
    expect((await getRow(old.id))!.deleted_at).toBeTruthy();
    expect(await bucketPaths()).toEqual([pathFor(fresh.id, fresh.attempt)]);
    expect((await getRow(fresh.id))!.status).toBe("generated");
    expect((await deletedAudit()).map((r) => (r.detail as { reason: string }).reason)).toContain("expired");
  });

  it("T-A6: a row claimed but never deleted is cleaned by the next sweep: object gone, row `deleted`, an audit row with reason downloaded, and a second sweep changes nothing", async () => {
    const p = await makePerson();
    const g = await insertGenerating(p.id);
    await putObject(pathFor(g.id, g.attempt));
    await finish(g.id, g.attempt);
    await setRow(g.id, { status: "downloaded", claimed_at: new Date(Date.now() - 20 * 60_000).toISOString() });
    expect((await getRow(g.id))!.deleted_at).toBeNull();

    const first = await run();
    expect(first.downloadedCleaned).toBe(1);
    expect(await bucketPaths()).toEqual([]);
    const row = (await getRow(g.id))!;
    expect(row.status).toBe("deleted");
    expect(row.deleted_at).toBeTruthy();
    expect((await deletedAudit()).filter((r) => (r.detail as { reason: string; export_id: string }).reason === "downloaded" && (r.detail as { export_id: string }).export_id === g.id)).toHaveLength(1);

    const second = await run();
    expect(second).toMatchObject({ staleCancelled: 0, expired: 0, downloadedCleaned: 0, failedCleaned: 0, orphansDeleted: 0, alerts: 0, ok: true });
    expect((await getRow(g.id))!.deleted_at).toBe(row.deleted_at);
  });

  it("a FAILED delete leaves the row for the next run and the answer reports an alert (counts only); the next run finishes the job", async () => {
    const p = await makePerson();
    const g = await insertGenerating(p.id);
    await putObject(pathFor(g.id, g.attempt));
    await finish(g.id, g.attempt);
    await setRow(g.id, { expires_at: new Date(Date.now() - 1000).toISOString() });

    flags.failRemove = 2; // pass 1 and pass 2 both try once
    const first = await run();
    expect(first.alerts).toBeGreaterThanOrEqual(1);
    expect(first.ok).toBe(false);
    expect((await getRow(g.id))!.status, "the row waits").toBe("generated");
    expect((await getRow(g.id))!.deleted_at).toBeNull();
    expect(await bucketPaths()).toEqual([pathFor(g.id, g.attempt)]);

    const second = await run();
    expect(second.ok).toBe(true);
    expect(second.expired).toBe(1);
    expect((await getRow(g.id))!.status).toBe("expired");
    expect(await bucketPaths()).toEqual([]);
  });

  it("a failed attempt's row is cleaned once (deleted_at set) and not retried forever", async () => {
    const p = await makePerson();
    const g = await insertGenerating(p.id);
    await setRow(g.id, { status: "failed" });
    const first = await run();
    expect(first.failedCleaned).toBe(1);
    const second = await run();
    expect(second.failedCleaned).toBe(0);
  });
});
