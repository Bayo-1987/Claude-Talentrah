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
import { admin } from "./fixtures/authed";

const GENERIC = "Talentrah";

/** A representative sample: one of each shape that sets its own title. */
const PAGES = [
  { path: "/", expect: "AI Job Search Copilot — Talentrah" },
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
    twCard: await read('meta[name="twitter:card"]'),
    twImage: await read('meta[name="twitter:image"]'),
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
    // A blog post is one of the three families with its own rendered card.
    expect(h.ogImage, "a blog post fell back to the static mark").not.toContain("talentrah-mark");
    expect(h.ogImage).toContain(`${href}/opengraph-image`);
  });

  test("a scholarship listing carries its OWN title, not the list page's", async ({ page }) => {
    /*
     * Fixed listing, matching public-scholarship-page.spec.ts's own
     * reasoning: a verified listing with a real host institution, so this
     * tests the wiring rather than whichever row happens to sort first.
     *
     * Resolved by natural key rather than a hardcoded id (Stage 2) — a
     * literal id was only ever stable because the old shared CI database
     * was never wiped; a fresh per-run local Supabase stack generates a new
     * one every run.
     */
    const { data: scholarship, error } = await admin
      .from("scholarships")
      .select("id")
      .eq("program_name", "Gates Cambridge Scholarship")
      .eq("moderation_status", "verified")
      .single();
    if (error || !scholarship) {
      throw new Error(`seeded "Gates Cambridge Scholarship" not found — run \`npm run seed:catalog\`: ${error?.message ?? "no row"}`);
    }
    const h = await head(page, `/scholarships/${scholarship.id}`);
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

  /**
   * ── THE PER-PAGE SHARE CARD, AND THE ONE WAY IT SILENTLY DIES ───────────
   *
   * Three page families (job detail, blog post, city/remote landing) render
   * their own 1200x630 card from a colocated `opengraph-image.tsx`. Next
   * merges a file-based image in ONLY when the same level does not declare
   * `openGraph.images` itself — `mergeStaticMetadata` tests
   * `hasOwnProperty('images')` — so restoring that key in generateMetadata
   * would silently disable the whole feature while the image route kept
   * compiling, kept passing lint, and kept serving a perfectly good PNG that
   * nothing points at.
   *
   * That is invisible everywhere except the rendered <head>, which is why it
   * is asserted here and not in a unit test over the metadata object: the
   * page's own object is CORRECT in both the working and the broken case.
   *
   * The image route is also fetched, not just referenced. A `<meta>` pointing
   * at a route that 500s or renders blank is the same bug with better
   * paperwork — and Satori fails quietly (an unsupported CSS property does
   * nothing rather than throwing), so "the URL is right" is not evidence.
   *
   * ── FETCH THE PATH, NEVER THE URL IN THE TAG ────────────────────────────
   *
   * `og:image` is ABSOLUTE and points at `metadataBase` — the canonical
   * production origin (SITE_ORIGIN, see layout.tsx for why it is deliberately
   * not VERCEL_URL). That is correct: a crawler must be able to follow it, and
   * a relative og:image is itself a real bug.
   *
   * It also means passing that URL straight to `request.get()` fetches
   * www.talentrah.com — the DEPLOYED site — instead of the server under test,
   * which is a green-looking assertion about the wrong machine and a 404 as
   * soon as the branch adds a route production does not have yet. That is not
   * hypothetical: it is exactly how this test first failed in CI, passing
   * locally the whole time because `next dev` emits the localhost origin for
   * file-convention metadata routes while `next build` emits metadataBase.
   *
   * So: assert the tag is absolute, then fetch its PATH against Playwright's
   * baseURL. The origin itself is deliberately NOT asserted against a literal
   * — it comes from metadataBase and an env override is a supported
   * deployment, so pinning the string here would fail for a reason that has
   * nothing to do with share cards.
   */

  /**
   * The path+query of an absolute metadata URL, for requesting against the
   * server under test. Also asserts the tag really is absolute — a crawler
   * cannot follow a relative og:image, so that is worth pinning here rather
   * than quietly tolerating.
   */
  function samePath(absolute: string | null): string {
    expect(absolute, "og:image is missing").toBeTruthy();
    expect(absolute, "og:image must be absolute for a crawler to follow it").toMatch(
      /^https?:\/\//,
    );
    const u = new URL(absolute!);
    return `${u.pathname}${u.search}`;
  }
  test("a job detail page renders its OWN share card, not the static mark", async ({ page }) => {
    /*
     * Sampled from a public listing rather than resolved by natural key. This
     * asserts nothing about WHICH posting — any public one exercises the same
     * wiring — so a fixture lookup would only add a way to fail for an
     * unrelated reason. /jobs/in/lagos is guaranteed to carry at least
     * LANDING_PAGE_MIN_ENTRIES links or it would not be a live page at all,
     * which seo-landing-pages-sitemap.spec.ts already pins independently.
     */
    await page.goto("/jobs/in/lagos");
    // Filtered to an id-shaped href, not just the first `/jobs/` link — the
    // "Also browsing:" row at the top of the page links to /jobs/remote.
    const hrefs = await page.locator('a[href^="/jobs/"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute("href") ?? ""),
    );
    const href = hrefs.find((h) => /^\/jobs\/[0-9a-f-]{36}$/.test(h));
    expect(href, "no public job link to sample").toBeTruthy();

    const h = await head(page, href!);
    expect(h.ogImage, "the job page fell back to the static mark").not.toContain("talentrah-mark");
    expect(h.ogImage).toContain(`${href}/opengraph-image`);
    // twitter:image must move with it. Declaring it in generateMetadata is the
    // OTHER half of the same footgun — the file convention skips the merge on
    // either key independently.
    expect(h.twImage, "twitter kept the static mark").not.toContain("talentrah-mark");
    expect(h.twImage).toContain(`${href}/opengraph-image`);
    // 1200x630 wants the wide card; the square mark did not. Both settings
    // describe one decision, so they must agree.
    expect(h.twCard).toBe("summary_large_image");

    // Absolute for the crawler, fetched by path against the server under test
    // — which is the only machine this run can actually speak to.
    const img = await page.request.get(samePath(h.ogImage));
    expect(img.status(), "the og:image route must serve an image").toBe(200);
    expect(img.headers()["content-type"]).toContain("image/png");
    // A blank or errored ImageResponse is still a PNG. A real card carries
    // rendered type on a paper ground and does not compress to a few hundred
    // bytes the way an empty canvas does.
    expect((await img.body()).byteLength).toBeGreaterThan(5_000);
  });

  test("a city landing page's card is live, and 404s when the page does", async ({ page }) => {
    const h = await head(page, "/jobs/in/lagos");
    expect(h.ogImage).toContain("/jobs/in/lagos/opengraph-image");
    expect(h.twCard).toBe("summary_large_image");
    const livePath = samePath(h.ogImage);
    expect((await page.request.get(livePath)).status()).toBe(200);

    /*
     * The gate that matters. A landing page below LANDING_PAGE_MIN_ENTRIES is
     * doorway spam and 404s; a share card for it would be that same thin page
     * with better packaging. The image route re-runs the live count itself
     * rather than trusting that the page already did — they are separate
     * requests, and a crawler can ask for either one.
     *
     * `kano` is deliberately NOT in CITY_LANDING_PAGES (see landing-pages.ts
     * for why the list is short and curated), so this is the no-such-city arm
     * of the same gate and needs no seeded row to hold.
     */
    const pageRes = await page.request.get("/jobs/in/kano");
    expect(pageRes.status(), "an unlisted city must 404").toBe(404);
    const imgRes = await page.request.get(livePath.replace("/lagos/", "/kano/"));
    expect(imgRes.status(), "the IMAGE route must 404 wherever the page does").toBe(404);
  });

  /*
   * NO MORE "home page keeps the generic title" negative control here — that
   * test asserted "/" deliberately had no title of its own, which was true
   * until it wasn't: the homepage now calls pageMetadata() like every other
   * real page (2026-09-18, closing the gap where it was the one major page
   * with no metadata export at all). "/" moved into the PAGES loop above
   * instead, which already proves the positive case this file exists to
   * check — its own title, its own og:title, its own og:image — the same
   * way every other real page is proven. Nothing here still needs a
   * generic-title negative control to stay meaningful.
   */
});
