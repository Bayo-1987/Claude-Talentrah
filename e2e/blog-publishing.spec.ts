/**
 * Publishing state is the same fact on every public surface.
 *
 * ── WHAT THIS IS FOR ──────────────────────────────────────────────────────
 *
 * Moving the blog into the database (0074) made "published" a row value rather
 * than the presence of a file. Three surfaces read it — the /blog listing, the
 * post route, and the sitemap — and nothing but a test keeps them agreeing.
 * A post that 404s while still sitting in the sitemap is the specific failure
 * worth preventing: it is invisible to a human and is exactly what Google
 * penalises a sitemap for.
 *
 * ── NO PUBLIC PREVIEW, DELIBERATELY ───────────────────────────────────────
 *
 * There is no signed link, no `?preview=` and no exception for a draft. The
 * first test asserts the absence rather than trusting it, because "add a
 * preview URL" is a reasonable-sounding request that would quietly undo
 * 0074's guarantee.
 *
 * Fixtures are created with the service role and cleaned up; no auth user is
 * created, so this adds nothing to the load tracked in #136.
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

const slug = `e2e-publishing-${randomUUID()}`;
let id = "";

test.beforeAll(async () => {
  const { data, error } = await db
    .from("blog_posts")
    .insert({
      slug,
      title: "Publishing fixture",
      description: "Fixture post owned by e2e/blog-publishing.",
      author: "Tests",
      body: "## Fixture heading\n\nFixture body paragraph.",
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture insert failed: ${error?.message}`);
  id = data.id;
});

test.afterAll(async () => {
  const { error } = await db.from("blog_posts").delete().eq("id", id);
  if (error) throw new Error(`cleanup failed, ${id} left behind: ${error.message}`);
});

async function setStatus(status: "draft" | "published") {
  const { error } = await db
    .from("blog_posts")
    .update({ status, published_at: status === "published" ? new Date().toISOString() : undefined })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

test("a draft is absent from every public surface", async ({ page, request }) => {
  await setStatus("draft");

  const res = await page.goto(`/blog/${slug}`);
  expect(res?.status(), "a draft post did not 404").toBe(404);

  await page.goto("/blog");
  await expect(page.locator(`a[href="/blog/${slug}"]`), "a draft was listed on /blog").toHaveCount(0);

  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap.includes(slug), "a draft appeared in the sitemap").toBe(false);
});

test("a post published before anyone asks for it is live on all three surfaces", async ({
  page,
  request,
}) => {
  /*
   * A SEPARATE, NEVER-REQUESTED SLUG, and that is the whole design of this
   * test rather than an implementation detail.
   *
   * In CI the app is a production build, so /blog/[slug] is cached. Requesting
   * a slug while it is a draft caches a 404 for it. Flipping `status` straight
   * in the database — as this file's fixtures do — performs none of the
   * revalidation the real publish path does, so that stale 404 keeps being
   * served and the test fails against a product that is working correctly.
   *
   * The real path is covered where it belongs: e2e/admin-blog.spec.ts drives
   * publish and unpublish through the admin UI, whose Server Actions call
   * revalidatePath, and asserts the same three surfaces afterwards. This file
   * asserts what a database-level fixture can honestly assert on its own.
   */
  const freshSlug = `e2e-publishing-live-${randomUUID()}`;
  const { data, error } = await db
    .from("blog_posts")
    .insert({
      slug: freshSlug,
      title: "Already published fixture",
      description: "Fixture post owned by e2e/blog-publishing.",
      author: "Tests",
      body: "## Fixture heading\n\nFixture body paragraph.",
      status: "published",
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture insert failed: ${error?.message}`);

  try {
    const res = await page.goto(`/blog/${freshSlug}`);
    expect(res?.status(), "a published post did not render").toBe(200);
    await expect(page.getByRole("heading", { name: "Already published fixture" })).toBeVisible();
    // Rendered from Markdown, not printed as raw text.
    await expect(page.getByRole("heading", { name: "Fixture heading" })).toBeVisible();

    // Its own metadata, not the site-wide fallback.
    const og = await page.locator('meta[property="og:title"]').first().getAttribute("content");
    expect(og).not.toBe("Talentrah");
    expect(og).toContain("Already published fixture");

    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap.includes(freshSlug), "published post missing from the sitemap").toBe(true);
  } finally {
    const { error: cleanupError } = await db.from("blog_posts").delete().eq("id", data.id);
    if (cleanupError) throw new Error(`cleanup failed: ${cleanupError.message}`);
  }
});

test("the row survives being unpublished — the retirement path keeps history", async () => {
  /*
   * Asserted at the DATA layer only. Whether the public surfaces update is a
   * cache question answered by the admin lifecycle spec; what matters here is
   * that unpublishing is not a disguised delete.
   */
  await setStatus("published");
  await setStatus("draft");

  const { data } = await db.from("blog_posts").select("id, status, published_at").eq("id", id).single();
  expect(data?.id, "unpublishing deleted the row").toBe(id);
  expect(data?.status).toBe("draft");
  expect(data?.published_at, "published_at was cleared on unpublish").not.toBeNull();
});
