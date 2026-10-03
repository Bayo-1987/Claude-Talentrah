/**
 * The ingest route runs the match-score refresh LAST (after both expiry sweeps and the proactive alerts, so closed postings are not scored and
 * the refresh cannot starve the alerts of time), with its own try/catch: a refresh failure must never cancel, fail or change what ingestion
 * reports. Behaviour through the real route with its collaborators mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const order: string[] = [];
const refreshSpy = vi.fn();
vi.mock("@/lib/jobs/ingest", () => ({
  ingestAllSources: async () => {
    order.push("ingest");
    return [{ source: "stub", identifier: "x", upserted: 3 }];
  },
}));
vi.mock("@/lib/jobs/expiry", () => ({
  EXTERNAL_STALE_AFTER_HOURS: 48,
  closeExpiredInternalPostings: async () => {
    order.push("expiry");
    return { closed: 0, ids: [] };
  },
  closeStaleExternalPostings: async () => {
    order.push("staleSweep");
    return { closed: 0, ids: [] };
  },
}));
vi.mock("@/lib/notifications/proactive-match-alert/send", () => ({
  sendProactiveMatchAlerts: async () => {
    order.push("alerts");
    return { sent: 0 };
  },
}));
vi.mock("@/lib/matching/refresh-job", () => ({
  runMatchScoreRefreshJob: async (opts?: unknown) => {
    order.push("refresh");
    return refreshSpy(opts);
  },
}));

const ADMIN_HEADER_VALUE = "test-admin-header-123";
const post = () => new Request("http://localhost/api/admin/ingest-jobs", { method: "POST", headers: { "x-admin-secret": ADMIN_HEADER_VALUE } });
const summary = (over: Record<string, unknown> = {}) => ({
  ok: true,
  eligiblePostings: 372,
  usersConsidered: 7,
  usersUpToDate: 1,
  usersRefreshed: 6,
  postingsScored: 1149,
  distinctPostingsScored: 205,
  failed: 0,
  errors: [],
  complete: true,
  stoppedBy: null,
  ...over,
});

describe("ingest-jobs: the post-ingest match-score refresh", () => {
  const saved = process.env.INGEST_SECRET;
  beforeEach(() => {
    order.length = 0;
    refreshSpy.mockReset();
    refreshSpy.mockResolvedValue(summary());
    process.env.INGEST_SECRET = ADMIN_HEADER_VALUE;
    delete process.env.ADMIN_API_SECRET;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (saved === undefined) delete process.env.INGEST_SECRET;
    else process.env.INGEST_SECRET = saved;
  });

  it("runs the refresh AFTER ingest, both sweeps and the proactive alerts, and reports it in the response", async () => {
    const { POST } = await import("@/app/api/admin/ingest-jobs/route");
    const res = await POST(post());
    expect(res.status).toBe(200);
    expect(order).toEqual(["expiry", "ingest", "staleSweep", "alerts", "refresh"]);
    const body = await res.json();
    expect(body.postIngestRefresh).toMatchObject({ ran: true, complete: true, rowsWritten: 1149, postingsRefreshed: 205 });
    expect(JSON.stringify(body.postIngestRefresh), "no user ids in the response").not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("a refresh that THROWS never fails or changes ingestion: still 200, ingest results intact, the failure reported", async () => {
    refreshSpy.mockRejectedValue(new Error("db down"));
    const { POST } = await import("@/app/api/admin/ingest-jobs/route");
    const res = await POST(post());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([{ source: "stub", identifier: "x", upserted: 3 }]);
    expect(body.postIngestRefresh.error).toMatch(/db down/);
    expect(body.postIngestRefresh.complete).toBe(false);
  });

  it("an unfinished refresh (deadline) is reported complete:false, and the response is still 200", async () => {
    refreshSpy.mockResolvedValue(summary({ complete: false, stoppedBy: "deadline", postingsScored: 400 }));
    const { POST } = await import("@/app/api/admin/ingest-jobs/route");
    const res = await POST(post());
    expect(res.status).toBe(200);
    expect((await res.json()).postIngestRefresh).toMatchObject({ ran: true, complete: false, rowsWritten: 400 });
  });

  it("hands the refresh a deadline (shouldStop), so it cannot run past the route's budget", async () => {
    const { POST } = await import("@/app/api/admin/ingest-jobs/route");
    await POST(post());
    const opts = refreshSpy.mock.calls[0][0] as { shouldStop?: () => boolean };
    expect(typeof opts.shouldStop).toBe("function");
    expect(opts.shouldStop!()).toBe(false);
  });

  it("when ingest itself used most of the budget the refresh is SKIPPED (not called), with the reason in the response", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-04T05:00:00Z"));
      vi.doMock("@/lib/jobs/ingest", () => ({
        ingestAllSources: async () => {
          order.push("ingest");
          vi.setSystemTime(new Date("2026-10-04T05:00:00Z").getTime() + 235_000); // a very slow ingest
          return [{ source: "stub", identifier: "x", upserted: 3 }];
        },
      }));
      vi.resetModules();
      const { POST } = await import("@/app/api/admin/ingest-jobs/route");
      const res = await POST(post());
      expect(res.status).toBe(200);
      expect(refreshSpy).not.toHaveBeenCalled();
      const body = await res.json();
      expect(body.postIngestRefresh).toMatchObject({ ran: false, rowsWritten: 0 });
      expect(body.postIngestRefresh.skippedReason).toMatch(/ingest used/i);
    } finally {
      vi.useRealTimers();
      vi.doUnmock("@/lib/jobs/ingest");
    }
  });
});
