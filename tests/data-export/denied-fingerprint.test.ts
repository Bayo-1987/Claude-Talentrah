/**
 * DATA-EXPORT-DENIED-FINGERPRINT-1. When a signed-in account that is NOT the owner opens somebody's link, the people.export_denied row carries a short fingerprint of that account:
 * viewer_id_prefix, the first 8 lowercase hex characters of the user id, so the refusal can be explained later. NEVER the full id, never the email.
 *
 * Unchanged and held here: the visitor's refusal is byte-identical to the answer for an id that does not exist; the helper is the non-strict writer (a failed audit write is swallowed and the refusal
 * still goes out); the owner's own visit writes no denied row. Real local database and bucket (bucket lock), the real GET handler (handleConfirm) and POST handler (handleDownload).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { acquireBucketLock, releaseBucketLock } from "../support/bucket-lock";
import { PERSON_FIRST_NAME, PERSON_LAST_NAME, auditRowsSince, cleanupAll, countedService, flags, makePerson, putObject, releaseCreated } from "../support/data-export-fixtures";
import { finish, getRow, insertGenerating, pathFor } from "../support/data-export-db";
import { handleConfirm } from "@/lib/data-export/confirm";
import { handleDownload } from "@/lib/data-export/download";
import { auditDownloadDenied } from "@/lib/data-export/audit";

vi.mock("@/lib/supabase/service-role", async () => {
  const { countedService } = await import("../support/data-export-fixtures");
  return { createServiceRoleClient: () => countedService().client };
});

beforeAll(async () => {
  await acquireBucketLock();
}, 300_000);
beforeEach(() => {
  flags.failAuditInsert = false;
  flags.failRemove = 0;
});
afterEach(releaseCreated, 60_000);
afterAll(async () => {
  try {
    await cleanupAll();
  } finally {
    releaseBucketLock();
  }
}, 120_000);

const BASE = "https://www.example.test";
const get = (id: string) => new Request(`${BASE}/data-export/${id}`, { method: "GET" });
const post = (id: string) => new Request(`${BASE}/data-export/${id}`, { method: "POST", headers: { Origin: BASE } });
const as = (userId: string) => ({ service: countedService().client, getUser: async () => ({ id: userId }) });

/** A generated, unclaimed export owned by `ownerId`, with a file in the bucket. */
async function exportOf(ownerId: string) {
  const g = await insertGenerating(ownerId);
  await putObject(pathFor(g.id, g.attempt));
  await finish(g.id, g.attempt);
  return g;
}
const deniedFor = async (exportId: string) => (await auditRowsSince()).filter((r) => r.action === "people.export_denied" && r.target_id === exportId);
const snapshot = async (res: Response) => ({ status: res.status, headers: Object.fromEntries([...res.headers.entries()].filter(([k]) => k !== "date")), body: await res.text() });

describe("a wrong-account visit writes the fingerprint", () => {
  it.each([
    ["GET (the confirm page)", (id: string, uid: string) => handleConfirm(get(id), id, as(uid))],
    ["POST (the download button)", (id: string, uid: string) => handleDownload(post(id), id, as(uid))],
  ])("%s: one denied row, detail keys exactly operation, reason, viewer_id_prefix, prefix = first 8 characters of the viewer's id", async (_name, visit) => {
    const owner = await makePerson();
    const stranger = await makePerson();
    const g = await exportOf(owner.id);
    const res = await visit(g.id, stranger.id);
    expect(res.status).toBe(404);
    const rows = await deniedFor(g.id);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0].detail!).sort()).toEqual(["operation", "reason", "viewer_id_prefix"]);
    expect(rows[0].detail).toMatchObject({ operation: "download", reason: "wrong_account", viewer_id_prefix: stranger.id.slice(0, 8).toLowerCase() });
    expect((rows[0].detail as { viewer_id_prefix: string }).viewer_id_prefix).toMatch(/^[0-9a-f]{8}$/);
    expect((await getRow(g.id))!.claimed_at, "nothing was claimed").toBeNull();
  });

  it("the full id, the email and the name of the viewer are in no audit row", async () => {
    const owner = await makePerson();
    const stranger = await makePerson();
    const g = await exportOf(owner.id);
    await handleConfirm(get(g.id), g.id, as(stranger.id));
    await handleDownload(post(g.id), g.id, as(stranger.id));
    const blob = JSON.stringify(await auditRowsSince());
    for (const s of [stranger.id, stranger.email, PERSON_FIRST_NAME, PERSON_LAST_NAME]) expect(blob, s).not.toContain(s);
    expect(blob).toContain(stranger.id.slice(0, 8));
  });

  it("an upper-case id gives a lower-case prefix, and anything that is not a uuid gives null (and the raw text is nowhere)", async () => {
    const exportId = randomUUID();
    const viewer = randomUUID();
    await auditDownloadDenied({ exportId, viewerId: viewer.toUpperCase() });
    await auditDownloadDenied({ exportId, viewerId: "someone.private@example.com" });
    await auditDownloadDenied({ exportId, viewerId: "" });
    const rows = await deniedFor(exportId);
    expect(rows.map((r) => (r.detail as { viewer_id_prefix: string | null }).viewer_id_prefix).sort((a, b) => String(a).localeCompare(String(b)))).toEqual([null, null, viewer.slice(0, 8).toLowerCase()].sort((a, b) => String(a).localeCompare(String(b))));
    expect(JSON.stringify(rows)).not.toContain("someone.private");
  });
});

describe("what does not change", () => {
  it("the visitor's refusal is byte-identical to the answer for an id that does not exist (GET and POST: status, headers, body)", async () => {
    const owner = await makePerson();
    const stranger = await makePerson();
    const g = await exportOf(owner.id);
    const ghost = randomUUID();
    expect(await snapshot(await handleConfirm(get(g.id), g.id, as(stranger.id)))).toEqual(await snapshot(await handleConfirm(get(ghost), ghost, as(stranger.id))));
    expect(await snapshot(await handleDownload(post(g.id), g.id, as(stranger.id)))).toEqual(await snapshot(await handleDownload(post(ghost), ghost, as(stranger.id))));
  });

  it("the helper is the non-strict writer: with the audit insert forced to fail it resolves, and the refusal still goes out", async () => {
    const owner = await makePerson();
    const stranger = await makePerson();
    const g = await exportOf(owner.id);
    flags.failAuditInsert = true;
    await expect(auditDownloadDenied({ exportId: g.id, viewerId: stranger.id })).resolves.toBeUndefined();
    expect((await handleConfirm(get(g.id), g.id, as(stranger.id))).status).toBe(404);
    expect((await handleDownload(post(g.id), g.id, as(stranger.id))).status).toBe(404);
  });

  it("the owner's own visit writes no denied row", async () => {
    const owner = await makePerson();
    const g = await exportOf(owner.id);
    expect((await handleConfirm(get(g.id), g.id, as(owner.id))).status).toBe(200);
    expect(await deniedFor(g.id)).toEqual([]);
  });
});
