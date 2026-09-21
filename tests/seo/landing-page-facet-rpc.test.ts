/**
 * send-441: `job_landing_facet_counts`/`scholarship_landing_facet_counts`
 * (0185) replace landing-page-links.ts's own 8-query and 6-query fan-outs
 * with one round trip each. The risk that consolidation introduces is
 * silent drift — the SQL and the TypeScript constants it mirrors
 * (TRACKED_COUNTRIES/SOURCE_COUNTRY_FALLBACK/CITY_LANDING_PAGES) are two
 * independent copies of the same facet definitions, and nothing stops them
 * disagreeing the next time either side changes.
 *
 * This is the drift detector. It does NOT import landing-page-links.ts at
 * all — the fan-out queries it used to run no longer exist there — and
 * instead re-runs the SAME per-facet count queries independently, inline,
 * against live data, and asserts the RPC's numbers match exactly. A future
 * edit to either the migration or country.ts/landing-pages.ts that forgets
 * the other fails this test, not silently.
 *
 * Run against the real database with the real anon client, same convention
 * as landing-page-data.test.ts and landing-page-links.test.ts — this proves
 * the RPC's grants (anon, authenticated) are actually sufficient, not just
 * that the SQL is well-formed for a superuser connection.
 */
import { describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { freshnessFloorISO } from "@/lib/jobs/freshness";
import { TRACKED_COUNTRIES, countryOrFilter } from "@/lib/jobs/country";
import { CITY_LANDING_PAGES } from "@/lib/seo/landing-pages";
import { Constants } from "@/lib/supabase/types";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const) {
  if (!process.env[key]) throw new Error(`landing-page-facet-rpc test cannot run: ${key} is not set.`);
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
type DB = SupabaseClient<Database>;
const anon: DB = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

describe("job_landing_facet_counts — matches the per-facet queries it replaced", () => {
  it("every facet count agrees with an independent direct query, on live data", async () => {
    const floor = freshnessFloorISO();

    const { data: rpc, error } = await anon.rpc("job_landing_facet_counts", { p_floor: floor }).single();
    expect(error).toBeNull();
    if (!rpc) throw new Error("RPC returned no row");

    const { count: remoteExpected } = await anon
      .from("job_postings")
      .select("id", { count: "exact", head: true })
      .is("unlisted_at", null)
      .eq("status", "open")
      .eq("work_type", "remote")
      .gte("posted_at", floor);
    expect(rpc.remote_count).toBe(remoteExpected ?? 0);

    for (const country of TRACKED_COUNTRIES) {
      const { count: expected } = await anon
        .from("job_postings")
        .select("id", { count: "exact", head: true })
        .is("unlisted_at", null)
        .eq("status", "open")
        .eq("work_type", "remote")
        .or(countryOrFilter(country))
        .gte("posted_at", floor);
      const actual = {
        Nigeria: rpc.nigeria_count,
        Ghana: rpc.ghana_count,
        Kenya: rpc.kenya_count,
        "South Africa": rpc.south_africa_count,
      }[country];
      expect(actual, `${country} facet count`).toBe(expected ?? 0);
    }

    for (const city of CITY_LANDING_PAGES) {
      const { count: expected } = await anon
        .from("job_postings")
        .select("id", { count: "exact", head: true })
        .is("unlisted_at", null)
        .eq("status", "open")
        .or(city.locationPatterns.map((p) => `location.ilike.${p}`).join(","))
        .gte("posted_at", floor);
      const actual = { lagos: rpc.lagos_count, abuja: rpc.abuja_count, nairobi: rpc.nairobi_count }[city.slug];
      expect(actual, `${city.slug} facet count`).toBe(expected ?? 0);
    }
  });
});

describe("scholarship_landing_facet_counts — matches the per-facet queries it replaced", () => {
  it("every facet count agrees with an independent direct query, on live data", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const stillOpen = `application_deadline.is.null,application_deadline.gte.${today}`;

    const { data: rpc, error } = await anon
      .rpc("scholarship_landing_facet_counts", { p_today: today })
      .single();
    expect(error).toBeNull();
    if (!rpc) throw new Error("RPC returned no row");

    const { count: fullyFundedExpected } = await anon
      .from("scholarships")
      .select("id", { count: "exact", head: true })
      .eq("moderation_status", "verified")
      .eq("funding_type", "full")
      .or(stillOpen);
    expect(rpc.fully_funded_count).toBe(fullyFundedExpected ?? 0);

    for (const level of Constants.public.Enums.scholarship_degree_level) {
      const { count: expected } = await anon
        .from("scholarships")
        .select("id", { count: "exact", head: true })
        .eq("moderation_status", "verified")
        .contains("degree_levels", [level])
        .or(stillOpen);
      const actual = {
        bsc: rpc.bsc_count,
        msc: rpc.msc_count,
        phd: rpc.phd_count,
        postgraduate_diploma: rpc.postgraduate_diploma_count,
        other: rpc.other_count,
      }[level];
      expect(actual, `${level} facet count`).toBe(expected ?? 0);
    }
  });
});
