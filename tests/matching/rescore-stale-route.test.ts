/**
 * The stale-score rescore route is a one-off write path over every user's stored scores, behind the shared admin secret. Behaviour, not
 * source text: a request without the secret (or with a wrong one, or when no secret is configured at all) gets a bare 401 with no
 * detail and the job never runs; a correct secret runs it, a dry run by default, bounded when it writes.
 *
 * The comparison itself is the shared constant-time one (src/lib/api/admin-auth.ts, timingSafeEqual, with an equal-cost path for a
 * wrong-LENGTH secret); this file checks the route really goes through it by sending a wrong secret of the same length and of a
 * different length and getting the identical answer, and tests/api/contract.test.ts sweeps every route under /api/admin for 401.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ran = vi.fn();
vi.mock("@/lib/matching/rescore-stale-job", () => ({
  runRescoreStaleJob: (...a: unknown[]) => {
    ran(...a);
    return Promise.resolve({
      ok: true,
      dryRun: true,
      staleRows: 0,
      usersWithStaleRows: 0,
      usersRescored: 0,
      rowsToRescore: 0,
      rowsRescored: 0,
      skippedNoBaseResume: [],
      skippedPostingGone: 0,
      failed: 0,
      errors: [],
      nextCursor: null,
      complete: true,
      stoppedBy: null,
    });
  },
}));

const ADMIN_HEADER_VALUE = "admin-header-value-for-this-test";
const url = "http://localhost/api/admin/rescore-stale-match-scores";
const post = (headers: Record<string, string> = {}, body?: unknown) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

async function call(req: Request) {
  const { POST } = await import("@/app/api/admin/rescore-stale-match-scores/route");
  return POST(req);
}

describe("rescore-stale-match-scores route: authentication", () => {
  const saved = { a: process.env.ADMIN_API_SECRET, i: process.env.INGEST_SECRET };
  beforeEach(() => {
    ran.mockClear();
    delete process.env.ADMIN_API_SECRET;
    process.env.INGEST_SECRET = ADMIN_HEADER_VALUE;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (saved.a === undefined) delete process.env.ADMIN_API_SECRET;
    else process.env.ADMIN_API_SECRET = saved.a;
    if (saved.i === undefined) delete process.env.INGEST_SECRET;
    else process.env.INGEST_SECRET = saved.i;
  });

  it("no secret: 401, a body that is exactly { error: 'Unauthorized' } (no detail), and the job never runs", async () => {
    const res = await call(post({}, { write: true }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(ran).not.toHaveBeenCalled();
  });

  it("a wrong secret of the SAME length and one of a DIFFERENT length get the identical 401 and nothing runs", async () => {
    const sameLength = "x".repeat(ADMIN_HEADER_VALUE.length);
    for (const wrong of [sameLength, "short", ADMIN_HEADER_VALUE + "!"]) {
      const res = await call(post({ "x-admin-secret": wrong }, { write: true }));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    }
    expect(ran).not.toHaveBeenCalled();
  });

  it("no secret configured on the server: still 401 (fails closed), even for a request that sends one", async () => {
    delete process.env.INGEST_SECRET;
    const res = await call(post({ "x-admin-secret": ADMIN_HEADER_VALUE }, { write: true }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(ran).not.toHaveBeenCalled();
  });

  it("the correct secret runs it, as a DRY RUN unless the body says write:true", async () => {
    const res = await call(post({ "x-admin-secret": ADMIN_HEADER_VALUE }));
    expect(res.status).toBe(200);
    expect(ran).toHaveBeenCalledTimes(1);
    expect(ran.mock.calls[0][0]).toMatchObject({ dryRun: true });
  });
});

describe("rescore-stale-match-scores route: bounded writes", () => {
  beforeEach(() => {
    ran.mockClear();
    process.env.INGEST_SECRET = ADMIN_HEADER_VALUE;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());
  const authed = { "x-admin-secret": ADMIN_HEADER_VALUE };

  it("write:true is bounded by default (a maxRows) and has a deadline, so a timeout cannot be the normal way it ends", async () => {
    await call(post(authed, { write: true }));
    const opts = ran.mock.calls[0][0] as { dryRun: boolean; maxRows?: number; shouldStop?: () => boolean };
    expect(opts.dryRun).toBe(false);
    expect(opts.maxRows).toBeGreaterThan(0);
    expect(typeof opts.shouldStop).toBe("function");
    expect(opts.shouldStop!()).toBe(false);
  });

  it("passes the caller's maxRows and cursor through", async () => {
    const cursor = "11111111-1111-4111-8111-111111111111";
    await call(post(authed, { write: true, maxRows: 250, cursor }));
    expect(ran.mock.calls[0][0]).toMatchObject({ dryRun: false, maxRows: 250, cursor });
  });

  it("a dry run is unbounded unless the caller asks, so its counts cover everything", async () => {
    await call(post(authed, {}));
    expect((ran.mock.calls[0][0] as { maxRows?: number }).maxRows).toBeUndefined();
  });

  it("rejects a malformed maxRows or cursor with a 400 and runs nothing", async () => {
    for (const body of [{ maxRows: 0 }, { maxRows: -5 }, { maxRows: 1.5 }, { maxRows: "100" }, { maxRows: 100000 }, { cursor: 7 }, { cursor: "not-a-uuid" }]) {
      const res = await call(post(authed, { write: true, ...body }));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(ran).not.toHaveBeenCalled();
  });
});
