/**
 * The data-exports bucket (0263) is private and has NO storage policies: only the service role can reach an object in it.
 *
 * An unauthenticated client and a signed-in client (of the person the file is about, even) cannot read, list, download, sign, overwrite, move or delete the object, and the public URL
 * does not serve it. The service role can write, read and delete it. A bucket that is public, or a policy that opens it, fails here.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin, createAuthedTestUser, deleteTestUsers, type TestUser } from "../support/auth";
import type { SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const BUCKET = "data-exports";
const anon = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });

let owner: TestUser & { client: SupabaseClient };
const exportId = randomUUID();
const objectPath = `${exportId}/${randomUUID()}.json`;
const body = JSON.stringify({ planted: "this stands in for a person's data" });

beforeAll(async () => {
  owner = (await createAuthedTestUser("dx-bucket")) as typeof owner;
  const up = await admin.storage.from(BUCKET).upload(objectPath, new Blob([body], { type: "application/json" }), { contentType: "application/json" });
  expect(up.error, `service upload: ${up.error?.message}`).toBeNull();
}, 120_000);

afterAll(async () => {
  const rm = await admin.storage.from(BUCKET).remove([objectPath]);
  expect(rm.error, "cleanup of the planted object").toBeNull();
  await deleteTestUsers([owner.id]);
});

describe("the bucket", () => {
  it("exists and is not public", async () => {
    const { data, error } = await admin.storage.getBucket(BUCKET);
    expect(error).toBeNull();
    expect(data?.public).toBe(false);
  });

  it("the service role can read and list the object", async () => {
    const dl = await admin.storage.from(BUCKET).download(objectPath);
    expect(dl.error).toBeNull();
    expect(await dl.data!.text()).toBe(body);
    const ls = await admin.storage.from(BUCKET).list(exportId);
    expect(ls.error).toBeNull();
    expect((ls.data ?? []).length).toBe(1);
  });
});

describe.each([
  ["an unauthenticated client", () => anon],
  ["a signed-in client (the person the file is about)", () => owner.client],
])("%s", (_name, who) => {
  it("cannot download the object", async () => {
    const r = await who().storage.from(BUCKET).download(objectPath);
    expect(r.data).toBeNull();
    expect(r.error).not.toBeNull();
  });

  it("cannot list the bucket or the export's folder", async () => {
    for (const prefix of ["", exportId]) {
      const r = await who().storage.from(BUCKET).list(prefix);
      expect(r.error === null ? r.data : [], `list(${JSON.stringify(prefix)})`).toEqual([]);
    }
  });

  it("cannot get a signed URL, and cannot upload, replace, move or delete", async () => {
    const sign = await who().storage.from(BUCKET).createSignedUrl(objectPath, 60);
    expect(sign.data).toBeNull();
    expect(sign.error).not.toBeNull();
    const put = await who().storage.from(BUCKET).upload(`${exportId}/${randomUUID()}.json`, new Blob(["{}"], { type: "application/json" }));
    expect(put.error).not.toBeNull();
    const over = await who().storage.from(BUCKET).upload(objectPath, new Blob(["{}"], { type: "application/json" }), { upsert: true });
    expect(over.error).not.toBeNull();
    const mv = await who().storage.from(BUCKET).move(objectPath, `${exportId}/moved.json`);
    expect(mv.error).not.toBeNull();
    const rm = await who().storage.from(BUCKET).remove([objectPath]);
    expect(rm.error === null ? rm.data : [], "remove must not report the object as removed").toEqual([]);
    // After all of that the object is still there, untouched.
    const still = await admin.storage.from(BUCKET).download(objectPath);
    expect(still.error).toBeNull();
    expect(await still.data!.text()).toBe(body);
  });
});

describe("the public URL", () => {
  it("does not serve the object", async () => {
    const res = await fetch(`${URL}/storage/v1/object/public/${BUCKET}/${objectPath}`);
    expect(res.ok).toBe(false);
    expect(await res.text()).not.toContain("planted");
  });
});
