/**
 * src/lib/seo/landing-page-data.ts — the threshold behaviour every SEO
 * landing page gates on, AND the liveness claim behind it: "a category that
 * empties out below LANDING_PAGE_MIN_ENTRIES drops out the same run it
 * happens, with no deploy" (src/lib/seo/landing-pages.ts's header).
 *
 * Run against the REAL database with a REAL anon client — not mocked — for
 * the same reason tests/scholarships/upsert-batch-shape.test.ts exists
 * rather than trusting a mock's own fake `.upsert()`: a mock proves the
 * function CALLS the client correctly, never that a live count query is
 * actually live. `loadFullyFundedScholarships`/`loadScholarshipsByLevel`
 * take a plain SupabaseClient<Database> (not the request-scoped
 * createClient(), which needs next/headers and cannot run outside a real
 * request) — that is what makes calling them directly here possible.
 *
 * `other` is the axis used for the threshold-crossing tests, deliberately —
 * NOT `bsc`, which was measured at 2 open verified rows in an earlier pass
 * of this same investigation and had grown to exactly 5 (AT threshold
 * already) by the time this file was actually run against live CI. That
 * growth is the exact "measure, don't assume" lesson this repo's own
 * CLAUDE.md calls out repeatedly: a live count queried live, right before
 * writing this file, showed `other` at 0 open verified rows in CI (vs. bsc
 * 5, phd 4, postgraduate_diploma 1, msc 13) and confirmed by grep that no
 * other test file in this repo manipulates the `other` scholarship degree
 * level — the combination that makes it safe to push across the threshold
 * with a handful of additively-inserted, uniquely-tagged fixtures without
 * racing a concurrent CI run or a future real `other`-level listing. Existing
 * `other` rows (if any appear later) are never touched or deleted — only
 * fixture rows this file itself creates.
 *
 * tests/seo/landing-page-links.test.ts needed the same kind of isolated axis
 * for its own threshold-crossing and deliberately used `postgraduate_diploma`
 * instead of `other` — see that file's header for why reusing the same axis
 * across two concurrently-running files broke on the first attempt.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { LANDING_PAGE_MIN_ENTRIES } from "@/lib/seo/landing-pages";
import {
  loadFullyFundedScholarships,
  loadScholarshipsByLevel,
} from "@/lib/seo/landing-page-data";

for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const) {
  if (!process.env[key]) throw new Error(`landing-page-data test cannot run: ${key} is not set.`);
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
type DB = SupabaseClient<Database>;

const admin: DB = createClient<Database>(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
// The SAME kind of client every real landing page actually reads through —
// anon key, no session. If RLS ever stopped scoping these queries to
// verified rows, this suite would start seeing whatever leaked.
const anon: DB = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const created: string[] = [];
const RUN = randomUUID().slice(0, 8);

/** A verified, still-open "other"-level fixture, isolated from the fully-funded axis (partial funding). */
async function insertOtherLevelFixture(): Promise<string> {
  const { data, error } = await admin
    .from("scholarships")
    .insert({
      provider: `LANDING-PAGE-TEST Provider ${RUN}`,
      program_name: `LANDING-PAGE-TEST ${RUN} ${randomUUID().slice(0, 8)}`,
      degree_levels: ["other"],
      field_tags: [],
      funding_type: "partial",
      funding_covers: [],
      eligibility_nationalities: ["Nigeria"],
      official_url: "https://example.test/landing-page-fixture",
      dedup_fingerprint: `landing-page-test-${randomUUID()}`,
      moderation_status: "verified",
      application_deadline: "2099-12-31",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not create "other"-level fixture: ${error?.message}`);
  created.push(data.id);
  return data.id;
}

async function deleteFixture(id: string): Promise<void> {
  const { error } = await admin.from("scholarships").delete().eq("id", id);
  if (error) throw new Error(`Could not delete fixture ${id}: ${error.message}`);
  const idx = created.indexOf(id);
  if (idx >= 0) created.splice(idx, 1);
}

afterAll(async () => {
  if (created.length === 0) return;
  const { error } = await admin.from("scholarships").delete().in("id", created);
  if (error) console.warn(`[cleanup] ${created.length} landing-page-test scholarships left behind: ${error.message}`);
});

describe("loadScholarshipsByLevel — threshold behaviour, above/at/below", () => {
  it("'other' starts below LANDING_PAGE_MIN_ENTRIES in this environment", async () => {
    // The precondition the rest of this describe block depends on — stated
    // as an assertion, not a comment, so a future world where "other" has
    // genuinely grown fails loudly here instead of making the "below" case
    // below silently meaningless. This is exactly the check that caught bsc
    // having grown from 2 to 5 between this suite's design and its first
    // real run — see the module header.
    const before = await loadScholarshipsByLevel(anon, "other");
    expect(
      before!.total,
      "'other' is no longer below threshold — this test's below/at-crossing design needs revisiting",
    ).toBeLessThan(LANDING_PAGE_MIN_ENTRIES);
  });

  it("crosses BELOW → AT → ABOVE → back BELOW, live, with no rebuild between steps", async () => {
    const baseline = (await loadScholarshipsByLevel(anon, "other"))!.total;
    const toThreshold = LANDING_PAGE_MIN_ENTRIES - baseline;

    // BELOW: confirmed by the previous test and re-confirmed here.
    expect((await loadScholarshipsByLevel(anon, "other"))!.total).toBeLessThan(LANDING_PAGE_MIN_ENTRIES);

    // Insert fixtures one at a time up to exactly AT threshold, checking
    // liveness at every step — each insert must be visible to the VERY NEXT
    // call, which is only true if nothing is cached between them.
    const fixtureIds: string[] = [];
    for (let i = 0; i < toThreshold; i++) {
      fixtureIds.push(await insertOtherLevelFixture());
      const after = await loadScholarshipsByLevel(anon, "other");
      expect(after!.total, `total did not reflect fixture ${i + 1} immediately after insert`).toBe(
        baseline + i + 1,
      );
    }

    // AT threshold exactly.
    const atThreshold = await loadScholarshipsByLevel(anon, "other");
    expect(atThreshold!.total).toBe(LANDING_PAGE_MIN_ENTRIES);
    expect(atThreshold!.total >= LANDING_PAGE_MIN_ENTRIES, "AT threshold must count as visible").toBe(true);

    // ABOVE: one more fixture.
    fixtureIds.push(await insertOtherLevelFixture());
    const above = await loadScholarshipsByLevel(anon, "other");
    expect(above!.total).toBe(LANDING_PAGE_MIN_ENTRIES + 1);

    // Back BELOW: delete two fixtures (undoing the crossing), live again —
    // the same call, no server restart, no cache to invalidate.
    await deleteFixture(fixtureIds.pop()!);
    await deleteFixture(fixtureIds.pop()!);
    const backBelow = await loadScholarshipsByLevel(anon, "other");
    expect(backBelow!.total).toBe(LANDING_PAGE_MIN_ENTRIES - 1);
    expect(backBelow!.total < LANDING_PAGE_MIN_ENTRIES, "one below threshold must count as NOT visible").toBe(
      true,
    );

    // Clean up whatever fixtures remain from this test.
    for (const id of fixtureIds) await deleteFixture(id);
  });

  it("returns null for an invalid level slug before any query runs", async () => {
    const result = await loadScholarshipsByLevel(anon, "not-a-real-level");
    expect(result).toBeNull();
  });

  it("a fixture's own row is actually IN the returned rows, not just counted", async () => {
    // The count and the row list must agree — a page that shows "6 results"
    // but only 5 rows would be its own, quieter bug.
    const id = await insertOtherLevelFixture();
    const result = await loadScholarshipsByLevel(anon, "other");
    expect(result!.scholarships.some((s) => s.id === id)).toBe(true);
    await deleteFixture(id);
  });
});

describe("loadFullyFundedScholarships — isolated from the 'other'-level fixtures above", () => {
  it("partial-funding 'other'-level fixtures never appear here", async () => {
    // Proves the two landing pages' queries are independently scoped —
    // this file's own fixtures are funding_type: 'partial' specifically so
    // they can never leak into the fully-funded count and produce a false
    // "it works" from cross-contamination.
    const id = await insertOtherLevelFixture();
    const result = await loadFullyFundedScholarships(anon);
    expect(result.scholarships.some((s) => s.id === id)).toBe(false);
    await deleteFixture(id);
  });
});
