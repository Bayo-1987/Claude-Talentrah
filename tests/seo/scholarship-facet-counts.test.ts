/**
 * send-480 — liveScholarshipLandingLinks now also returns each category's live
 * count, because the signed-out /scholarships "Browse by" card shows it. It must
 * stay ONE query (the scholarship_landing_facet_counts RPC, send-441) and keep the
 * same >= LANDING_PAGE_MIN_ENTRIES rule that decides whether the landing page
 * behind each link exists at all — a category listed here that 404s underneath it
 * is exactly the failure that rule prevents.
 *
 * A stub client, no database: this pins the mapping and the boundary, which is the
 * logic added here. tests/seo/landing-page-facet-rpc.test.ts keeps the RPC itself
 * honest against the live schema.
 */
import { describe, expect, it } from "vitest";
import { liveScholarshipLandingLinks } from "@/lib/seo/landing-page-links";
import { LANDING_PAGE_MIN_ENTRIES } from "@/lib/seo/landing-pages";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

function stubClient(counts: Partial<Record<string, number>>) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const data = {
    fully_funded_count: 0,
    bsc_count: 0,
    msc_count: 0,
    phd_count: 0,
    postgraduate_diploma_count: 0,
    other_count: 0,
    ...counts,
  };
  const client = {
    rpc: (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return { single: async () => ({ data, error: null }) };
    },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

describe("liveScholarshipLandingLinks — counts", () => {
  it("returns each qualifying category with its live count, fully funded first, then levels in enum order", async () => {
    const { client } = stubClient({
      fully_funded_count: 28,
      bsc_count: 18,
      msc_count: 27,
      phd_count: 14,
      postgraduate_diploma_count: 2,
      other_count: 2,
    });
    const links = await liveScholarshipLandingLinks(client);
    expect(links).toEqual([
      { href: "/scholarships/fully-funded", label: "Fully funded scholarships", count: 28 },
      { href: "/scholarships/degree/bsc", label: "BSc scholarships", count: 18 },
      { href: "/scholarships/degree/msc", label: "MSc scholarships", count: 27 },
      { href: "/scholarships/degree/phd", label: "PhD scholarships", count: 14 },
    ]);
  });

  it("keeps the rule at its exact boundary: MIN_ENTRIES is in, MIN_ENTRIES - 1 is out", async () => {
    const { client } = stubClient({
      fully_funded_count: LANDING_PAGE_MIN_ENTRIES,
      msc_count: LANDING_PAGE_MIN_ENTRIES - 1,
    });
    const links = await liveScholarshipLandingLinks(client);
    expect(links.map((l) => l.href)).toEqual(["/scholarships/fully-funded"]);
  });

  it("is still ONE round trip, through the facet-counts RPC", async () => {
    const { client, calls } = stubClient({ fully_funded_count: 10 });
    await liveScholarshipLandingLinks(client);
    // send-508: the instant-based function (0204); the date-argument one it replaced is no longer called.
    expect(calls.map((c) => c.fn)).toEqual(["scholarship_landing_facet_counts_at"]);
  });

  it("still honours excludeHref (other callers rely on it)", async () => {
    const { client } = stubClient({ fully_funded_count: 10, msc_count: 10 });
    const links = await liveScholarshipLandingLinks(client, "/scholarships/fully-funded");
    expect(links.map((l) => l.href)).toEqual(["/scholarships/degree/msc"]);
  });
});
