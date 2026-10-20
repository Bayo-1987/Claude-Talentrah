/**
 * What the REAL storage service reports when an object is removed. The sweep counts and audits a deletion only when its own remove() reports an object removed, so two overlapping runs do not both
 * claim one object. That rests on this: remove() of an object that is not there resolves WITHOUT an error and reports ZERO removed, and remove() of an object that is there reports exactly one.
 *
 * Needs the local stack (it talks to real storage); in CI it runs with the rest of tests/storage. The library only hands back what the server answers
 * (node_modules/@supabase/storage-js/src/packages/StorageFileApi.ts lines 1184-1202: `data: FileObject[]` is the server's reply), so the server's behaviour is what this file checks.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin } from "../support/auth";
import { acquireBucketLock, releaseBucketLock } from "../support/bucket-lock";
import { removeObjectCounted } from "@/lib/data-export/store";
import { DATA_EXPORT_BUCKET } from "@/lib/data-export/constants";

const files = () => admin.storage.from(DATA_EXPORT_BUCKET);
const path = `${randomUUID()}/${randomUUID()}.json`;

beforeAll(async () => {
  await acquireBucketLock();
}, 300_000);
afterAll(async () => {
  await files().remove([path]);
  releaseBucketLock();
});

describe("storage remove() on the data-exports bucket", () => {
  it("an object that does not exist: no error, zero removed", async () => {
    const r = await files().remove([path]);
    expect(r.error).toBeNull();
    expect(r.data).toEqual([]);
  });

  it("an object that exists: no error, exactly one removed; removing it again reports zero", async () => {
    const up = await files().upload(path, new Blob(["{}"], { type: "application/json" }), { contentType: "application/json" });
    expect(up.error).toBeNull();
    const first = await files().remove([path]);
    expect(first.error).toBeNull();
    expect(first.data).toHaveLength(1);
    const second = await files().remove([path]);
    expect(second.error).toBeNull();
    expect(second.data).toEqual([]);
  });

  it("removeObjectCounted reports the same: ok with 0 for a missing object, ok with 1 for a present one", async () => {
    expect(await removeObjectCounted(admin, path)).toEqual({ ok: true, removed: 0 });
    const up = await files().upload(path, new Blob(["{}"], { type: "application/json" }), { contentType: "application/json" });
    expect(up.error).toBeNull();
    expect(await removeObjectCounted(admin, path)).toEqual({ ok: true, removed: 1 });
    expect(await removeObjectCounted(admin, path)).toEqual({ ok: true, removed: 0 });
  });
});
