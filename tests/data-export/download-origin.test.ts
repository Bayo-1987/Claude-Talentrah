/**
 * The POST's same-origin rule (owner amendment 2): Origin (or Referer when there is no Origin) must name the host the request arrived on, host plus port, case-insensitively; never a
 * hard-coded domain. A refusal claims nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fake, seedExport } from "../support/data-export-fake-store";
import { handleDownload } from "@/lib/data-export/download";
import { isOwnOrigin } from "@/lib/data-export/origin";

vi.mock("@/lib/data-export/store", async () => (await import("../support/data-export-fake-store")).storeModule());
vi.mock("@/lib/data-export/audit", async () => (await import("../support/data-export-fake-store")).auditModule());
beforeEach(() => fake.reset());

const PREVIEW = "talentrah-abc123-team.vercel.app";
function req(host: string, headers: Record<string, string>, url = `https://${host}/data-export/x`) {
  return new Request(url, { method: "POST", headers: { host, ...headers } });
}

describe("isOwnOrigin", () => {
  it("allows a matching Origin, including a different letter case", () => {
    expect(isOwnOrigin(req("www.example.test", { origin: "https://www.example.test" }))).toBe(true);
    expect(isOwnOrigin(req("www.example.test", { origin: "https://WWW.Example.TEST" }))).toBe(true);
    expect(isOwnOrigin(req("WWW.EXAMPLE.TEST", { origin: "https://www.example.test" }))).toBe(true);
  });

  it("allows a preview-style host (no hard-coded domain)", () => {
    expect(isOwnOrigin(req(PREVIEW, { origin: `https://${PREVIEW}` }))).toBe(true);
  });

  it("refuses a foreign host", () => {
    expect(isOwnOrigin(req("www.example.test", { origin: "https://evil.example" }))).toBe(false);
    expect(isOwnOrigin(req("www.example.test", { origin: "https://www.example.test.evil.example" }))).toBe(false);
  });

  it("refuses Origin: null", () => {
    expect(isOwnOrigin(req("www.example.test", { origin: "null" }))).toBe(false);
  });

  it("refuses the same host on a DIFFERENT PORT, and allows the same port", () => {
    expect(isOwnOrigin(req("localhost:3000", { origin: "http://localhost:3001" }))).toBe(false);
    expect(isOwnOrigin(req("localhost:3000", { origin: "http://localhost" }))).toBe(false);
    expect(isOwnOrigin(req("localhost:3000", { origin: "http://localhost:3000" }))).toBe(true);
  });

  it("refuses when both headers are missing", () => {
    expect(isOwnOrigin(req("www.example.test", {}))).toBe(false);
  });

  it("falls back to the Referer host only when there is no Origin", () => {
    expect(isOwnOrigin(req("www.example.test", { referer: "https://www.example.test/data-export/x" }))).toBe(true);
    expect(isOwnOrigin(req("www.example.test", { referer: "https://evil.example/data-export/x" }))).toBe(false);
    expect(isOwnOrigin(req("www.example.test", { referer: "not a url" }))).toBe(false);
  });

  it("a present Origin decides: a foreign Origin is not rescued by a matching Referer", () => {
    expect(isOwnOrigin(req("www.example.test", { origin: "https://evil.example", referer: "https://www.example.test/x" }))).toBe(false);
  });

  it("does not trust x-forwarded-host", () => {
    expect(isOwnOrigin(req("www.example.test", { origin: "https://evil.example", "x-forwarded-host": "evil.example" }))).toBe(false);
    expect(isOwnOrigin(req("www.example.test", { origin: "https://www.example.test", "x-forwarded-host": "evil.example" }))).toBe(true);
  });

  it("uses the request URL's host when no Host header is present", () => {
    const r = new Request("https://www.example.test/data-export/x", { method: "POST", headers: { origin: "https://www.example.test" } });
    expect(isOwnOrigin(r)).toBe(true);
  });
});

describe("a refused POST claims nothing", () => {
  it.each([
    ["a foreign Origin", { origin: "https://evil.example" }],
    ["Origin: null", { origin: "null" }],
    ["no Origin and no Referer", {}],
    ["a different port", { origin: "https://www.example.test:8443" }],
  ])("%s", async (_n, headers) => {
    const owner = randomUUID();
    const row = seedExport({ user_id: owner });
    const res = await handleDownload(req("www.example.test", headers, `https://www.example.test/data-export/${row.id}`), row.id, { service: {} as never, getUser: async () => ({ id: owner }) });
    expect(res.status).toBe(404);
    expect(fake.rows.get(row.id)!.claimed_at).toBeNull();
    expect(fake.calls.claim).toBe(0);
  });

  it("the matching preview host and a Referer-only request are allowed through to the claim", async () => {
    for (const headers of [{ origin: `https://${PREVIEW}` }, { referer: `https://${PREVIEW}/data-export/x` }] as Array<Record<string, string>>) {
      fake.reset();
      const owner = randomUUID();
      const row = seedExport({ user_id: owner });
      const res = await handleDownload(req(PREVIEW, headers, `https://${PREVIEW}/data-export/${row.id}`), row.id, { service: {} as never, getUser: async () => ({ id: owner }) });
      expect(res.status).toBe(200);
      await res.text();
    }
  });
});

describe("no hard-coded domain", () => {
  it("the origin comparison and the pages contain no production host", () => {
    for (const file of ["src/lib/data-export/origin.ts", "src/lib/data-export/download.ts", "src/lib/data-export/confirm.ts", "src/lib/data-export/pages.ts", "src/app/data-export/[id]/route.ts"]) {
      const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(src, file).not.toMatch(/talentrah\.(com|ng|app|io|co)\b/i);
      expect(src, file).not.toMatch(/vercel\.app/i);
      expect(src, file).not.toMatch(/https?:\/\/[a-z0-9-]+\.[a-z]{2,}/i);
    }
  });
});
