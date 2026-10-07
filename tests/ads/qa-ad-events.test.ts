/**
 * QA-EXCL, surface 7: `ad_events` feeds the campaign analytics an employer sees, so a QA account's impressions, clicks and applies must not be written.
 * The two writers (recordPromotedImpressions, recordAdEvent) skip when the user is a QA account; a normal account is recorded exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  profiles: {} as Record<string, { email: string | null; first_name: string | null; last_name: string | null }>,
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from() {
      const ops: Array<[string, unknown[]]> = [];
      const chain: Record<string, unknown> = new Proxy({}, {
        get: (_t, prop) => {
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown) => {
              const id = (ops.find(([op]) => op === "eq")?.[1] as unknown[] | undefined)?.[1] as string | undefined;
              resolve({ data: id ? (state.profiles[id] ?? null) : null, error: null });
            };
          }
          return (...args: unknown[]) => { ops.push([String(prop), args]); return chain; };
        },
      });
      return chain;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => { state.rpc.push({ fn, args }); return { data: null, error: null }; },
  }),
}));

const promoted = [{ campaignId: "c1", jobPostingId: "j1" }, { campaignId: "c2", jobPostingId: "j2" }] as never;

beforeEach(() => {
  vi.resetModules();
  state.rpc.length = 0;
  state.profiles = {
    "qa-user": { email: "hello+qa-seeker@talentrah.com", first_name: "QA", last_name: "Seeker" },
    "real-user": { email: "ada@example.com", first_name: "Ada", last_name: "Lovelace" },
  };
});

describe("ad_events writers and QA accounts", () => {
  it("recordPromotedImpressions writes nothing for a QA account", async () => {
    const { recordPromotedImpressions } = await import("@/lib/ads/promoted");
    await recordPromotedImpressions("qa-user", promoted);
    expect(state.rpc).toEqual([]);
  });
  it("recordPromotedImpressions still writes one impression per promoted job for a normal account", async () => {
    const { recordPromotedImpressions } = await import("@/lib/ads/promoted");
    await recordPromotedImpressions("real-user", promoted);
    expect(state.rpc.map((c) => [c.fn, c.args.p_event_type, c.args.p_campaign_id])).toEqual([
      ["record_ad_event", "impression", "c1"],
      ["record_ad_event", "impression", "c2"],
    ]);
  });
  it("recordAdEvent writes nothing for a QA account (click and apply)", async () => {
    const { recordAdEvent } = await import("@/lib/ads/promoted");
    await recordAdEvent({ campaignId: "c1", jobPostingId: "j1", userId: "qa-user", eventType: "click", surface: "job_feed_click" });
    await recordAdEvent({ campaignId: "c1", jobPostingId: "j1", userId: "qa-user", eventType: "apply", surface: "job_feed_apply" });
    expect(state.rpc).toEqual([]);
  });
  it("recordAdEvent still writes a normal account's click and apply", async () => {
    const { recordAdEvent } = await import("@/lib/ads/promoted");
    await recordAdEvent({ campaignId: "c1", jobPostingId: "j1", userId: "real-user", eventType: "click", surface: "job_feed_click" });
    await recordAdEvent({ campaignId: "c1", jobPostingId: "j1", userId: "real-user", eventType: "apply", surface: "job_feed_apply" });
    expect(state.rpc.map((c) => c.args.p_event_type)).toEqual(["click", "apply"]);
  });
});
