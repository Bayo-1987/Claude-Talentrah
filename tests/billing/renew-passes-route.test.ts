/**
 * The pass-renewal cron answers HTTP 500 whenever the job's `ok` is false, so the scheduler's failure alerting fires. No database: the job is faked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const runPassRenewalJob = vi.hoisted(() => vi.fn());
vi.mock("@/lib/billing/renewals", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/billing/renewals")>()), runPassRenewalJob }));
vi.mock("@/lib/api/admin-auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/admin-auth")>()), requireCronSecret: () => null }));

beforeEach(() => runPassRenewalJob.mockReset());

const summary = (over: Record<string, unknown>) => ({ ok: true, remindersSent: 0, renewed: 0, lapsed: 0, indeterminate: 0, errors: [], queryErrors: [], ...over });

describe("GET /api/admin/renew-passes", () => {
  it("answers 500 when the job is not ok (a charged-but-not-extended Pass, an unsaved reference, a lapse that did not take)", async () => {
    runPassRenewalJob.mockResolvedValueOnce(summary({ ok: false, errors: [{ userPassId: "up1", message: "NEEDS RECONCILIATION: charged but not extended." }] }));
    const { GET } = await import("@/app/api/admin/renew-passes/route");
    expect((await GET(new Request("http://localhost/api/admin/renew-passes"))).status).toBe(500);
  });

  it("answers 200 when the job is ok", async () => {
    runPassRenewalJob.mockResolvedValueOnce(summary({}));
    const { GET } = await import("@/app/api/admin/renew-passes/route");
    expect((await GET(new Request("http://localhost/api/admin/renew-passes"))).status).toBe(200);
  });
});
