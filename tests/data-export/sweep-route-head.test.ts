/**
 * The sweep route's HEAD behaviour, FIXED AS IT IS TODAY (the route is deliberately left unchanged).
 *
 * Recorded on a real `next build && next start` (Next 16.3.8, 18 Oct 2026): for a route that exports only GET, Next answers HEAD by RUNNING THE GET HANDLER (HEAD /api/admin/sweep-data-exports
 * answered 401, the same as GET without the secret) and answers OPTIONS itself with 204. That is safe here only because the GET handler's FIRST act is the bearer-secret check, before any
 * database client exists. This test pins exactly that, without a server or a database:
 *   - the route exports GET and nothing else (no HEAD, no POST, no OPTIONS): HEAD takes Next's default of running GET;
 *   - GET without the secret (which is what a HEAD without the secret becomes) answers 401 and creates no service client;
 *   - in the source, requireCronSecret is called before createServiceRoleClient, and a denied caller returns before any other statement.
 * If someone adds a HEAD export, or moves the secret check below the client, this fails and the HEAD behaviour is decided again on purpose.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ clients: 0 }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => {
    h.clients += 1;
    throw new Error("the sweep route created a service client for an unauthenticated caller");
  },
}));

import { GET } from "@/app/api/admin/sweep-data-exports/route";
import * as route from "@/app/api/admin/sweep-data-exports/route";

describe("sweep route HEAD behaviour (fixed as it is now)", () => {
  it("exports GET and no other method handler, so HEAD runs GET (Next's default) and OPTIONS is automatic", () => {
    const handlers = Object.keys(route).filter((k) => ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(k));
    expect(handlers).toEqual(["GET"]);
  });

  it("a request without the secret (what a HEAD becomes) answers 401 and creates no database client", async () => {
    vi.stubEnv("CRON_SECRET", "x".repeat(32));
    const res = await GET(new Request("https://www.example.test/api/admin/sweep-data-exports", { method: "HEAD" }));
    expect(res.status).toBe(401);
    expect(h.clients).toBe(0);
    vi.unstubAllEnvs();
  });

  it("the secret check comes first in the handler: before the client, and a denial returns immediately", () => {
    const src = readFileSync("src/app/api/admin/sweep-data-exports/route.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const body = src.slice(src.indexOf("export async function GET"));
    expect(body.indexOf("requireCronSecret(")).toBeGreaterThan(-1);
    expect(body.indexOf("requireCronSecret(")).toBeLessThan(body.indexOf("createServiceRoleClient("));
    expect(body).toMatch(/const denied = requireCronSecret\(request\);\s*if \(denied\) return denied;/);
  });
});
