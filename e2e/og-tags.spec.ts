/**
 * og:title must be the page's own title, not the site-wide fallback.
 *
 * ── THE BUG, AND WHY NOTHING ELSE CATCHES IT ──────────────────────────────
 *
 * Next REPLACES a parent's `openGraph` object when a child declares one; it
 * does not merge field by field. A page that sets only `title` and
 * `description` therefore contributes NOTHING to openGraph and silently
 * inherits the root's generic "Talentrah".
 *
 * /about, /blog, every blog post and all three legal pages were in that state.
 * The failure is invisible from the page: the browser tab is right, the meta
 * description is right, and only the share card is generic — so it surfaces
 * when someone posts a link in WhatsApp and gets an unbranded card, which is
 * nobody's idea of a test.
 *
 * The same mechanism, from the other direction, had already cost the job pages
 * their og:image: they DID declare openGraph, and omitting `images` dropped
 * the inherited one.
 *
 * ── WHY THIS IS AN E2E TEST AND NOT A UNIT TEST ───────────────────────────
 *
 * The defect lives in how Next composes metadata across the layout/page
 * boundary. A unit test over the exported `metadata` object would have passed
 * throughout — the page's own object was always correct in isolation. Only the
 * rendered <head> shows what actually reaches a crawler.
 *
 * Signed-out, no fixture account: every page here is public.
 */
import { test, expect } from "@playwright/test";

const GENERIC = "Talentrah";

/** A representative sample: one of each shape that sets its own title. */
const PAGES = [
  { path: "/about", expect: "About — Talentrah" },
  { path: "/contact", expect: "Contact — Talentrah" },
  { path: "/blog", expect: "Blog — Talentrah" },
  { path: "/legal/privacy", expect: "Privacy Policy — Talentrah" },
];

async function head(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  const read = (sel: string) => page.locator(sel).first().getAttribute("content");
  return {
    title: await page.title(),
    ogTitle: await read('meta[property="og:title"]'),
    ogDescription: await read('meta[property="og:description"]'),
    ogImage: await read('meta[property="og:image"]'),
    twTitle: await read('meta[name="twitter:title"]'),
  };
}

test.describe("public pages carry their own social title", () => {
  for (const p of PAGES) {
    test(`${p.path}`, async ({ page }) => {
      const h = await head(page, p.path);
      expect(h.title, "the <title> tag itself").toBe(p.expect);
      // The actual regression: og:title equal to the bare site name means the
      // page never contributed an openGraph block at all.
      expect(h.ogTitle, `${p.path} fell back to the generic og:title`).not.toBe(GENERIC);
      expect(h.ogTitle).toBe(p.expect);
      expect(h.twTitle).toBe(p.expect);
      // And declaring openGraph must not drop the inherited image.
      expect(h.ogImage, `${p.path} lost its og:image`).toContain("talentrah-mark");
    });
  }

  test("a blog post carries the POST's title, not the blog index's", async ({ page }) => {
    await page.goto("/blog");
    const href = await page.locator('a[href^="/blog/"]').first().getAttribute("href");
    expect(href, "no blog post to sample").toBeTruthy();

    const h = await head(page, href!);
    expect(h.ogTitle).not.toBe(GENERIC);
    expect(h.ogTitle).not.toBe("Blog — Talentrah");
    expect(h.ogTitle).toBe(h.title);
    expect(h.ogDescription).toBeTruthy();
    expect(h.ogImage).toContain("talentrah-mark");
  });

  test("a scholarship listing carries its OWN title, not the list page's", async ({ page }) => {
    /*
     * Fixed id, matching public-scholarship-page.spec.ts's own reasoning: a
     * verified listing with a real host institution, so this tests the
     * wiring rather than whichever row happens to sort first.
     */
    const h = await head(page, "/scholarships/6082edbd-bab1-4462-830e-8d40a6572463");
    expect(h.title).toBe("Gates Cambridge Scholarship — Gates Cambridge Trust — Talentrah");
    expect(h.ogTitle, "the scholarship page fell back to the generic og:title").not.toBe(GENERIC);
    expect(h.ogTitle).toBe(h.title);
    expect(h.twTitle).toBe(h.title);
    expect(h.ogImage, "the scholarship page lost its og:image").toContain("talentrah-mark");
    // Built from the listing's own fields — see generateMetadata's comment —
    // and must not be empty, since scholarships carry no description column
    // the way a job posting does.
    expect(h.ogDescription).toBeTruthy();
  });

  test("the home page keeps the generic title, which is correct there", async ({ page }) => {
    // The negative control. "/" sets no title of its own, so the site-wide
    // value IS its real title — a test that flagged every generic og:title
    // would fail here and be wrong.
    const h = await head(page, "/");
    expect(h.title).toBe(GENERIC);
    expect(h.ogTitle).toBe(GENERIC);
  });
});
