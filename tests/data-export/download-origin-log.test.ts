/**
 * DATA-EXPORT follow-up 3: a POST refused by the same-origin check writes exactly ONE line, "[data-export] refusal class=origin_refused": no id, no header value, nothing else. Without it a real click
 * that the check refuses (the browser sent "Origin: null", say) would look to the operator exactly like an expired link. An allowed POST writes none of these lines. In-memory store, no database.
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

const HOST = "www.example.test";
const lines = () => info.mock.calls.map((c: unknown[]) => String(c[0])).filter((l) => l.startsWith("[data-export]"));
const LINE = "[data-export] refusal class=origin_refused";

async function postWith(headers: Record<string, string>) {
  const owner = randomUUID();
  const row = seedExport({ user_id: owner });
  const res = await handleDownload(new Request(`https://${HOST}/data-export/${row.id}`, { method: "POST", headers: { host: HOST, ...headers } }), row.id, { service: {} as never, getUser: async () => ({ id: owner }) });
  return { res, row };
}

describe("a refused POST writes exactly one origin_refused line", () => {
  it.each([
    ["a foreign Origin", { origin: "https://evil.example" }],
    ["Origin: null", { origin: "null" }],
    ["no Origin and no Referer", {}],
    ["a different port", { origin: `https://${HOST}:8443` }],
  ] as Array<[string, Record<string, string>]>)("%s", async (_n, headers) => {
    const { res, row } = await postWith(headers);
    expect(res.status).toBe(404);
    expect(lines()).toEqual([LINE]);
    expect(fake.rows.get(row.id)!.claimed_at).toBeNull();
  });

  it("the line carries no id, no address and no header value (the no-UUID, no-@ rule)", async () => {
    for (const headers of [{ origin: "https://evil.example/leak?x=a@b.example" }, { origin: "null" }, {}] as Array<Record<string, string>>) {
      info.mockClear();
      await postWith(headers);
      const all = lines().join("\n");
      expect(all).toBe(LINE);
      expect(all).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      expect(all).not.toContain("@");
      expect(all).not.toContain("evil.example");
    }
  });
});

describe("an allowed POST writes none of these lines", () => {
  it("a matching Origin goes through to the claim: [data-export] claimed, and no origin_refused", async () => {
    const { res } = await postWith({ origin: `https://${HOST}` });
    expect(res.status).toBe(200);
    await res.text();
    expect(lines()).toEqual(["[data-export] claimed"]);
    expect(lines().some((l) => l.includes("origin_refused"))).toBe(false);
  });
  it("a request refused later (not the owner's file) is not an origin refusal", async () => {
    const owner = randomUUID();
    const row = seedExport({ user_id: owner });
    await handleDownload(new Request(`https://${HOST}/data-export/${row.id}`, { method: "POST", headers: { host: HOST, origin: `https://${HOST}` } }), row.id, { service: {} as never, getUser: async () => ({ id: randomUUID() }) });
    expect(lines().some((l) => l.includes("origin_refused"))).toBe(false);
  });
});
