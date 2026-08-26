/**
 * The one property the live-database suite cannot force: what the batch does
 * when a single charge THROWS.
 *
 * tests/billing/ad-campaigns.test.ts proves the loop continues past a campaign
 * that *pauses*, which is the common case and not an exception at all —
 * `charge_ad_campaign_day` returns `ok = false` normally. But it also raises,
 * in one real situation: `raise exception 'charge_ad_campaign_day: no
 * campaign %'` when the row is gone. `ad_campaigns` cascades from both
 * `organizations` and `job_postings`, so a campaign can be deleted between the
 * job reading its work-list and calling the RPC. Losing that race from a test
 * is not something you can arrange on demand, so the client is stubbed here
 * instead.
 *
 * WHY CONTINUING IS THE ONLY CORRECT ANSWER, and why it is worth a test rather
 * than a comment: each `.rpc()` is its own PostgREST request and its own
 * transaction. Campaigns charged before the throw are already committed and
 * cannot be rolled back. Aborting would therefore leave the tail of the batch
 * `active` and unbilled — which is a narrower re-creation of the exact defect
 * this job was written to fix (0047's charge function had no caller at all,
 * and campaigns advertised free after their first day).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const work = { rows: [] as Array<{ id: string; daily_rate_ngn: number }>, error: null as unknown };

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => {
    // Minimal PostgREST-shaped stub: every builder method returns `this`, and
    // the terminal `.limit()` resolves. Only one page is ever served, so the
    // keyset loop terminates on the short page.
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or", "gt", "order"]) {
      builder[m] = () => builder;
    }
    builder.limit = () =>
      Promise.resolve(work.error ? { data: null, error: work.error } : { data: work.rows, error: null });
    return { from: () => builder, rpc };
  },
}));

const { runCampaignChargeJob } = await import("@/lib/billing/campaign-charges");

const ok = (balance: number) => ({
  data: [{ ok: true, status: "active", balance_after_ngn: balance }],
  error: null,
});

beforeEach(() => {
  rpc.mockReset();
  work.rows = [];
  work.error = null;
});

describe("a throw on one campaign does not abandon the rest of the batch", () => {
  it("MONEY: charges the campaigns after the one that raised", async () => {
    work.rows = [
      { id: "a", daily_rate_ngn: 1000 },
      { id: "b", daily_rate_ngn: 1000 },
      { id: "c", daily_rate_ngn: 1000 },
    ];
    rpc
      .mockResolvedValueOnce(ok(9000))
      // The real shape of the race: the campaign was deleted under us.
      .mockRejectedValueOnce(new Error("charge_ad_campaign_day: no campaign b"))
      .mockResolvedValueOnce(ok(8000));

    const summary = await runCampaignChargeJob({ on: "2026-08-26" });

    expect(rpc, "the batch stopped at the throw — the tail runs free").toHaveBeenCalledTimes(3);
    expect(summary.charged).toBe(2);
    expect(summary.chargedNgn).toBe(2000);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]!.campaignId).toBe("b");
  });

  it("reports the run as failed so a scheduler alerts, despite continuing", async () => {
    work.rows = [{ id: "a", daily_rate_ngn: 1000 }];
    rpc.mockRejectedValueOnce(new Error("boom"));

    const summary = await runCampaignChargeJob({ on: "2026-08-26" });

    // Continuing is not the same as pretending it was clean. The route turns
    // ok=false into a 500 — the runPassRenewalJob convention.
    expect(summary.ok).toBe(false);
    expect(summary.charged).toBe(0);
  });

  it("a PostgREST error object is treated as a failure, not as a result", async () => {
    // supabase-js resolves with { data: null, error } rather than rejecting.
    // A job that only catches rejections would count this as a silent success.
    work.rows = [{ id: "a", daily_rate_ngn: 1000 }];
    rpc.mockResolvedValueOnce({ data: null, error: { message: "deadlock detected" } });

    const summary = await runCampaignChargeJob({ on: "2026-08-26" });

    expect(summary.ok).toBe(false);
    expect(summary.errors[0]!.message).toContain("deadlock");
    expect(summary.charged).toBe(0);
  });

  it("a failed work-list query fails the run rather than reporting an empty one", async () => {
    // Zero campaigns considered and zero charged is what a healthy quiet day
    // also looks like. Without this the two are indistinguishable, and a broken
    // query reads as "nothing to bill today" forever.
    work.error = { message: "connection reset" };

    const summary = await runCampaignChargeJob({ on: "2026-08-26" });

    expect(summary.ok).toBe(false);
    expect(summary.queryErrors).toHaveLength(1);
    expect(rpc).not.toHaveBeenCalled();
  });
});
