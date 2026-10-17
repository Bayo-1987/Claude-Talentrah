/**
 * The download (GET /data-export/<id>) against the real local database and bucket: only the signed-in owner, once, before expiry; the object is deleted whether the stream finishes, fails or the
 * client drops; HEAD, OPTIONS and a prefetch never claim. The session is a fake `getUser` (the route supplies the real cookie reader); everything else is real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin as realService } from "../support/auth";
import { acquireBucketLock, releaseBucketLock } from "../support/bucket-lock";
import { auditRowsSince, bucketPaths, cleanupAll, countedService, fakeMailer, flags, makeAdmin, makePerson, putObject } from "../support/data-export-fixtures";
import { finish, getRow, insertGenerating, pathFor, setRow } from "../support/data-export-db";
import { handleDownload, isPrefetch } from "@/lib/data-export/download";
import { startExport } from "@/lib/data-export/start";

const h = vi.hoisted(() => ({ serviceRoleCalls: 0 }));
vi.mock("@/lib/supabase/service-role", async () => {
  const { countedService } = await import("../support/data-export-fixtures");
  return {
    createServiceRoleClient: () => {
      h.serviceRoleCalls += 1;
      return countedService().client;
    },
  };
});

beforeAll(async () => {
  await acquireBucketLock();
}, 300_000);
beforeEach(() => {
  flags.failAuditInsert = false;
  flags.failRemove = 0;
});
afterAll(async () => {
  try {
    await cleanupAll();
  } finally {
    releaseBucketLock();
  }
}, 120_000);

const URL_BASE = "https://www.example.test";
const get = (id: string, headers: Record<string, string> = {}, method = "GET") => new Request(`${URL_BASE}/data-export/${id}`, { method, headers });
const as = (userId: string | null) => ({ service: countedService().client, getUser: async () => (userId ? { id: userId } : null) });

/** A finished export for `person`, made by the real start flow (a real file in the bucket). */
async function exportFor(person: { id: string }) {
  const a = await makeAdmin();
  const r = await startExport(
    { service: countedService().client, admin: a, send: fakeMailer().send, siteOrigin: URL_BASE, supportUrl: `${URL_BASE}/contact`, from: "x <x@example.test>", loadBankNames: async () => new Map() },
    { targetRaw: person.id, ticket: "SUP-3001", reason: "access_request", requesterCheck: "contact_form" },
  );
  if (r.status !== "started") throw new Error(`setup: ${JSON.stringify(r)}`);
  return (await getRow(r.exportId))!;
}

/** A generated export with a hand-made body of a given size. */
async function plantedExport(person: { id: string }, body: string) {
  const g = await insertGenerating(person.id);
  await putObject(pathFor(g.id, g.attempt), body);
  await finish(g.id, g.attempt);
  return g;
}

describe("the owner", () => {
  it("gets the file once; the object is deleted and the row marked deleted; the audit rows are written; a second request is refused", async () => {
    const p = await makePerson();
    const row = await exportFor(p);
    const res = await handleDownload(get(row.id), row.id, as(p.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="talentrah-data-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    const file = JSON.parse(text) as { tables: { profiles: Array<{ email: string }> } };
    expect(file.tables.profiles[0].email).toBe(p.email);

    expect(await bucketPaths(), "the object is deleted").not.toContain(row.object_path);
    const after = (await getRow(row.id))!;
    expect(after.status).toBe("deleted");
    expect(after.claimed_at).toBeTruthy();
    expect(after.deleted_at).toBeTruthy();
    const actions = (await auditRowsSince()).filter((r) => r.target_id === p.id && r.admin_email === "system-data-export@talentrah.internal");
    expect(actions.map((r) => r.action).sort()).toEqual(["people.export_deleted", "people.export_downloaded"]);
    expect(actions.find((r) => r.action === "people.export_deleted")!.detail).toMatchObject({ reason: "downloaded" });

    const again = await handleDownload(get(row.id), row.id, as(p.id));
    expect(again.status).toBe(404);
  });

  it("two requests at the same moment: exactly one gets the file", async () => {
    const p = await makePerson();
    const row = await exportFor(p);
    const results = await Promise.all(Array.from({ length: 4 }, () => handleDownload(get(row.id), row.id, as(p.id))));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 404)).toHaveLength(3);
    await Promise.all(results.map((r) => r.text()));
  });

  it("a person inside their 30 days before a deletion can open the link", async () => {
    const p = await makePerson({ pendingDeletion: true });
    const row = await exportFor(p);
    expect((await handleDownload(get(row.id), row.id, as(p.id))).status).toBe(200);
  });
});

