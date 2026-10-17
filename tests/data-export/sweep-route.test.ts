/**
 * GET /api/admin/sweep-data-exports: 401 without the bearer secret (and nothing is deleted); with it, it runs and answers COUNTS ONLY: no id, no name, no path.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { acquireBucketLock, releaseBucketLock } from "../support/bucket-lock";
import { bucketPaths, cleanupAll, emptyBucket, putObject } from "../support/data-export-fixtures";
import { fakeSecret } from "../support/fake-secret";

vi.mock("@/lib/supabase/service-role", async () => {
  const { countedService } = await import("../support/data-export-fixtures");
  return { createServiceRoleClient: () => countedService().client };
});

import { GET } from "@/app/api/admin/sweep-data-exports/route";
import * as routeModule from "@/app/api/admin/sweep-data-exports/route";

const SECRET = fakeSecret("token");
const call = (headers: Record<string, string> = {}) => GET(new Request("https://www.example.test/api/admin/sweep-data-exports", { headers }));

beforeAll(async () => {
  await acquireBucketLock();
}, 300_000);
beforeEach(async () => {
  vi.stubEnv("CRON_SECRET", SECRET);
  await emptyBucket();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  try {
    await cleanupAll();
  } finally {
    releaseBucketLock();
  }
}, 120_000);

describe("the sweep endpoint", () => {
  it("answers 401 without the secret, with a wrong one, or when none is configured, and deletes nothing", async () => {
    const stray = `${randomUUID()}.json`;
    await putObject(stray);
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer not-the-secret" })).status).toBe(401);
    expect((await call({ "x-admin-secret": SECRET })).status, "only the cron bearer is accepted").toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await call({ authorization: `Bearer ${SECRET}` })).status, "fail closed: no secret configured").toBe(401);
    expect(await bucketPaths()).toEqual([stray]);
  });

  it("with the secret it runs, deletes the orphan, and answers counts only (numbers and booleans: no id, no path, no name)", async () => {
    const stray = `${randomUUID()}/${randomUUID()}.json`;
    await putObject(stray);
    const res = await call({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as { summary: Record<string, unknown> };
    expect(Object.keys(body)).toEqual(["summary"]);
    for (const [k, v] of Object.entries(body.summary)) expect(["number", "boolean"], k).toContain(typeof v);
    expect(body.summary.orphansDeleted).toBe(1);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(text).not.toContain(".json");
    expect(await bucketPaths()).toEqual([]);
  });

  it("is GET only", () => {
    expect((routeModule as Record<string, unknown>).POST).toBeUndefined();
  });
});
