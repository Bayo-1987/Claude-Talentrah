/**
 * The campaign state actions (submit for review, pause, resume, and the ownership lookup before each) must not show raw database or driver text. The business answers that come back from the
 * RPCs (wallet too low, finished, not running, not a draft) are kept word for word, because the employer needs them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: { data: null as unknown, error: null as null | { message: string } },
  owner: { data: { id: "c1" } as unknown, error: null as null | { message: string } },
  revalidate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/employer/membership", () => ({
  requireEmployer: async () => ({ role: "owner", userId: "u1", organization: { id: "o1" } }),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ rpc: async () => ({ data: h.rpc.data, error: h.rpc.error }) }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const chain: Record<string, unknown> = new Proxy({}, { get: (_t, prop) => (prop === "maybeSingle" ? async () => ({ data: h.owner.data, error: h.owner.error }) : () => chain) });
    return { from: () => chain };
  },
}));

import { submitCampaignForReviewAction, pauseCampaignAction, resumeCampaignAction } from "@/lib/employer/campaign-actions";

const RAW = 'permission denied for table ad_campaigns (constraint "ad_campaigns_pkey")';
const errOf = (r: unknown) => (r as { error: string }).error;

beforeEach(() => {
  h.rpc = { data: null, error: null };
  h.owner = { data: { id: "c1" }, error: null };
  h.revalidate.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("raw database text is logged, not shown", () => {
  it.each([
    ["submit for review", () => submitCampaignForReviewAction("c1"), "Couldn't submit for review; nothing was changed. The error is in the server log."],
    ["pause", () => pauseCampaignAction("c1"), "Couldn't pause the campaign; nothing was changed. The error is in the server log."],
    ["resume", () => resumeCampaignAction("c1"), "Couldn't resume the campaign; nothing was changed. The error is in the server log."],
  ])("%s: an RPC error shows a plain sentence and logs the raw text", async (_n, run, sentence) => {
    h.rpc.error = { message: RAW };
    const result = await run();
    expect(errOf(result)).toBe(sentence);
    expect(errOf(result)).not.toContain("ad_campaigns");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(RAW));
    expect(h.revalidate).not.toHaveBeenCalled();
  });

  it("the ownership lookup failing shows a plain sentence and logs the raw text", async () => {
    h.owner.error = { message: RAW };
    const result = await pauseCampaignAction("c1");
    expect(errOf(result)).toBe("Couldn't load that campaign; nothing was changed. The error is in the server log.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(RAW));
  });
});

describe("the business answers are kept word for word", () => {
  it("a campaign that is not the organisation's, not a draft, not running, not paused, finished", async () => {
    h.owner.data = null;
    expect(errOf(await pauseCampaignAction("c1"))).toBe("That campaign isn't available.");
    h.owner.data = { id: "c1" };
    h.rpc.data = false;
    expect(errOf(await submitCampaignForReviewAction("c1"))).toBe("Only a draft campaign can be submitted for review.");
    expect(errOf(await pauseCampaignAction("c1"))).toBe("That campaign isn't running.");
    h.rpc.data = [{ ok: false, status: "unknown" }];
    expect(errOf(await resumeCampaignAction("c1"))).toBe("That campaign isn't paused.");
    h.rpc.data = [{ ok: false, status: "completed" }];
    expect(errOf(await resumeCampaignAction("c1"))).toBe("This campaign has finished — its budget or end date is used up.");
  });

  it("the wallet-too-low answer still carries the balance", async () => {
    h.rpc.data = [{ ok: false, status: "paused_insufficient_funds", balance_after_ngn: 1500 }];
    expect(errOf(await resumeCampaignAction("c1"))).toBe("Your ad wallet doesn't have enough to cover a day of this campaign (balance ₦1,500). Top up and try again.");
  });

  it("a successful pause is still ok and revalidates", async () => {
    h.rpc.data = true;
    expect(await pauseCampaignAction("c1")).toEqual({ ok: true });
    expect(h.revalidate).toHaveBeenCalled();
  });
});
