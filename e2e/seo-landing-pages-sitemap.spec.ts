/**
 * The SEO landing pages' sitemap presence: the "200-only rule" from
 * e2e/scholarship-sitemap.spec.ts, extended to content-emptiness. A landing
 * page 404s below LANDING_PAGE_MIN_ENTRIES (src/lib/seo/landing-pages.ts), so
 * sitemap.ts must never list a URL that would 404 for the visitor who clicks
 * it from search results — that is a worse outcome than the URL never
 * existing, because it burns the crawl budget AND the click.
 *
 * This lives in e2e, not vitest, because src/app/sitemap.ts calls its own
 * `createClient()` from src/lib/supabase/server.ts, which needs next/headers'
 * `cookies()` — an active Next.js request context that only a real running
 * server provides. tests/seo/landing-page-data.test.ts and
 * landing-page-links.test.ts already cover the underlying threshold logic
 * directly; this file proves sitemap.ts actually WIRES that logic in, over
 * real HTTP.
 *
 * Playwright here runs with `workers: 1, fullyParallel: false`
 * (playwright.config.ts) — genuinely one test at a time, so unlike the
 * vitest SEO suites (which had to split axes to survive concurrent files —
 * see landing-page-links.test.ts's header) there is no risk of this file's
 * own fixture inserts racing another spec's. `phd` is used for the
 * below/at-crossing case: a live query against CI (2026-09-02) found it at 4
 * open verified rows, needing exactly one fixture to reach the threshold of
 * 5, and its own routes are otherwise untouched by any other e2e spec.
 */
import { test, expect, admin } from "./fixtures/authed";
import { randomUUID } from "node:crypto";

test.describe("stable, above-threshold landing pages: live in the sitemap today", () => {
  test("remote jobs, Lagos jobs and fully-funded scholarships all appear", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body, "/jobs/remote missing from sitemap").toContain("/jobs/remote");
    expect(body, "/jobs/in/lagos missing from sitemap").toContain("/jobs/in/lagos");
    expect(body, "/scholarships/fully-funded missing from sitemap").toContain("/scholarships/fully-funded");
  });

  test("each listed landing page actually returns 200, not just a sitemap entry", async ({ request }) => {
    for (const path of ["/jobs/remote", "/jobs/in/lagos", "/scholarships/fully-funded"]) {
      const res = await request.get(path);
      expect(res.status(), `${path} is in the sitemap but does not return 200`).toBe(200);
    }
  });
});

test.describe("a thin category: excluded below threshold, included the same run it crosses, excluded again the same run it drops back", () => {
  test("phd scholarships: /scholarships/degree/phd tracks LANDING_PAGE_MIN_ENTRIES live in both the sitemap and the page itself", async ({
    request,
  }) => {
    const tag = randomUUID().slice(0, 8);

    async function phdOpenCount(): Promise<number> {
      const today = new Date().toISOString().slice(0, 10);
      const { count, error } = await admin
        .from("scholarships")
        .select("id", { count: "exact", head: true })
        .eq("moderation_status", "verified")
        .contains("degree_levels", ["phd"])
        .or(`application_deadline.is.null,application_deadline.gte.${today}`);
      if (error) throw new Error(`could not measure phd baseline: ${error.message}`);
      return count ?? 0;
    }

    async function insertPhdFixture(n: number): Promise<string> {
      const { data, error } = await admin
        .from("scholarships")
        .insert({
          provider: `SEO-SITEMAP-TEST Provider ${tag}`,
          program_name: `SEO-SITEMAP-TEST ${tag} #${n}`,
          degree_levels: ["phd"],
          field_tags: [],
          funding_type: "partial",
          funding_covers: [],
          eligibility_nationalities: ["Nigeria"],
          official_url: "https://example.test/seo-sitemap-fixture",
          dedup_fingerprint: `seo-sitemap-test-${tag}-${n}`,
          moderation_status: "verified",
          application_deadline: "2099-12-31",
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`could not create phd fixture: ${error?.message}`);
      return data.id;
    }

    const LANDING_PAGE_MIN_ENTRIES = 5; // mirrors src/lib/seo/landing-pages.ts — see that module for why 5
    const baseline = await phdOpenCount();
    const toThreshold = LANDING_PAGE_MIN_ENTRIES - baseline;
    expect(toThreshold, "phd is already at/above threshold in this environment — pick a different axis").toBeGreaterThan(0);

    const fixtureIds: string[] = [];
    try {
      // BELOW: confirmed before any fixture exists.
      expect(await phdOpenCount()).toBeLessThan(LANDING_PAGE_MIN_ENTRIES);
      let res = await request.get("/sitemap.xml");
      expect((await res.text())).not.toContain("/scholarships/degree/phd");
      res = await request.get("/scholarships/degree/phd");
      expect(res.status(), "a below-threshold degree page must 404, not serve a thin page").toBe(404);

      // Cross to AT threshold, live, one fixture at a time.
      for (let i = 0; i < toThreshold; i++) fixtureIds.push(await insertPhdFixture(i));
      expect(await phdOpenCount()).toBe(LANDING_PAGE_MIN_ENTRIES);

      res = await request.get("/sitemap.xml");
      expect(await res.text(), "phd crossed the threshold but the sitemap did not pick it up").toContain(
        "/scholarships/degree/phd",
      );
      res = await request.get("/scholarships/degree/phd");
      expect(res.status(), "phd is at threshold but its own page still 404s").toBe(200);

      // Drop back BELOW by removing one fixture — same run, no redeploy.
      const removed = fixtureIds.pop()!;
      const { error: delErr } = await admin.from("scholarships").delete().eq("id", removed);
      if (delErr) throw new Error(`could not remove phd fixture: ${delErr.message}`);

      expect(await phdOpenCount()).toBe(LANDING_PAGE_MIN_ENTRIES - 1);
      res = await request.get("/sitemap.xml");
      expect(
        await res.text(),
        "phd dropped below threshold but the sitemap still lists it — this is the doorway-spam case",
      ).not.toContain("/scholarships/degree/phd");
      res = await request.get("/scholarships/degree/phd");
      expect(res.status(), "phd dropped below threshold but its page still serves 200").toBe(404);
    } finally {
      if (fixtureIds.length > 0) {
        const { error } = await admin.from("scholarships").delete().in("id", fixtureIds);
        if (error) throw new Error(`phd fixture cleanup failed: ${error.message}`);
      }
    }
  });
});
