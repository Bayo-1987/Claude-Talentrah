/**
 * DATA-EXPORT follow-up 2: ONE Referrer-Policy, `same-origin`, on everything under /data-export: the handler's HTML responses, its redirects, the POST's file response, the <meta name="referrer"> tag in the
 * pages, and the next.config.ts rule for /data-export/:path*. No exception, and none of them is `no-referrer` (a form POST from a no-referrer page goes out with `Origin: null`, which the POST's same-origin
 * check refuses: e2e/data-export-origin.spec.ts proves that in a real browser) or `never`. In-memory store, no database.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import nextConfig from "../../next.config";
import { fake, seedExport } from "../support/data-export-fake-store";
import { handleConfirm } from "@/lib/data-export/confirm";
import { handleDownload } from "@/lib/data-export/download";
import { renderConfirmPage, renderRefusalPage } from "@/lib/data-export/pages";
import { REFERRER_POLICY } from "@/lib/data-export/referrer-policy";

vi.mock("@/lib/data-export/store", async () => (await import("../support/data-export-fake-store")).storeModule());
vi.mock("@/lib/data-export/audit", async () => (await import("../support/data-export-fake-store")).auditModule());

let info: MockInstance<(...args: unknown[]) => void>;
beforeEach(() => {
  fake.reset();
  info = vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => info.mockRestore());

const HOST = "www.example.test";
const as = (userId: string | null) => ({ service: {} as never, getUser: async () => (userId ? { id: userId } : null) });
const get = (id: string) => new Request(`https://${HOST}/data-export/${id}`, { method: "GET", headers: { host: HOST } });
const post = (id: string, origin: string | null = `https://${HOST}`) => new Request(`https://${HOST}/data-export/${id}`, { method: "POST", headers: { host: HOST, ...(origin ? { origin } : {}) } });

type Rule = { source: string; headers: Array<{ key: string; value: string }> };
const rulePolicy = async (): Promise<string | undefined> => {
  const rules = (await nextConfig.headers!()) as Rule[];
  const rule = rules.find((r) => r.source === "/data-export/:path*");
  return rule?.headers.find((h) => h.key.toLowerCase() === "referrer-policy")?.value;
};

describe("the one value", () => {
  it("is same-origin", () => expect(REFERRER_POLICY).toBe("same-origin"));

  it("the next.config.ts rule for /data-export/:path* carries it (a literal there, pinned equal to the constant)", async () => {
    expect(await rulePolicy()).toBe(REFERRER_POLICY);
  });

  it("the <meta name=referrer> tag of both pages carries it", () => {
    for (const html of [renderConfirmPage({ id: randomUUID(), expiresText: "2026-10-22 09:30 UTC" }), renderRefusalPage()]) {
      expect(html).toContain(`<meta name="referrer" content="${REFERRER_POLICY}">`);
      expect([...html.matchAll(/<meta name="referrer" content="([^"]*)">/g)].map((m) => m[1])).toEqual([REFERRER_POLICY]);
    }
  });

  it("every response the handler can send carries it: the confirm page, the refusal page, the login redirects (GET 302 and POST 303), the POST's refusal and the file itself", async () => {
    const owner = randomUUID();
    const row = seedExport({ user_id: owner });
    const answers: Array<[string, Response]> = [
      ["confirm page (200)", await handleConfirm(get(row.id), row.id, as(owner))],
      ["GET refusal (404)", await handleConfirm(get(randomUUID()), randomUUID(), as(owner))],
      ["GET signed-out redirect (302)", await handleConfirm(get(row.id), row.id, as(null))],
      ["POST signed-out redirect (303)", await handleDownload(post(row.id), row.id, as(null))],
      ["POST origin refusal (404)", await handleDownload(post(row.id, "https://evil.example"), row.id, as(owner))],
      ["POST not-claimable refusal (404)", await handleDownload(post(randomUUID()), randomUUID(), as(owner))],
      ["POST file (200)", await handleDownload(post(row.id), row.id, as(owner))],
    ];
    const statuses = answers.map(([n, r]) => `${n}: ${r.status}`);
    expect(statuses).toEqual(["confirm page (200): 200", "GET refusal (404): 404", "GET signed-out redirect (302): 302", "POST signed-out redirect (303): 303", "POST origin refusal (404): 404", "POST not-claimable refusal (404): 404", "POST file (200): 200"]);
    for (const [name, res] of answers) expect(res.headers.get("referrer-policy"), name).toBe(REFERRER_POLICY);
    await answers[6][1].text();
  });
});

describe("none of them is no-referrer or never", () => {
  it("no Referrer-Policy value in the handler's source, the pages or the next.config.ts rule is no-referrer or never", () => {
    for (const file of ["src/lib/data-export/download.ts", "src/lib/data-export/confirm.ts", "src/lib/data-export/pages.ts", "src/lib/data-export/referrer-policy.ts", "src/app/data-export/[id]/route.ts"]) {
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/["'](no-referrer|never)["']/);
      expect(code, file).not.toMatch(/content="(no-referrer|never)"/);
    }
    const config = readFileSync("next.config.ts", "utf8");
    const rule = config.slice(config.indexOf('source: "/data-export/:path*"'), config.indexOf('source: "/data-export/:path*"') + 200);
    expect(rule).toContain('value: "same-origin"');
    expect(rule).not.toMatch(/no-referrer|never/);
  });
});
