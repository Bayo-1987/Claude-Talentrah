/**
 * POST /data-export/<id>, the only thing that claims (DATA-EXPORT-DOWNLOAD-DELIVERY-1). In-memory store, no database. The database-backed behaviour (the real claim function, the real bucket,
 * stream failures, client drop) stays in tests/data-export/download.test.ts, re-pointed to the POST.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { randomUUID } from "node:crypto";
import { fake, seedExport } from "../support/data-export-fake-store";
import { handleDownload } from "@/lib/data-export/download";

vi.mock("@/lib/data-export/store", async () => (await import("../support/data-export-fake-store")).storeModule());
vi.mock("@/lib/data-export/audit", async () => (await import("../support/data-export-fake-store")).auditModule());

let info: MockInstance<(...args: unknown[]) => void>;
beforeEach(() => {
  fake.reset();
  info = vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => info.mockRestore());

const BASE = "https://www.example.test";
const post = (id: string, headers: Record<string, string> = { Origin: BASE }) => new Request(`${BASE}/data-export/${id}`, { method: "POST", headers });
const as = (userId: string | null) => ({ service: {} as never, getUser: async () => (userId ? { id: userId } : null) });
const lines = () => info.mock.calls.map((c: unknown[]) => String(c[0])).filter((l) => l.startsWith("[data-export]"));

describe("the owner's POST", () => {
  it("downloads the full fixture once: bytes equal, attachment headers, the file deleted, both audit rows written, a second POST refused", async () => {
    const owner = randomUUID();
    const body = JSON.stringify({ tables: { profiles: [{ email: "x@example.test" }], pad: "y".repeat(5000) } });
    const row = seedExport({ user_id: owner, body });
    const res = await handleDownload(post(row.id), row.id, as(owner));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="talentrah-data-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.headers.get("content-length")).toBe(String(new Blob([body]).size));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await res.text()).toBe(body);

    expect(fake.objects.has(row.object_path!), "the object is deleted").toBe(false);
    expect(fake.rows.get(row.id)!.status).toBe("deleted");
    expect(fake.audit.map((a) => a.fn).sort()).toEqual(["deleted", "downloaded"]);
    expect(fake.audit.find((a) => a.fn === "deleted")!.reason).toBe("downloaded");

    const again = await handleDownload(post(row.id), row.id, as(owner));
    expect(again.status).toBe(404);
    expect(again.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("two POSTs at the same moment: exactly one gets the file", async () => {
    const owner = randomUUID();
    const row = seedExport({ user_id: owner });
    const results = await Promise.all(Array.from({ length: 4 }, () => handleDownload(post(row.id), row.id, as(owner))));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 404)).toHaveLength(3);
    await Promise.all(results.map((r) => r.text()));
  });

  it("GET-then-POST: a GET does not spend the single use, the POST afterwards does", async () => {
    const owner = randomUUID();
    const row = seedExport({ user_id: owner });
    const { handleConfirm } = await import("@/lib/data-export/confirm");
    await handleConfirm(new Request(`${BASE}/data-export/${row.id}`), row.id, as(owner));
    await handleConfirm(new Request(`${BASE}/data-export/${row.id}`), row.id, as(owner));
    const res = await handleDownload(post(row.id), row.id, as(owner));
    expect(res.status).toBe(200);
    await res.text();
  });
});

describe("a POST that is refused", () => {
  it("signed out: exactly 303 to the login URL with the return trip, nothing claimed (status recorded next to the GET's in download-confirm.test.ts)", async () => {
    const owner = randomUUID();
    const row = seedExport({ user_id: owner });
    const res = await handleDownload(post(row.id), row.id, as(null));
    process.stdout.write(`[observed] signed-out POST status = ${res.status}\n`);
    expect(res.status).toBe(303);
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("redirectTo")).toBe(`/data-export/${row.id}`);
    expect(fake.rows.get(row.id)!.claimed_at).toBeNull();
    expect(fake.calls.claim).toBe(0);
  });

  it("another account: the refusal is byte-identical to an unknown id's, a denied audit row, the owner can still use the link", async () => {
    const owner = randomUUID();
    const stranger = randomUUID();
    const row = seedExport({ user_id: owner });
    const ghost = randomUUID();
    const unknown = await (await handleDownload(post(ghost), ghost, as(owner))).text();
    const res = await handleDownload(post(row.id), row.id, as(stranger));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(unknown);
    expect(fake.rows.get(row.id)!.claimed_at).toBeNull();
    expect(fake.audit.filter((a) => a.fn === "denied")).toHaveLength(1);
    const ok = await handleDownload(post(row.id), row.id, as(owner));
    expect(ok.status).toBe(200);
    await ok.text();
  });

  it("an expired link: refused, and the expired object is deleted on the spot", async () => {
    const owner = randomUUID();
    const row = seedExport({ user_id: owner, expires_at: new Date(Date.now() - 1000).toISOString() });
    const res = await handleDownload(post(row.id), row.id, as(owner));
    expect(res.status).toBe(404);
    expect(fake.objects.has(row.object_path!)).toBe(false);
    expect(fake.rows.get(row.id)!.status).toBe("expired");
  });

  it("a malformed id: the refusal, nothing read", async () => {
    const res = await handleDownload(post("not-a-uuid"), "not-a-uuid", as(randomUUID()));
    expect(res.status).toBe(404);
    expect(fake.calls.claim).toBe(0);
  });
});

describe("the double-click on the server: the atomic claim makes a second POST a refusal", () => {
  it("a second POST after the first has finished is refused, and so is one that arrives while the first is streaming", async () => {
    const owner = randomUUID();
    const row = seedExport({ user_id: owner, body: "z".repeat(100_000) });
    const first = await handleDownload(post(row.id), row.id, as(owner));
    const second = await handleDownload(post(row.id), row.id, as(owner));
    expect([first.status, second.status]).toEqual([200, 404]);
    await first.text();
  });
});

describe("counts-only logging (part of DATA-EXPORT-DOWNLOAD-REAL-SESSION-1)", () => {
  it("a won claim writes exactly one line", async () => {
    const owner = randomUUID();
    const row = seedExport({ user_id: owner });
    await (await handleDownload(post(row.id), row.id, as(owner))).text();
    expect(lines()).toEqual(["[data-export] claimed"]);
  });

  it("claim_error: the claim threw", async () => {
    const owner = randomUUID();
    const row = seedExport({ user_id: owner });
    fake.failClaim = true;
    await handleDownload(post(row.id), row.id, as(owner));
    expect(lines()).toEqual(["[data-export] refusal class=claim_error"]);
  });

  it("not_claimable: the owner's own link that was already used, expired, deleted or never existed", async () => {
    const owner = randomUUID();
    const used = seedExport({ user_id: owner, status: "downloaded", claimed_at: new Date().toISOString() });
    await handleDownload(post(used.id), used.id, as(owner));
    const ghost = randomUUID();
    await handleDownload(post(ghost), ghost, as(owner));
    expect(lines()).toEqual(["[data-export] refusal class=not_claimable", "[data-export] refusal class=not_claimable"]);
  });

  it("denied: the row belongs to another account", async () => {
    const row = seedExport({ user_id: randomUUID() });
    await handleDownload(post(row.id), row.id, as(randomUUID()));
    expect(lines()).toEqual(["[data-export] refusal class=denied"]);
  });

  it("object_unreadable: the claim won but the object could not be read", async () => {
    const owner = randomUUID();
    const row = seedExport({ user_id: owner });
    fake.unreadable = true;
    const res = await handleDownload(post(row.id), row.id, as(owner));
    expect(res.status).toBe(404);
    expect(lines()).toEqual(["[data-export] refusal class=object_unreadable"]);
  });

  it("no line contains a UUID-shaped string or an @, and the GET writes no line at all", async () => {
    const owner = randomUUID();
    const row = seedExport({ user_id: owner });
    const { handleConfirm } = await import("@/lib/data-export/confirm");
    await handleConfirm(new Request(`${BASE}/data-export/${row.id}`), row.id, as(owner));
    expect(lines()).toEqual([]);
    await handleDownload(post(row.id), row.id, as(randomUUID()));
    fake.failClaim = true;
    await handleDownload(post(row.id), row.id, as(owner));
    fake.failClaim = false;
    fake.unreadable = true;
    await handleDownload(post(row.id), row.id, as(owner));
    const all = info.mock.calls.map((c: unknown[]) => c.map(String).join(" ")).join("\n");
    expect(lines().length).toBeGreaterThanOrEqual(3);
    expect(all).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(all).not.toContain("@");
  });
});
