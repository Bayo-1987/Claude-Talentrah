/**
 * The daily lapse of ended, non-renewing Talent Directory subscriptions runs inside the EXISTING daily route (/api/admin/renew-talent-directory-subscriptions,
 * vercel.json "0 13 * * *"), after the renewal job, so no new cron is added. This pins the wiring: the route runs the renewals first, then the lapse, reports
 * how many it lapsed, and turns a lapse failure into a 500 without hiding the renewal summary.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const order: string[] = [];
const renew = vi.hoisted(() => vi.fn());
const lapse = vi.hoisted(() => vi.fn());
vi.mock("@/lib/talent-directory/renewals", () => ({
  runTalentDirectorySubscriptionRenewalJob: renew,
  lapseEndedTalentDirectorySubscriptions: lapse,
}));
vi.mock("@/lib/api/admin-auth", () => ({
  requireCronSecret: () => null,
  requireAdminSecret: () => null,
  internalError: (_name: string, err: unknown) => new Response(String(err), { status: 500 }),
}));
vi.spyOn(console, "log").mockImplementation(() => {});

import { GET, POST } from "@/app/api/admin/renew-talent-directory-subscriptions/route";

const summary = () => ({ ok: true, renewed: 2, lapsed: 0, indeterminate: 0, errors: [], queryErrors: [] as { message: string }[] });

beforeEach(() => {
  order.length = 0;
  renew.mockReset();
  lapse.mockReset();
  renew.mockImplementation(async () => {
    order.push("renew");
    return summary();
  });
  lapse.mockImplementation(async () => {
    order.push("lapse");
    return { lapsed: 3, error: null };
  });
});

describe("renew-talent-directory-subscriptions route", () => {
  it("runs the renewal job first and the daily lapse after it, and reports how many rows it lapsed", async () => {
    const res = await GET(new Request("http://localhost/api/admin/renew-talent-directory-subscriptions"));
    expect(res.status).toBe(200);
    expect(order).toEqual(["renew", "lapse"]);
    expect((await res.json()).lapsedEnded).toBe(3);
  });

  it("the manual POST entry point runs the same two steps", async () => {
    const res = await POST(new Request("http://localhost/api/admin/renew-talent-directory-subscriptions", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(order).toEqual(["renew", "lapse"]);
  });

  it("a lapse failure makes the response a 500 and records the message, while the renewal summary is still returned", async () => {
    lapse.mockResolvedValue({ lapsed: 0, error: "boom" });
    const res = await GET(new Request("http://localhost/api/admin/renew-talent-directory-subscriptions"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.summary.renewed).toBe(2);
    expect(body.summary.queryErrors).toEqual([{ message: "lapse: boom" }]);
  });

  it("a renewal job that throws is an internal error, and the lapse does not run", async () => {
    renew.mockRejectedValue(new Error("renewal exploded"));
    const res = await GET(new Request("http://localhost/api/admin/renew-talent-directory-subscriptions"));
    expect(res.status).toBe(500);
    expect(lapse).not.toHaveBeenCalled();
  });
});
