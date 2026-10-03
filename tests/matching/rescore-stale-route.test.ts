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
const verifyRan = vi.fn();
const state = vi.hoisted(() => ({ summary: null as null | Record<string, unknown> }));
const BASE_SUMMARY = {
  ok: true,
  dryRun: true,
  staleRows: 0,
  usersWithStaleRows: 0,
  usersRescored: 0,
  rowsToRescore: 0,
  rowsRescored: 0,
  skippedNoBaseResume: [] as Array<{ userId: string; rows: number }>,
  skippedPostingGone: 0,
  skippedStubSkill: 0,
  failed: 0,
  errors: [] as Array<{ userId: string; message: string }>,
  nextCursor: null as string | null,
  complete: true,
  stoppedBy: null,
  shape: { rows: 0 },
};
vi.mock("@/lib/matching/rescore-stale-job", () => ({
  runRescoreStaleJob: (...a: unknown[]) => {
    ran(...a);
    return Promise.resolve(state.summary ?? BASE_SUMMARY);
  },
  runVerifyRescoredSample: (...a: unknown[]) => {
    verifyRan(...a);
    return Promise.resolve({ checked: 20, matching: 20, mismatching: 0, unverifiable: 0 });
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
    verifyRan.mockClear();
    state.summary = null;
    delete process.env.ADMIN_API_SECRET;
    delete process.env.CRON_SECRET;
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

describe("rescore-stale-match-scores route: the cron secret path (how the manual workflow calls it)", () => {
  const CRON_VALUE = "cron-header-value-for-this-test";
  beforeEach(() => {
    ran.mockClear();
    state.summary = null;
    process.env.INGEST_SECRET = ADMIN_HEADER_VALUE;
    process.env.CRON_SECRET = CRON_VALUE;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CRON_SECRET;
  });

  it("accepts the Bearer cron secret, and still runs only as a dry run unless the body says write", async () => {
    const res = await call(post({ authorization: `Bearer ${CRON_VALUE}` }));
    expect(res.status).toBe(200);
    expect(ran).toHaveBeenCalledTimes(1);
    expect(ran.mock.calls[0][0]).toMatchObject({ dryRun: true });
  });

  it("a wrong bearer (same length and different length), no credential, or a bearer when CRON_SECRET is unset: the same bare 401 and the job never runs", async () => {
    for (const authorization of [`Bearer ${"x".repeat(CRON_VALUE.length)}`, "Bearer short", `Bearer ${CRON_VALUE}!`, undefined]) {
      const res = await call(post(authorization ? { authorization } : {}, { write: true }));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    }
    delete process.env.CRON_SECRET;
    const res = await call(post({ authorization: `Bearer ${CRON_VALUE}` }, { write: true }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(ran).not.toHaveBeenCalled();
  });

  it("the 401 reveals nothing about WHY: the same body whether the secret is wrong, missing, or unconfigured", async () => {
    const wrong = await (await call(post({ "x-admin-secret": "nope" }))).text();
    const none = await (await call(post())).text();
    delete process.env.INGEST_SECRET;
    delete process.env.CRON_SECRET;
    const unconfigured = await (await call(post({ "x-admin-secret": ADMIN_HEADER_VALUE }))).text();
    expect(new Set([wrong, none, unconfigured]).size).toBe(1);
  });
});

describe("rescore-stale-match-scores route: no personal data in the response or the log", () => {
  const UID = "11111111-2222-4333-8444-555555555555";
  beforeEach(() => {
    ran.mockClear();
    process.env.INGEST_SECRET = ADMIN_HEADER_VALUE;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    state.summary = null;
  });

  it("users skipped for having no resume come back as { rows } only, errors have the id redacted, and no user id appears anywhere in the body", async () => {
    state.summary = {
      ...BASE_SUMMARY,
      skippedNoBaseResume: [{ userId: UID, rows: 7 }, { userId: UID.replace("1111", "9999"), rows: 12 }],
      errors: [{ userId: UID, message: `could not persist for ${UID}` }],
      ok: false,
    };
    const res = await call(post({ "x-admin-secret": ADMIN_HEADER_VALUE }));
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(text).toContain('"skippedNoBaseResume":[{"rows":12},{"rows":7}]');
  });

  it("the cursor is the one internal id the response must carry (to resume), but the LOG line only says whether one is set", async () => {
    state.summary = { ...BASE_SUMMARY, dryRun: false, complete: false, stoppedBy: "maxRows", nextCursor: UID };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await call(post({ "x-admin-secret": ADMIN_HEADER_VALUE }, { write: true }));
    expect((await res.json()).summary.nextCursor).toBe(UID);
    const logged = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toContain(UID);
    expect(logged).toMatch(/cursor=set/);
  });
});

describe("rescore-stale-match-scores route: verify mode (counts only)", () => {
  beforeEach(() => {
    verifyRan.mockClear();
    ran.mockClear();
    process.env.INGEST_SECRET = ADMIN_HEADER_VALUE;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());
  const authed = { "x-admin-secret": ADMIN_HEADER_VALUE };

  it("{ verify: 20 } recomputes a sample and answers with counts only, without running the rescore", async () => {
    const res = await call(post(authed, { verify: 20 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ verify: { checked: 20, matching: 20, mismatching: 0, unverifiable: 0 } });
    expect(verifyRan).toHaveBeenCalledWith(20);
    expect(ran).not.toHaveBeenCalled();
  });

  it("rejects a bad sample size or verify combined with write, and runs nothing", async () => {
    for (const body of [{ verify: 0 }, { verify: 101 }, { verify: "20" }, { verify: 1.5 }, { verify: 20, write: true }]) {
      const res = await call(post(authed, body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(verifyRan).not.toHaveBeenCalled();
  });

  it("verify needs the same secret: no credential is a 401", async () => {
    expect((await call(post({}, { verify: 20 }))).status).toBe(401);
    expect(verifyRan).not.toHaveBeenCalled();
  });
});