describe("everyone else gets the same generic refusal", () => {
  it("signed out: to the login page with the return trip, and nothing is claimed", async () => {
    const p = await makePerson();
    const row = await exportFor(p);
    const res = await handleDownload(get(row.id), row.id, as(null));
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("redirectTo")).toBe(`/data-export/${row.id}`);
    expect((await getRow(row.id))!.claimed_at).toBeNull();
  });

  it("signed in as ANOTHER account (a forwarded link): the same refusal as an expired or used link, a denied audit row, and the owner can still use it afterwards", async () => {
    const owner = await makePerson();
    const stranger = await makePerson();
    const row = await exportFor(owner);
    const expiredBody = await (await handleDownload(get(randomUUID()), randomUUID(), as(owner.id))).text();

    const res = await handleDownload(get(row.id), row.id, as(stranger.id));
    expect(res.status).toBe(404);
    expect(await res.text(), "the body is the same as for an unknown link").toBe(expiredBody);
    expect((await getRow(row.id))!.claimed_at, "the single use was not spent").toBeNull();
    const denied = (await auditRowsSince()).filter((r) => r.action === "people.export_denied" && r.target_id === row.id);
    expect(denied).toHaveLength(1);
    expect(denied[0].detail).toMatchObject({ operation: "download", reason: "wrong_account" });
    expect(JSON.stringify(denied)).not.toContain(stranger.id);

    expect((await handleDownload(get(row.id), row.id, as(owner.id))).status).toBe(200);
  });

  it("an expired link: refused, and the expired object is deleted on the spot (the sweep need not have run)", async () => {
    const p = await makePerson();
    const row = await exportFor(p);
    await setRow(row.id, { expires_at: new Date(Date.now() - 1000).toISOString() });
    const res = await handleDownload(get(row.id), row.id, as(p.id));
    expect(res.status).toBe(404);
    expect(await bucketPaths()).not.toContain(row.object_path);
    expect((await getRow(row.id))!.status).toBe("expired");
  });

  it("an id that is not a uuid, or does not exist: the same refusal", async () => {
    const p = await makePerson();
    expect((await handleDownload(get("not-a-uuid"), "not-a-uuid", as(p.id))).status).toBe(404);
    const ghost = randomUUID();
    expect((await handleDownload(get(ghost), ghost, as(p.id))).status).toBe(404);
  });
});

