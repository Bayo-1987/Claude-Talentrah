/**
 * /api/admin/sweep-farah-paid-holds: the daily paid-hold sweep. Its own route and cron entry. The guards (it moves money into accounts, so it is not open), the count the daily digest reads, a 500 when the run was not
 * clean, and the cron registration. (tests/api/contract.test.ts also discovers every route from disk and asserts a 401 with no credential.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import vercelConfig from "../../vercel.json";
import { fakeSecret } from "../support/fake-secret";

const CRON_VALUE = fakeSecret("token");
const sweep = vi.fn();
vi.mock("@/lib/farah/paid-hold-sweep", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/farah/paid-hold-sweep")>()), sweepPaidHolds: (...a: unknown[]) => sweep(...a) }));

const { GET, POST } = await import("@/app/api/admin/sweep-farah-paid-holds/route");
const URL = "http://t/api/admin/sweep-farah-paid-holds";
const CLEAN = { ok: true, examined: 4, orphaned: 2, refunded: 2, alreadyRefunded: 0, failed: 0 };

beforeEach(() => {
  sweep.mockReset();
  sweep.mockResolvedValue(CLEAN);
  vi.stubEnv("CRON_SECRET", CRON_VALUE);
  vi.stubEnv("ADMIN_API_SECRET", "admin-secret-for-this-test");
  vi.stubEnv("INGEST_SECRET", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("the cron path (GET, Authorization: Bearer <CRON_SECRET>)", () => {
  it("refuses no credential, a wrong bearer, a wrong scheme and the admin secret, and sweeps nothing", async () => {
    for (const headers of [{}, { authorization: "Bearer not-the-secret" }, { authorization: CRON_VALUE }, { authorization: `Basic ${CRON_VALUE}` }, { "x-admin-secret": "admin-secret-for-this-test" }] as Array<Record<string, string>>) {
      expect((await GET(new Request(URL, { headers }))).status, JSON.stringify(headers)).toBe(401);
    }
    expect(sweep).not.toHaveBeenCalled();
  });
  it("fails closed with no CRON_SECRET configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    for (const authorization of ["Bearer undefined", "Bearer ", "Bearer", ""]) expect((await GET(new Request(URL, { headers: { authorization } }))).status, authorization).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
  });
  it("with the right bearer it sweeps once and answers the counts the digest reads", async () => {
    const res = await GET(new Request(URL, { headers: { authorization: `Bearer ${CRON_VALUE}` } }));
    expect(res.status).toBe(200);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ summary: { ok: true, examined: 4, orphaned: 2, refunded: 2, alreadyRefunded: 0, failed: 0 } });
  });
});

describe("the manual path (POST, x-admin-secret)", () => {
  it("refuses no credential and the cron bearer; sweeps with the admin secret", async () => {
    expect((await POST(new Request(URL, { method: "POST" }))).status).toBe(401);
    expect((await POST(new Request(URL, { method: "POST", headers: { authorization: `Bearer ${CRON_VALUE}` } }))).status).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
    expect((await POST(new Request(URL, { method: "POST", headers: { "x-admin-secret": "admin-secret-for-this-test" } }))).status).toBe(200);
    expect(sweep).toHaveBeenCalledTimes(1);
  });
});

describe("a run that was not clean", () => {
  const authed = () => new Request(URL, { headers: { authorization: `Bearer ${CRON_VALUE}` } });
  it("a failed refund answers 500 and still reports the counts", async () => {
    sweep.mockResolvedValue({ ...CLEAN, ok: false, refunded: 1, failed: 1 });
    const res = await GET(authed());
    expect(res.status).toBe(500);
    expect((await res.json()).summary).toMatchObject({ failed: 1, refunded: 1 });
  });
  it("an unreadable work list answers 500 and the body does not carry the database's text", async () => {
    sweep.mockResolvedValue({ ...CLEAN, ok: false, examined: 0, orphaned: 0, refunded: 0, readError: "relation secret_table does not exist" });
    const res = await GET(authed());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret_table");
  });
  it("a sweep that throws is a 500 that does not leak the error text", async () => {
    sweep.mockRejectedValue(new Error("connection string postgres://user:pw@host/db"));
    const res = await GET(authed());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("postgres://");
  });
});

describe("vercel.json", () => {
  it("schedules it once a day, at a fixed time", () => {
    const entries = (vercelConfig as { crons: Array<{ path: string; schedule: string }> }).crons.filter((c) => c.path === "/api/admin/sweep-farah-paid-holds");
    expect(entries).toHaveLength(1);
    expect(entries[0].schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });
});
