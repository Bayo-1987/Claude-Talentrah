/**
 * send-484 — liveJobLandingLinks now also returns each category's live count, because the signed-out
 * /jobs "Browse by" card shows it (send-480 did the same for liveScholarshipLandingLinks). Additive:
 * every existing caller reads `href` and `label` only. It must stay ONE query (the
 * job_landing_facet_counts RPC, send-441) and keep the >= LANDING_PAGE_MIN_ENTRIES rule that decides
 * whether the page behind a link exists — a link that 404s underneath it is what that rule prevents.
 *
 * A stub client, no database: this pins the mapping and the boundary, which is the logic added here.
 * tests/seo/landing-page-facet-rpc.test.ts keeps the RPC itself honest against the live schema.
 */
import { describe, expect, it } from "vitest";
import { liveJobLandingLinks } from "@/lib/seo/landing-page-links";
import { LANDING_PAGE_MIN_ENTRIES } from "@/lib/seo/landing-pages";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

function stubClient(counts: Partial<Record<string, number>>) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const data = {
    remote_count: 0,
    nigeria_count: 0,
    ghana_count: 0,
    kenya_count: 0,
    south_africa_count: 0,
    lagos_count: 0,
    abuja_count: 0,
    nairobi_count: 0,
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

describe("liveJobLandingLinks — counts", () => {
  it("returns each qualifying category with its live count: remote, then countries, then cities", async () => {
    const { client } = stubClient({ remote_count: 41, nigeria_count: 23, kenya_count: 9, lagos_count: 17, nairobi_count: 6 });
    const links = await liveJobLandingLinks(client);
    expect(links).toEqual([
      { href: "/jobs/remote", label: "Remote jobs", count: 41 },
      { href: "/jobs/remote/nigeria", label: "Remote jobs in Nigeria", count: 23 },
      { href: "/jobs/remote/kenya", label: "Remote jobs in Kenya", count: 9 },
      { href: "/jobs/in/lagos", label: "Jobs in Lagos", count: 17 },
      { href: "/jobs/in/nairobi", label: "Jobs in Nairobi", count: 6 },
    ]);
  });

  it("keeps the rule at its exact boundary: MIN_ENTRIES is in, MIN_ENTRIES - 1 is out", async () => {
    const { client } = stubClient({ remote_count: LANDING_PAGE_MIN_ENTRIES, lagos_count: LANDING_PAGE_MIN_ENTRIES - 1 });
    const links = await liveJobLandingLinks(client);
    expect(links.map((l) => l.href)).toEqual(["/jobs/remote"]);
  });

  it("is still ONE round trip, through the facet-counts RPC", async () => {
    const { client, calls } = stubClient({ remote_count: 10 });
    await liveJobLandingLinks(client);
    expect(calls.map((c) => c.fn)).toEqual(["job_landing_facet_counts"]);
  });

  it("still honours excludeHref (other callers rely on it)", async () => {
    const { client } = stubClient({ remote_count: 10, lagos_count: 10 });
    const links = await liveJobLandingLinks(client, "/jobs/remote");
    expect(links.map((l) => l.href)).toEqual(["/jobs/in/lagos"]);
  });
});