describe("the object is deleted whether the stream finishes, fails or the client drops", () => {
  /** A service whose download hands back a body that errors after its first chunk. */
  function breakingService() {
    const counted = countedService().client;
    return new Proxy(counted, {
      get(target, prop, receiver) {
        if (prop === "storage") {
          return {
            from: (bucket: string) => {
              const real = target.storage.from(bucket);
              return new Proxy(real, {
                get(t, p, r) {
                  if (p === "download") {
                    return async () => ({
                      data: {
                        size: 10,
                        stream: () => {
                          let sent = false;
                          return new ReadableStream<Uint8Array>({
                            pull(c) {
                              if (!sent) {
                                sent = true;
                                c.enqueue(new TextEncoder().encode("{"));
                              } else c.error(new Error("storage broke"));
                            },
                          });
                        },
                      },
                      error: null,
                    });
                  }
                  const v = Reflect.get(t, p, r);
                  return typeof v === "function" ? v.bind(t) : v;
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

  it("a stream error midway: the single use is spent, the object is deleted, the row is deleted, the audit says stream_failed", async () => {
    const p = await makePerson();
    const row = await exportFor(p);
    const res = await handleDownload(get(row.id), row.id, { service: breakingService(), getUser: async () => ({ id: p.id }) });
    expect(res.status).toBe(200);
    await expect(res.text()).rejects.toBeTruthy();
    await vi.waitFor(async () => expect(await bucketPaths()).not.toContain(row.object_path), { timeout: 5000 });
    await vi.waitFor(async () => expect((await getRow(row.id))!.status).toBe("deleted"), { timeout: 5000 });
    const reasons = (await auditRowsSince()).filter((r) => r.action === "people.export_deleted" && (r.detail as { export_id: string }).export_id === row.id).map((r) => (r.detail as { reason: string }).reason);
    expect(reasons).toEqual(["stream_failed"]);
    expect((await auditRowsSince()).some((r) => r.action === "people.export_downloaded" && (r.detail as { export_id: string }).export_id === row.id)).toBe(false);
    expect((await handleDownload(get(row.id), row.id, as(p.id))).status, "a failed download consumed the single use").toBe(404);
  });

  it("the client drops after the first chunk: the object is deleted all the same", async () => {
    const p = await makePerson();
    const big = await plantedExport(p, JSON.stringify("x".repeat(600_000)));
    const res = await handleDownload(get(big.id), big.id, as(p.id));
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    await reader.cancel();
    await vi.waitFor(async () => expect(await bucketPaths()).not.toContain(pathFor(big.id, big.attempt)), { timeout: 5000 });
    await vi.waitFor(async () => expect((await getRow(big.id))!.status).toBe("deleted"), { timeout: 5000 });
  });

  it("a delete that FAILS leaves the claimed row for the sweep (status downloaded, no deleted_at)", async () => {
    const p = await makePerson();
    const row = await exportFor(p);
    flags.failRemove = 1;
    const res = await handleDownload(get(row.id), row.id, as(p.id));
    expect(res.status).toBe(200);
    await res.text();
    const after = (await getRow(row.id))!;
    expect(after.status).toBe("downloaded");
    expect(after.deleted_at).toBeNull();
    expect(await bucketPaths()).toContain(row.object_path);
  });
});

describe("HEAD, OPTIONS and a prefetch never claim (C2)", () => {
  it("the route exports explicit HEAD and OPTIONS handlers that answer empty and never touch the database", async () => {
    const route = await import("@/app/data-export/[id]/route");
    const p = await makePerson();
    const row = await exportFor(p);
    const before = h.serviceRoleCalls;
    for (const handler of [route.HEAD, route.OPTIONS]) {
      const res = await handler();
      expect(res.status).toBe(204);
      expect(res.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
      expect(await res.text()).toBe("");
    }
    expect(h.serviceRoleCalls, "no service client was even created").toBe(before);
    expect((await getRow(row.id))!.claimed_at).toBeNull();
  });

  it("handleDownload with HEAD or OPTIONS answers empty without reading the session or the database", async () => {
    const p = await makePerson();
    const row = await exportFor(p);
    let sessionReads = 0;
    const deps = { service: countedService().client, getUser: async () => { sessionReads += 1; return { id: p.id }; } };
    for (const method of ["HEAD", "OPTIONS", "POST"]) expect((await handleDownload(get(row.id, {}, method), row.id, deps)).status, method).toBe(204);
    expect(sessionReads).toBe(0);
    expect((await getRow(row.id))!.claimed_at).toBeNull();
  });

  it.each([
    ["Sec-Purpose: prefetch", { "Sec-Purpose": "prefetch" }],
    ["Sec-Purpose: prefetch;prerender", { "Sec-Purpose": "prefetch;prerender" }],
    ["Purpose: prefetch", { Purpose: "prefetch" }],
    ["the Next router prefetch header", { "Next-Router-Prefetch": "1" }],
    ["the Next middleware prefetch header", { "x-middleware-prefetch": "1" }],
  ])("a GET with %s by the owner does not claim, and a normal GET afterwards succeeds exactly once", async (_name, headers) => {
    const p = await makePerson();
    const row = await exportFor(p);
    let sessionReads = 0;
    const deps = { service: countedService().client, getUser: async () => { sessionReads += 1; return { id: p.id }; } };
    const pre = await handleDownload(get(row.id, headers), row.id, deps);
    expect(pre.status).toBe(204);
    expect(sessionReads).toBe(0);
    expect((await getRow(row.id))!.claimed_at).toBeNull();
    const real = await Promise.all([handleDownload(get(row.id), row.id, as(p.id)), handleDownload(get(row.id), row.id, as(p.id))]);
    expect(real.map((r) => r.status).sort()).toEqual([200, 404]);
    await Promise.all(real.map((r) => r.text()));
  });

  it("isPrefetch recognises the signals and nothing else", () => {
    expect(isPrefetch(get("x", { "Sec-Purpose": "prefetch" }))).toBe(true);
    expect(isPrefetch(get("x", { Accept: "text/html" }))).toBe(false);
    expect(isPrefetch(get("x", { Purpose: "navigate" }))).toBe(false);
  });
});

void realService;
