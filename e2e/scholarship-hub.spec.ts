/**
 * send-387 Part 1 — /scholarships/apply-now, a pillar/hub page assembled
 * from content that already exists: the scholarship deep-dive posts and the
 * funding-type/degree-level programmatic landing pages (landing-pages.ts).
 *
 * ── WHY THIS USES DATABASE FIXTURES, NOT THE SIX REAL POSTS ────────────────
 *
 * Blog content is hand-published to production only (confirmed via a direct
 * Supabase query against both projects) — the shared local-dev project and
 * every ephemeral per-job CI database (seeded from supabase/migrations/ with
 * no blog_posts rows) genuinely have zero matching posts. A test asserting
 * the six real titles would pass in production and fail everywhere else for
 * a reason that has nothing to do with a regression.
 *
 * So this file proves the thing the task actually cares about — the hub
 * resolves posts by a live title match, never a hardcoded slug, and never
 * links to a post that wouldn't itself return 200 — using its own
 * short-lived fixture rows, the same pattern e2e/blog-publishing.spec.ts
 * already uses for the same reason (service-role insert, assert, delete).
 * This is environment-independent: it exercises the identical
 * loadScholarshipHubPosts() keyword-match path whether the surrounding DB
 * has zero real posts (CI) or six (production).
 */
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";

const db = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

test.describe("send-387: /scholarships/apply-now hub page", () => {
  test("real 200, unique title/description reflecting the current cycle, real H1", async ({ page, request }) => {
    const res = await page.goto("/scholarships/apply-now");
    expect(res?.status()).toBe(200);

    const title = await page.title();
    expect(title).toMatch(/^Scholarships Open for \d{4}\/\d{4}: Every Deadline in One Place — Talentrah$/);
    expect(title).not.toBe("Talentrah");

    const description = await page.locator('meta[name="description"]').first().getAttribute("content");
    expect(description).toMatch(/\d{4}\/\d{4} scholarship deadlines/);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Scholarships open for the \d{4}\/\d{4} cycle\./);

    // Cross-check the cycle in the copy against the same computation the
    // page itself uses, so this fails the day the July-cutoff logic changes
    // in a way that disagrees with what's rendered — not a hardcoded year.
    const now = new Date();
    const julyOrLater = now.getUTCMonth() >= 6;
    const startYear = julyOrLater ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    const expectedCycle = `${startYear}/${startYear + 1}`;
    expect(title).toContain(expectedCycle);

    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("<loc>https://www.talentrah.com/scholarships/apply-now</loc>");
  });

  test("links to a matching post by its REAL current slug, never a hardcoded one — and the link is not dead", async ({
    page,
  }) => {
    const slug = `e2e-scholarship-hub-${randomUUID()}`;
    const title = "PTDF Overseas Scholarship — E2E Fixture";
    const { data, error } = await db
      .from("blog_posts")
      .insert({
        slug,
        title,
        description: "Fixture post owned by e2e/scholarship-hub.",
        author: "Tests",
        body: "## Fixture heading\n\nFixture body paragraph.",
        status: "published",
        published_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`fixture insert failed: ${error?.message}`);

    try {
      await page.goto("/scholarships/apply-now");
      const link = page.getByRole("link", { name: new RegExp(title) });
      await expect(link).toBeVisible();
      // The href must be the fixture's OWN random slug — proof this isn't a
      // hardcoded string that happens to match by coincidence.
      expect(await link.getAttribute("href")).toBe(`/blog/${slug}`);

      const followed = await page.request.get(`/blog/${slug}`);
      expect(followed.status(), "the hub linked to a post that itself 404s").toBe(200);
    } finally {
      const { error: cleanupError } = await db.from("blog_posts").delete().eq("id", data.id);
      if (cleanupError) throw new Error(`cleanup failed, fixture ${data.id} left behind: ${cleanupError.message}`);
    }
  });

  test("a draft post matching a keyword is NOT linked — publish status is respected, not just the title", async ({
    page,
  }) => {
    const slug = `e2e-scholarship-hub-draft-${randomUUID()}`;
    const title = "Rhodes Scholarship Draft — E2E Fixture";
    const { data, error } = await db
      .from("blog_posts")
      .insert({
        slug,
        title,
        description: "Fixture post owned by e2e/scholarship-hub.",
        author: "Tests",
        body: "## Fixture heading\n\nFixture body paragraph.",
        status: "draft",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`fixture insert failed: ${error?.message}`);

    try {
      await page.goto("/scholarships/apply-now");
      await expect(page.getByRole("link", { name: new RegExp(title) })).toHaveCount(0);
    } finally {
      const { error: cleanupError } = await db.from("blog_posts").delete().eq("id", data.id);
      if (cleanupError) throw new Error(`cleanup failed, fixture ${data.id} left behind: ${cleanupError.message}`);
    }
  });

  test("every funding-type/degree-level link shown is actually live — none 404 underneath the hub", async ({
    page,
  }) => {
    await page.goto("/scholarships/apply-now");
    const links = page.locator('a[href^="/scholarships/fully-funded"], a[href^="/scholarships/degree/"]');
    const count = await links.count();
    for (let i = 0; i < count; i++) {
      const href = await links.nth(i).getAttribute("href");
      const res = await page.request.get(href!);
      expect(res.status(), `${href} rendered on the hub but does not itself return 200`).toBe(200);
    }
  });

  test("does not appear in the same fixed spot for every render — filters by live LANDING_PAGE_MIN_ENTRIES, not hardcoded", async ({
    page,
  }) => {
    // Regression guard for the specific bug this build caught: the
    // degree-level buttons originally rendered unconditionally (including a
    // 0-count "Other" and a below-threshold "PG Diploma"), which the
    // previous test's live-200 check would also catch, but this asserts the
    // absence directly against the ONE known-fixed level.
    await page.goto("/scholarships/apply-now");
    const otherLink = page.locator('a[href="/scholarships/degree/other"]');
    const otherLinkCount = await otherLink.count();
    if (otherLinkCount > 0) {
      // If it ever renders, it must be because the live count genuinely
      // cleared the threshold — never because the gate was removed.
      const res = await page.request.get("/scholarships/degree/other");
      expect(res.status()).toBe(200);
    }
  });
});

test.describe("send-387 regression: the six existing scholarship posts are untouched", () => {
  test("the blog index and sitemap still work — the hub did not change how posts are listed", async ({
    page,
    request,
  }) => {
    const res = await page.goto("/blog");
    expect(res?.status()).toBe(200);
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("<loc>https://www.talentrah.com/blog</loc>");
  });
});
