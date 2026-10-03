/**
 * /api/admin/purge-demo-attempts: its OWN route and its own cron entry (a failure in one purge must never stop another
 * sweep, and each has its own logs). The cron-secret guard, and what the route does once it is past it.
 *
 * (tests/api/contract.test.ts §0 also discovers this route from disk and asserts every exported method answers 401 with
 * no credential; the explicit cases here pin the cron path, the manual path, and the fail-closed behaviour by name.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fakeSecret } from "../support/fake-secret";

/** Generated per run: nothing credential-shaped in source. */
const CRON_VALUE = fakeSecret("token");

const purge = vi.fn();
vi.mock("@/lib/demo/attempt-retention", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/demo/attempt-retention")>();
  return { ...actual, purgeOldDemoAttempts: (...a: unknown[]) => purge(...a) };
});

const { GET, POST } = await import("@/app/api/admin/purge-demo-attempts/route");

const URL = "http://t/api/admin/purge-demo-attempts";
const OK = { cutoff: "2026-07-04T12:00:00.000Z", deleted: 3, rounds: 1, hitCap: false };

beforeEach(() => {
  purge.mockReset();
  purge.mockResolvedValue(OK);
  vi.stubEnv("CRON_SECRET", CRON_VALUE);
  vi.stubEnv("ADMIN_API_SECRET", "admin-secret-for-this-test");
  vi.stubEnv("INGEST_SECRET", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("the cron path (GET, Authorization: Bearer <CRON_SECRET>)", () => {
  it("REFUSES a request with no credential, and does not purge", async () => {
    const res = await GET(new Request(URL));
    expect(res.status).toBe(401);
    expect(purge).not.toHaveBeenCalled();
  });

  it("refuses a wrong bearer, a wrong scheme, and the admin secret presented as the cron secret", async () => {
    const wrong: Array<Record<string, string>> = [
      { authorization: "Bearer not-the-secret" },
      { authorization: CRON_VALUE },
      { authorization: `Basic ${CRON_VALUE}` },
      { "x-admin-secret": "admin-secret-for-this-test" },
    ];
    for (const headers of wrong) {
      const res = await GET(new Request(URL, { headers }));
      expect(res.status, JSON.stringify(headers)).toBe(401);
    }
    expect(purge).not.toHaveBeenCalled();
  });

  it("fails CLOSED: with no CRON_SECRET configured every request is refused, even one that sends 'Bearer undefined' or an empty bearer", async () => {
    vi.stubEnv("CRON_SECRET", "");
    for (const authorization of ["Bearer undefined", "Bearer ", "Bearer", ""]) {
      const res = await GET(new Request(URL, { headers: { authorization } }));
      expect(res.status, authorization).toBe(401);
    }
    expect(purge).not.toHaveBeenCalled();
  });

  it("with the right bearer it purges once and reports what it did", async () => {
    const res = await GET(new Request(URL, { headers: { authorization: `Bearer ${CRON_VALUE}` } }));
    expect(res.status).toBe(200);
    expect(purge).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ result: OK });
  });
});

describe("the manual path (POST, x-admin-secret)", () => {
  it("REFUSES a request with no credential, and does not purge", async () => {
    const res = await POST(new Request(URL, { method: "POST" }));
    expect(res.status).toBe(401);
    expect(purge).not.toHaveBeenCalled();
  });

  it("refuses the cron bearer on the manual path, and a wrong admin secret", async () => {
    const wrong: Array<Record<string, string>> = [{ authorization: `Bearer ${CRON_VALUE}` }, { "x-admin-secret": "nope" }];
    for (const headers of wrong) {
      expect((await POST(new Request(URL, { method: "POST", headers }))).status).toBe(401);
    }
    expect(purge).not.toHaveBeenCalled();
  });

  it("with the right admin secret it purges once", async () => {
    const res = await POST(new Request(URL, { method: "POST", headers: { "x-admin-secret": "admin-secret-for-this-test" } }));
    expect(res.status).toBe(200);
    expect(purge).toHaveBeenCalledTimes(1);
  });
});

describe("what it does once past the guard", () => {
  const authed = () => new Request(URL, { headers: { authorization: `Bearer ${CRON_VALUE}` } });

  it("a purge that reports an error is a 500, and the error is in the body (a purge whose logs go quiet is the bug)", async () => {
    purge.mockResolvedValue({ ...OK, deleted: 4, error: "delete failed" });
    const res = await GET(authed());
    expect(res.status).toBe(500);
    expect((await res.json()).result.error).toBe("delete failed");
  });

  it("a purge that throws is a 500 that does not leak the error text", async () => {
    purge.mockRejectedValue(new Error("connection string postgres://user:pw@host/db"));
    const res = await GET(authed());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("postgres://");
  });

  it("logs a summary line on EVERY run, including a run that hit the cap (so the next run's work is visible)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    purge.mockResolvedValue({ ...OK, hitCap: true, rounds: 10, deleted: 10_000 });
    await GET(authed());
    const lines = log.mock.calls.map((c) => String(c[0]));
    log.mockRestore();
    const line = lines.find((l) => l.includes("[demo-attempt-purge]"));
    expect(line, "no [demo-attempt-purge] summary line").toBeDefined();
    expect(line).toContain("deleted=10000");
    expect(line).toMatch(/hitCap=true/);
    expect(line).toMatch(/cron/);
  });
});

describe("its own cron entry in vercel.json", () => {
  const config = JSON.parse(readFileSync(path.resolve(__dirname, "../../vercel.json"), "utf8")) as {
    crons: Array<{ path: string; schedule: string }>;
  };

  it("is scheduled exactly once, daily, on its own path", () => {
    const entries = config.crons.filter((c) => c.path === "/api/admin/purge-demo-attempts");
    expect(entries).toHaveLength(1);
    // five fields, a fixed minute and hour, every day: a daily job like its siblings
    expect(entries[0].schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });

  it("is NOT folded into another route's schedule: no other cron path mentions it", () => {
    expect(config.crons.filter((c) => /purge-demo-attempts/.test(c.path))).toHaveLength(1);
  });
});
