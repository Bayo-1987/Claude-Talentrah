/**
 * src/lib/seo/landing-page-links.ts — the "explore more" links that back-link
 * every landing page to its siblings and to each job/scholarship detail page.
 * A stale link here is worse than no link: it sends a real visitor into a
 * 404, on a page whose entire purpose is search-engine trust.
 *
 * ── AXIS CHOICE, AND WHY THE JOB-SIDE THRESHOLD CROSSING ISN'T HERE ────────
 *
 * This file crosses LANDING_PAGE_MIN_ENTRIES live on the scholarship
 * `postgraduate_diploma` degree axis — deliberately NOT the `other` axis
 * tests/seo/landing-page-data.test.ts already uses for its own below/at/above
 * crossing. Vitest runs test FILES concurrently by default (vitest.config.ts
 * runs 20+ suites in parallel against the same live database — see its own
 * hookTimeout comment), and the first version of this file used `other` too:
 * both files pushed and popped the SAME shared count at the same time, and
 * the run failed with a total that had already moved by the time the second
 * file's assertion read it. That is not the row-identity collision the
 * fingerprint/RUN-tag pattern elsewhere in this repo solves — it is two
 * suites racing the same AGGREGATE, which unique fixture rows do not fix.
 * `postgraduate_diploma` was confirmed live and by grep (2026-09-02) to be
 * both low (1 open verified row in CI) and untouched by any other test file,
 * making it the second safe, isolated axis.
 *
 * The equivalent job-side axes are NOT safe to depress the same way: a live
 * query against CI found "remote" open postings at 121 and Lagos-location
 * open postings at 32 — both shared, ingest-driven counts that other suites
 * and the real 3-hourly pipeline also touch. Deleting or closing enough of
 * them to cross back below 5 would mean destroying real seeded/ingested data
 * out from under a database this file does not own, which is exactly what
 * this repo's own delete-safety rules (CLAUDE.md's "never touch data you
 * don't own") rule out. Since liveJobLandingLinks and
 * liveScholarshipLandingLinks share the identical shape — one count query,
 * one `>= LANDING_PAGE_MIN_ENTRIES` comparison, one conditional push — the
 * scholarship-side round trip is the representative proof for both; the
 * job-side tests below instead confirm agreement (the link list's own count
 * matches the page loader's total) and the relevance/self-exclusion
 * filtering, which real ambient data can exercise safely without moving any
 * shared count.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { LANDING_PAGE_MIN_ENTRIES } from "@/lib/seo/landing-pages";
import { loadRemoteJobs, loadCityJobs, loadScholarshipsByLevel } from "@/lib/seo/landing-page-data";
import {
  liveJobLandingLinks,
  relevantJobLandingLinks,
  liveScholarshipLandingLinks,
  relevantScholarshipLandingLinks,
} from "@/lib/seo/landing-page-links";

for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const) {
  if (!process.env[key]) throw new Error(`landing-page-links test cannot run: ${key} is not set.`);
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
type DB = SupabaseClient<Database>;
const admin: DB = createClient<Database>(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon: DB = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdScholarships: string[] = [];
const RUN = randomUUID().slice(0, 8);

async function insertPostgradDiplomaFixture(): Promise<string> {
  const { data, error } = await admin
    .from("scholarships")
    .insert({
      provider: `LANDING-LINKS-TEST Provider ${RUN}`,
      program_name: `LANDING-LINKS-TEST ${RUN} ${randomUUID().slice(0, 8)}`,
      degree_levels: ["postgraduate_diploma"],
      field_tags: [],
      funding_type: "partial",
      funding_covers: [],
      eligibility_nationalities: ["Nigeria"],
      official_url: "https://example.test/landing-links-fixture",
      dedup_fingerprint: `landing-links-test-${randomUUID()}`,
      moderation_status: "verified",
      application_deadline: "2099-12-31",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not create postgraduate_diploma fixture: ${error?.message}`);
  createdScholarships.push(data.id);
  return data.id;
}

async function deleteScholarshipFixture(id: string): Promise<void> {
  const { error } = await admin.from("scholarships").delete().eq("id", id);
  if (error) throw new Error(`Could not delete fixture ${id}: ${error.message}`);
  const idx = createdScholarships.indexOf(id);
  if (idx >= 0) createdScholarships.splice(idx, 1);
}

afterAll(async () => {
  if (createdScholarships.length === 0) return;
  const { error } = await admin.from("scholarships").delete().in("id", createdScholarships);
  if (error) console.warn(`[cleanup] ${createdScholarships.length} landing-links-test scholarships left behind: ${error.message}`);
});

describe("liveScholarshipLandingLinks — inclusion tracks the threshold live", () => {
  it("omits '/scholarships/degree/postgraduate-diploma' while 'postgraduate_diploma' is below threshold", async () => {
    const baseline = (await liveScholarshipLandingLinks(anon)).find(
      (l) => l.href === "/scholarships/degree/postgraduate-diploma",
    );
    expect(baseline, "'postgraduate_diploma' must already be below threshold for this test to mean anything").toBeUndefined();
  });

  it("the link appears the same run 'postgraduate_diploma' crosses AT threshold, and disappears the same run it drops back below", async () => {
    // Measured live, not assumed — this is the exact bug the previous
    // version of this test had: it hardcoded a loop of LANDING_PAGE_MIN_ENTRIES
    // inserts assuming a baseline of 0, but postgraduate_diploma's real
    // baseline was 1, so "one fixture short of AT" was still AT threshold.
    const baseline = (await loadScholarshipsByLevel(anon, "postgraduate-diploma"))!.total;
    const toThreshold = LANDING_PAGE_MIN_ENTRIES - baseline;
    expect(toThreshold, "baseline is already at/above threshold — this test's crossing design needs revisiting").toBeGreaterThan(0);

    const before = await liveScholarshipLandingLinks(anon);
    expect(before.some((l) => l.href === "/scholarships/degree/postgraduate-diploma")).toBe(false);

    const fixtureIds: string[] = [];
    for (let i = 0; i < toThreshold; i++) fixtureIds.push(await insertPostgradDiplomaFixture());

    const atThreshold = await liveScholarshipLandingLinks(anon);
    expect(atThreshold.some((l) => l.href === "/scholarships/degree/postgraduate-diploma")).toBe(true);

    await deleteScholarshipFixture(fixtureIds.pop()!);
    const backBelow = await liveScholarshipLandingLinks(anon);
    expect(backBelow.some((l) => l.href === "/scholarships/degree/postgraduate-diploma")).toBe(false);

    for (const id of fixtureIds) await deleteScholarshipFixture(id);
  });

  it("excludeHref removes a page's own link from its own 'explore more' list", async () => {
    const baseline = (await loadScholarshipsByLevel(anon, "postgraduate-diploma"))!.total;
    const toThreshold = Math.max(0, LANDING_PAGE_MIN_ENTRIES - baseline);

    const fixtureIds: string[] = [];
    for (let i = 0; i < toThreshold; i++) fixtureIds.push(await insertPostgradDiplomaFixture());

    const withoutExclude = await liveScholarshipLandingLinks(anon);
    expect(withoutExclude.some((l) => l.href === "/scholarships/degree/postgraduate-diploma")).toBe(true);

    const withExclude = await liveScholarshipLandingLinks(anon, "/scholarships/degree/postgraduate-diploma");
    expect(withExclude.some((l) => l.href === "/scholarships/degree/postgraduate-diploma")).toBe(false);

    for (const id of fixtureIds) await deleteScholarshipFixture(id);
  });
});

describe("relevantScholarshipLandingLinks — only the categories a listing actually belongs to", () => {
  it("a full-funding, msc scholarship gets both the fully-funded and msc links", async () => {
    // Sanity on the filter's own logic, using stable ambient axes (msc and
    // fully-funded are both well above threshold in CI) rather than fixtures.
    const links = await relevantScholarshipLandingLinks(anon, { funding_type: "full", degree_levels: ["msc"] });
    expect(links.some((l) => l.href === "/scholarships/fully-funded")).toBe(true);
    expect(links.some((l) => l.href === "/scholarships/degree/msc")).toBe(true);
  });

  it("a partial-funding scholarship never gets the fully-funded link", async () => {
    const links = await relevantScholarshipLandingLinks(anon, { funding_type: "partial", degree_levels: ["msc"] });
    expect(links.some((l) => l.href === "/scholarships/fully-funded")).toBe(false);
  });

  it("a bsc-only scholarship never gets the msc or phd links", async () => {
    const links = await relevantScholarshipLandingLinks(anon, { funding_type: "partial", degree_levels: ["bsc"] });
    expect(links.some((l) => l.href === "/scholarships/degree/msc")).toBe(false);
    expect(links.some((l) => l.href === "/scholarships/degree/phd")).toBe(false);
  });
});

describe("liveJobLandingLinks and relevantJobLandingLinks — agreement with the page loaders, on stable ambient data", () => {
  it("'/jobs/remote' appears, and its own total agrees with loadRemoteJobs", async () => {
    const [links, remote] = await Promise.all([liveJobLandingLinks(anon), loadRemoteJobs(anon)]);
    expect(remote.total, "this test assumes remote postings are currently above threshold in CI").toBeGreaterThanOrEqual(
      LANDING_PAGE_MIN_ENTRIES,
    );
    expect(links.some((l) => l.href === "/jobs/remote")).toBe(true);
  });

  it("'/jobs/in/lagos' appears, and its own total agrees with loadCityJobs", async () => {
    const [links, lagos] = await Promise.all([liveJobLandingLinks(anon), loadCityJobs(anon, "lagos")]);
    expect(lagos!.total, "this test assumes Lagos postings are currently above threshold in CI").toBeGreaterThanOrEqual(
      LANDING_PAGE_MIN_ENTRIES,
    );
    expect(links.some((l) => l.href === "/jobs/in/lagos")).toBe(true);
  });

  it("excludeHref removes a page's own link from its own 'explore more' list", async () => {
    const links = await liveJobLandingLinks(anon, "/jobs/remote");
    expect(links.some((l) => l.href === "/jobs/remote")).toBe(false);
  });

  it("a remote job's relevant links include remote but not a city it isn't posted in", async () => {
    const links = await relevantJobLandingLinks(anon, {
      work_type: "remote",
      location: "Remote",
      external_source: null,
    });
    expect(links.some((l) => l.href === "/jobs/remote")).toBe(true);
    expect(links.some((l) => l.href === "/jobs/in/lagos")).toBe(false);
  });

  it("a Lagos on-site job's relevant links include Lagos but not remote", async () => {
    const links = await relevantJobLandingLinks(anon, {
      work_type: "onsite",
      location: "Lagos, Nigeria",
      external_source: null,
    });
    expect(links.some((l) => l.href === "/jobs/in/lagos")).toBe(true);
    expect(links.some((l) => l.href === "/jobs/remote")).toBe(false);
  });
});
