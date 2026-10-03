/**
 * getApprovedMentorPriceRangeNgn — send-472.
 *
 * ── WHY A MOCKED UNIT TEST, WHEN THE REAL PROOF WAS A LOCAL BUILD ──────────
 *
 * The actual regression test for this bug class is `npm run build` pointed
 * at an unreachable Supabase URL — proven manually before this PR (reverted
 * to the pre-fix `throw`, reproduced the identical crash locally byte-for-
 * byte against production's own build log, then confirmed the fix survives
 * it). CI's own ephemeral per-job database is always healthy, so it can
 * never naturally reproduce an egress-quota-style failure the way a stray
 * local build against a real, currently-unreachable project can. This test
 * is what keeps that property enforced automatically going forward: a
 * future edit that reintroduces `if (error) throw` here fails this test in
 * CI immediately, rather than waiting for the next real Supabase hiccup to
 * silently take production's entire deploy pipeline down again.
 *
 * `getApprovedMentorPriceRangeNgn` runs at BUILD TIME from the homepage's
 * static prerender of `/` (mentorship-section.tsx) — CLAUDE.md's own
 * send-441/443 write-up already names this exposure. This is that same
 * class of bug, through a different trigger (a transient Supabase error,
 * not an empty key).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryResult = vi.hoisted(() => ({
  data: null as { base_price_ngn: number | null }[] | null,
  error: null as { message: string } | null,
  throwOnCall: false,
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from() {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "not", "gt"]) {
        chain[m] = () => chain;
      }
      (chain as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        if (queryResult.throwOnCall) {
          return Promise.reject(new TypeError("fetch failed")).then(resolve, reject);
        }
        return Promise.resolve({ data: queryResult.data, error: queryResult.error }).then(resolve, reject);
      };
      return chain;
    },
  }),
}));

beforeEach(() => {
  queryResult.data = null;
  queryResult.error = null;
  queryResult.throwOnCall = false;
});

afterEach(() => {
  vi.resetModules();
});

describe("getApprovedMentorPriceRangeNgn — fails soft, never throws", () => {
  it("returns null (not a throw) when the Supabase client returns an error", async () => {
    queryResult.error = { message: "exceed_egress_quota" };
    const { getApprovedMentorPriceRangeNgn } = await import("@/lib/mentorship/public-price-range");
    await expect(getApprovedMentorPriceRangeNgn()).resolves.toBeNull();
  });

  it("returns null (not a throw) when the underlying fetch itself rejects — the exact shape a network/DNS failure takes", async () => {
    queryResult.throwOnCall = true;
    const { getApprovedMentorPriceRangeNgn } = await import("@/lib/mentorship/public-price-range");
    await expect(getApprovedMentorPriceRangeNgn()).resolves.toBeNull();
  });

  it("still returns null for the pre-existing zero-qualifying-mentors case — the fix didn't change this contract", async () => {
    queryResult.data = [];
    const { getApprovedMentorPriceRangeNgn } = await import("@/lib/mentorship/public-price-range");
    await expect(getApprovedMentorPriceRangeNgn()).resolves.toBeNull();
  });

  it("still returns the real min/max on a successful query — the fix didn't change the happy path", async () => {
    queryResult.data = [{ base_price_ngn: 20000 }, { base_price_ngn: 15000 }, { base_price_ngn: 18000 }];
    const { getApprovedMentorPriceRangeNgn } = await import("@/lib/mentorship/public-price-range");
    await expect(getApprovedMentorPriceRangeNgn()).resolves.toEqual({ minNgn: 15000, maxNgn: 20000 });
  });
});

describe("getApprovedMentorsOfferFreeSessions — true only when an approved, bookable mentor really offers free or volunteer sessions", () => {
  const load = async () => (await import("@/lib/mentorship/public-price-range")).getApprovedMentorsOfferFreeSessions();

  it("a null base price (the 'Free / volunteer' card) counts", async () => {
    queryResult.data = [{ base_price_ngn: 20000 }, { base_price_ngn: null }];
    await expect(load()).resolves.toBe(true);
  });

  it("a zero base price counts", async () => {
    queryResult.data = [{ base_price_ngn: 0 }];
    await expect(load()).resolves.toBe(true);
  });

  it("only priced mentors: false, so the page states the policy and does not claim it is happening", async () => {
    queryResult.data = [{ base_price_ngn: 20000 }];
    await expect(load()).resolves.toBe(false);
  });

  it("no mentors at all: false", async () => {
    queryResult.data = [];
    await expect(load()).resolves.toBe(false);
  });

  it("a Supabase error or a rejected fetch fails soft to false (the claim-nothing answer), never a throw", async () => {
    queryResult.error = { message: "exceed_egress_quota" };
    await expect(load()).resolves.toBe(false);
    vi.resetModules();
    queryResult.error = null;
    queryResult.throwOnCall = true;
    await expect(load()).resolves.toBe(false);
  });
});
