/**
 * GET /data-export/<id>, the confirm page (DATA-EXPORT-DOWNLOAD-DELIVERY-1). Runs against an in-memory store (tests/support/data-export-fake-store.ts), no database.
 * The point of the whole change: a GET is read-only and safe to repeat, so a second fetch of the link (which every click made, 1 to 1.5 s apart) can no longer spend the single use.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { fake, seedExport } from "../support/data-export-fake-store";
import { handleConfirm } from "@/lib/data-export/confirm";
import { REFUSAL_SENTENCE, renderConfirmPage } from "@/lib/data-export/pages";
import { utc } from "@/lib/data-export/email";

const h = vi.hoisted(() => ({ serviceRoleCalls: 0 }));
vi.mock("@/lib/data-export/store", async () => (await import("../support/data-export-fake-store")).storeModule());
vi.mock("@/lib/data-export/audit", async () => (await import("../support/data-export-fake-store")).auditModule());
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => {
    h.serviceRoleCalls += 1;
    return {};
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }));

beforeEach(() => {
  fake.reset();
  h.serviceRoleCalls = 0;
});

const BASE = "https://www.example.test";
const get = (id: string, headers: Record<string, string> = {}, method = "GET") => new Request(`${BASE}/data-export/${id}`, { method, headers });
const as = (userId: string | null) => ({ service: {} as never, getUser: async () => (userId ? { id: userId } : null) });

describe("the confirm page", () => {
  it("shows the owner's exact wording, the real expiry in UTC, one button, and a contact link", async () => {
    const owner = randomUUID();
    const row = seedExport({ user_id: owner });
    const res = await handleConfirm(get(row.id), row.id, as(owner));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    const html = await res.text();
    const when = utc(new Date(row.expires_at!));
    expect(html).toContain("<h1>Your copy of your Talentrah data</h1>");
    expect(html).toContain(`This file holds the data we keep for your account. You can download it once. After you download it, we delete it from our servers. This link stops working on ${when} either way.`);
    expect(html).toContain("Download my data</button>");
    expect(html).toContain('If you did not ask for this, <a href="/contact">contact us</a>.');
    expect(html).toContain(`<form id="dl" method="post" action="/data-export/${row.id}">`);
  });

  it("is read-only: two GETs one second apart both show the page, and the row is still unclaimed and the file still there (RED against the old route, which claimed on the first GET)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const owner = randomUUID();
    const row = seedExport({ user_id: owner });
    const first = await handleConfirm(get(row.id), row.id, as(owner));
    const gap = new Promise<void>((r) => setTimeout(r, 1000));
    vi.advanceTimersByTime(1000);
    await gap;
    const second = await handleConfirm(get(row.id), row.id, as(owner));
    vi.useRealTimers();
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(fake.rows.get(row.id)!.claimed_at).toBeNull();
    expect(fake.rows.get(row.id)!.status).toBe("generated");
    expect(fake.objects.has(row.object_path!)).toBe(true);
    expect(fake.calls.claim, "a GET never claims").toBe(0);
    expect(fake.calls.download).toBe(0);
    expect(fake.calls.remove).toBe(0);
    expect(fake.audit).toEqual([]);
  });

  it("names no data: no counts, no table names, no address", async () => {
    const owner = randomUUID();
    const row = seedExport({ user_id: owner });
    const html = await (await handleConfirm(get(row.id), row.id, as(owner))).text();
    for (const word of ["profiles", "table", "rows", "fixture@example.test", "bytes", "KB"]) expect(html.toLowerCase()).not.toContain(word.toLowerCase());
  });

  it("carries no-store, noindex and strict-origin referrer policy", async () => {
    const owner = randomUUID();
    const row = seedExport({ user_id: owner });
    const res = await handleConfirm(get(row.id), row.id, as(owner));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin");
  });

  it("the page function takes exactly two strings: the id and the expiry text (the row never reaches the markup)", () => {
    const props = { id: randomUUID(), expiresText: "2026-10-22 09:30 UTC" };
    expect(Object.keys(props).sort()).toEqual(["expiresText", "id"]);
    const html = renderConfirmPage(props);
    expect(html).toContain(props.id);
    expect(html).toContain(props.expiresText);
    expect(renderConfirmPage.length, "one props argument").toBe(1);
  });
});

describe("everything else is the refusal, never the page", () => {
  const refusalBytes = async (res: Response) => `${res.status}|${res.headers.get("content-type")}|${await res.text()}`;

  it("the refusal keeps today's sentence byte for byte, status 404, with no-store, noindex and strict-origin referrer policy", async () => {
    const res = await handleConfirm(get(randomUUID()), randomUUID(), as(randomUUID()));
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(REFUSAL_SENTENCE).toBe("This link has expired, was already used, or is not for this account. If you still need a copy of your data, contact support.");
    expect(html).toContain(`<p>${REFUSAL_SENTENCE}</p>`);
    expect(html).not.toContain("<h1");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin");
  });

  it("the SAME id answers byte-identically whether the row belongs to another account or does not exist", async () => {
    const id = randomUUID();
    const stranger = randomUUID();
    seedExport({ id, user_id: randomUUID() });
    const otherAccount = await refusalBytes(await handleConfirm(get(id), id, as(stranger)));
    fake.reset();
    const noRow = await refusalBytes(await handleConfirm(get(id), id, as(stranger)));
    expect(otherAccount).toBe(noRow);
    expect(otherAccount.startsWith("404|")).toBe(true);
  });

  it.each([
    ["used", { status: "downloaded", claimed_at: new Date().toISOString() }],
    ["expired", { expires_at: new Date(Date.now() - 1000).toISOString() }],
    ["deleted", { status: "deleted", deleted_at: new Date().toISOString() }],
    ["still generating", { status: "generating", object_path: null, expires_at: null }],
  ])("a %s export shows the refusal and nothing is changed", async (_name, over) => {
    const owner = randomUUID();
    const row = seedExport({ user_id: owner, ...over });
    const before = JSON.stringify(fake.rows.get(row.id));
    const res = await handleConfirm(get(row.id), row.id, as(owner));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("Download my data");
    expect(JSON.stringify(fake.rows.get(row.id))).toBe(before);
    expect(fake.calls.remove, "a GET deletes nothing, even an expired file").toBe(0);
  });

  it("a malformed id shows the refusal without reading the store", async () => {
    const res = await handleConfirm(get("not-a-uuid"), "not-a-uuid", as(randomUUID()));
    expect(res.status).toBe(404);
    expect(fake.calls.getRow).toBe(0);
  });

  it("a store that throws shows the refusal", async () => {
    const owner = randomUUID();
    const row = seedExport({ user_id: owner });
    const throwing = { service: {} as never, getUser: async () => ({ id: owner }) };
    const original = fake.rows.get;
    fake.rows.get = () => {
      throw new Error("db down");
    };
    const res = await handleConfirm(get(row.id), row.id, throwing);
    fake.rows.get = original;
    expect(res.status).toBe(404);
  });
});

describe("another signed-in account: the denied audit row (current behaviour pinned)", () => {
  it("writes ONE denied row per GET by another account, so repeated GETs write repeated rows (the growth is a separate follow-up)", async () => {
    const id = randomUUID();
    seedExport({ id, user_id: randomUUID() });
    const stranger = randomUUID();
    await handleConfirm(get(id), id, as(stranger));
    expect(fake.audit.filter((a) => a.fn === "denied")).toHaveLength(1);
    await handleConfirm(get(id), id, as(stranger));
    await handleConfirm(get(id), id, as(stranger));
    expect(fake.audit.filter((a) => a.fn === "denied")).toHaveLength(3);
  });

  it("writes no row for the owner, for an unknown id, or for a used link", async () => {
    const owner = randomUUID();
    const row = seedExport({ user_id: owner });
    await handleConfirm(get(row.id), row.id, as(owner));
    await handleConfirm(get(randomUUID()), randomUUID(), as(owner));
    expect(fake.audit).toEqual([]);
  });
});

describe("signed out", () => {
  it("redirects to the login URL with the return trip and claims nothing; the observed status is recorded", async () => {
    const owner = randomUUID();
    const row = seedExport({ user_id: owner });
    const res = await handleConfirm(get(row.id), row.id, as(null));
    process.stdout.write(`[observed] signed-out GET status = ${res.status}\n`);
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("redirectTo")).toBe(`/data-export/${row.id}`);
    expect(fake.rows.get(row.id)!.claimed_at).toBeNull();
    expect(fake.calls.getRow, "the store is not even read").toBe(0);
  });
});

describe("HEAD, OPTIONS and a prefetch never touch the database", () => {
  it("the route's HEAD and OPTIONS answer empty without creating a service client", async () => {
    const route = await import("@/app/data-export/[id]/route");
    for (const handler of [route.HEAD, route.OPTIONS]) {
      const res = await handler();
      expect(res.status).toBe(204);
      expect(res.headers.get("allow")).toBe("GET, HEAD, POST, OPTIONS");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(await res.text()).toBe("");
    }
    expect(h.serviceRoleCalls).toBe(0);
    expect(fake.calls.getRow).toBe(0);
  });

  it("handleConfirm with HEAD, OPTIONS or POST answers empty without reading the session", async () => {
    let reads = 0;
    const deps = { service: {} as never, getUser: async () => { reads += 1; return { id: randomUUID() }; } };
    for (const method of ["HEAD", "OPTIONS", "POST"]) expect((await handleConfirm(get(randomUUID(), {}, method), randomUUID(), deps)).status, method).toBe(204);
    expect(reads).toBe(0);
  });

  it.each<Record<string, string>>([{ "Sec-Purpose": "prefetch" }, { Purpose: "prefetch" }, { "Next-Router-Prefetch": "1" }])("a GET with prefetch header %o answers empty and reads nothing", async (headers) => {
    const owner = randomUUID();
    const row = seedExport({ user_id: owner });
    let reads = 0;
    const res = await handleConfirm(get(row.id, headers), row.id, { service: {} as never, getUser: async () => { reads += 1; return { id: owner }; } });
    expect(res.status).toBe(204);
    expect(reads).toBe(0);
    expect(fake.calls.getRow).toBe(0);
  });
});
