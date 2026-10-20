/**
 * markFailedRowCleaned (src/lib/data-export/store.ts) against the real local database: the cleanup mark of a `failed` export row is ONE conditional update (deleted_at is null), so of any number
 * of runs that try it at the same moment exactly one wins. In the style of tests/rls/data-export-files.test.ts: service client, pooled test accounts given back after every test.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { deleteRowsFor, getRow, insertGenerating, setRow } from "../support/data-export-db";
import { markFailedRowCleaned } from "@/lib/data-export/store";

const made: string[] = [];
const fresh = async () => {
  const u = await createTestUser("dx-failedclean");
  made.push(u.id);
  return u;
};
afterEach(async () => {
  const ids = made.splice(0);
  await deleteRowsFor(ids);
  await deleteTestUsers(ids);
}, 60_000);
afterAll(async () => {
  await deleteRowsFor(made);
});

describe("markFailedRowCleaned", () => {
  it("six runs at the same moment on one failed row: exactly one wins, and deleted_at is set once", async () => {
    const u = await fresh();
    const g = await insertGenerating(u.id);
    await setRow(g.id, { status: "failed" });
    const results = await Promise.all(Array.from({ length: 6 }, () => markFailedRowCleaned(admin, { exportId: g.id, attemptId: g.attempt })));
    expect(results.filter(Boolean)).toHaveLength(1);
    const row = (await getRow(g.id))!;
    expect(row.status).toBe("failed");
    expect(row.deleted_at).toBeTruthy();
  });

  it("a second call after the first changes nothing and reports false", async () => {
    const u = await fresh();
    const g = await insertGenerating(u.id);
    await setRow(g.id, { status: "failed" });
    expect(await markFailedRowCleaned(admin, { exportId: g.id, attemptId: g.attempt })).toBe(true);
    const stamp = (await getRow(g.id))!.deleted_at;
    expect(await markFailedRowCleaned(admin, { exportId: g.id, attemptId: g.attempt })).toBe(false);
    expect((await getRow(g.id))!.deleted_at).toBe(stamp);
  });

  it("only a failed row, and only for the attempt that owns it: a generating row, another attempt id and an unknown id all report false and change nothing", async () => {
    const u = await fresh();
    const g = await insertGenerating(u.id);
    expect(await markFailedRowCleaned(admin, { exportId: g.id, attemptId: g.attempt }), "still generating").toBe(false);
    await setRow(g.id, { status: "failed" });
    expect(await markFailedRowCleaned(admin, { exportId: g.id, attemptId: randomUUID() }), "another attempt").toBe(false);
    expect(await markFailedRowCleaned(admin, { exportId: randomUUID(), attemptId: g.attempt }), "unknown id").toBe(false);
    expect((await getRow(g.id))!.deleted_at).toBeNull();
  });
});
