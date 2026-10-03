/**
 * send-484 — /jobs and /tracker used to redirect every signed-out visitor to /login (a 307 from
 * proxy.ts, before any page ran). Each is now a real public landing page, the shape /scholarships took
 * in send-480 (see e2e/scholarships-public-landing.spec.ts, which this mirrors).
 *
 * THIS FILE IS SIGNED-OUT AND HTTP-ONLY on purpose: it imports nothing from ./fixtures, so it needs no
 * database and can be pointed at any deployment with E2E_BASE_URL. Everything that needs seeded rows or
 * a signed-in session is in e2e/jobs-tracker-public-landing-data.spec.ts.
 */
import { test, expect, type Page } from "@playwright/test";

/** The common low-end Android widths this product's market actually uses. */
const PHONE_WIDTHS = [360, 390, 412];

const PAGES = [
  { path: "/jobs", loading: "Loading jobs…", signedInTitle: "Jobs — Talentrah", titleHas: /Jobs/ },
  { path: "/tracker", loading: "Loading the job tracker…", signedInTitle: "Job Tracker — Talentrah", titleHas: /Job Tracker/ },
] as const;

/**
 * The route's streamed loading fallback is in the DOM until the real page replaces it, and `goto`
 * resolves on `load`, which can come first. A one-shot read straight after `goto` can therefore see the
 * skeleton, and a NEGATIVE assertion passes vacuously on it. Everything that reads the page waits for
 * this first: the skeleton is gone AND the page's own <h1> (the skeleton has none) is there.
 */
async function pageSettled(page: Page, loading: string) {
  await expect(page.getByText(loading)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

for (const { path, loading, signedInTitle, titleHas } of PAGES) {
  test.describe(`signed-out visitor at ${path}`, () => {
    test("gets a real 200 — not the 307 to /login this route always used to send", async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), `a signed-out request to ${path} must not redirect`).toBe(200);
    });

    test("has its own title and meta description, never the login page's or the signed-in page's", async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      expect(page.url()).not.toContain("/login");
      await pageSettled(page, loading);

      await expect(page).toHaveTitle(titleHas);
      await expect(page).not.toHaveTitle("Log in — Talentrah");
      await expect(page, "the signed-in page's plain title must not be what a visitor gets").not.toHaveTitle(signedInTitle);
      await expect(page).not.toHaveTitle(/nigeria/i);

      const descriptionTag = page.locator('meta[name="description"]').first();
      await expect(descriptionTag).toHaveAttribute("content", /\S/);
      const description = await descriptionTag.getAttribute("content");
      expect(description!.length, "meta description must fit a search result").toBeLessThanOrEqual(160);
      expect(description, "the audience is global: no 'Nigeria' in the description").not.toMatch(/nigeria/i);

      await expect(page.getByRole("heading", { name: /log in/i })).toHaveCount(0);
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
    });

    test("has exactly ONE <h1> in the RAW response, not just in the rendered DOM", async ({ request }) => {
      // A streamed loading.tsx fallback lands in the raw HTML alongside the page; a placeholder <h1>
      // would make two. request.get never executes any script, so this reads the bytes a crawler reads.
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(200);
      const html = await res.text();
      expect(html.match(/<h1[\s>]/g)?.length ?? 0, "expected exactly one <h1> in the raw HTML").toBe(1);
    });

    test("every query-string variant serves the same landing (200, one <h1>, canonical without the query)", async ({ request }) => {
      // With the disallow gone, /jobs?tab=saved&q=… and /tracker?stage=offer&sort=oldest are crawlable
      // and serve this same page to a signed-out visitor. They must not error, must not show a second
      // <h1>, and must name the bare path as canonical so the variants collapse into one URL.
      const variants =
        path === "/jobs"
          ? ["?tab=saved", "?q=engineer&workType=remote&page=2", "?country=Nigeria&posted=week", "?anything=at-all", "?page=-1&q=%ZZ"]
          : ["?stage=offer", "?stage=hired&sort=oldest", "?justHired=not-an-id", "?anything=at-all", "?stage=%ZZ"];
      for (const qs of variants) {
        const res = await request.get(`${path}${qs}`, { maxRedirects: 0 });
        expect(res.status(), `${path}${qs}`).toBe(200);
        const html = await res.text();
        expect(html.match(/<h1[\s>]/g)?.length ?? 0, `${path}${qs}: expected exactly one <h1>`).toBe(1);
        expect(html, `${path}${qs}: canonical`).toMatch(
          new RegExp(`<link rel="canonical" href="https?:\\/\\/[^"?]*${path}"\\s*\\/?>`),
        );
      }
    });

    test("renders one <h1>, one <main> landmark and one footer, and nothing that only a signed-in user has", async ({ page }) => {
      await page.goto(path);
      await pageSettled(page, loading);
      await expect(page.locator("main")).toHaveCount(1);
      await expect(page.locator("footer")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.getByText("Today's board")).toHaveCount(0);
      await expect(page.getByText("Every job, one place")).toHaveCount(0);
    });

    test("offers a real path to create an account, scoped to what is actually free", async ({ page }) => {
      await page.goto(path);
      await pageSettled(page, loading);
      await expect(page.getByRole("link", { name: "Create a free account" }).first()).toBeVisible();
      const redirectTo = encodeURIComponent(path);
      await expect(page.locator(`a[href="/signup?redirectTo=${redirectTo}"]`).first()).toBeVisible();
      await expect(page.locator(`a[href="/login?redirectTo=${redirectTo}"]`)).toBeVisible();
      await expect(page.locator("body")).not.toContainText(/\bsign(ing)? ?up\b/i);
    });

    for (const width of PHONE_WIDTHS) {
      test(`at ${width}px nothing makes the page scroll sideways`, async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width, height: 844 } });
        const page = await context.newPage();
        await page.goto(path);
        await pageSettled(page, loading);
        const geometry = await page.evaluate(() => ({
          clientW: document.documentElement.clientWidth,
          scrollW: document.documentElement.scrollWidth,
        }));
        expect(geometry.scrollW, "something on the page is wider than the viewport").toBeLessThanOrEqual(geometry.clientW);
        await context.close();
      });
    }
  });
}

/**
 * NOT CACHED, and proved from the response, not from the source. Each of these pages answers a signed-out
 * request from a live query, and a CDN or the framework serving a stored copy would put yesterday's
 * counts in front of today's visitor. The two headers that say so:
 *  - no `x-nextjs-prerender`: a prerendered (static) page carries it, a dynamically rendered one does not;
 *  - `cache-control` includes `no-store`: measured on this stack, dynamic pages send
 *    `private, no-cache, no-store, max-age=0, must-revalidate`, prerendered ones `public, max-age=0, must-revalidate`.
 * /scholarships is included: it shipped in send-480 under the same rule and was never checked this way.
 */
test.describe("the signed-out landing pages are dynamically rendered and never stored", () => {
  for (const path of ["/jobs", "/tracker", "/scholarships"]) {
    test(`${path} is not prerendered and is sent no-store`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(200);
      const headers = res.headers();
      expect(headers["x-nextjs-prerender"], `${path} was prerendered`).toBeUndefined();
      expect(headers["cache-control"] ?? "", `${path} cache-control`).toContain("no-store");
    });
  }

  test("the check can fail: a genuinely static page IS prerendered and is NOT no-store", async ({ request }) => {
    // Control. /legal/privacy is hand-authored with no cookies or headers read, so it is prerendered at
    // build time. If it carried no `x-nextjs-prerender`, or sent no-store, the three tests above could
    // not tell a static page from a dynamic one and would prove nothing.
    const res = await request.get("/legal/privacy", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    const headers = res.headers();
    expect(headers["x-nextjs-prerender"], "control: a static page should carry the prerender header").toBeDefined();
    expect(headers["cache-control"] ?? "", "control: a static page should not be no-store").not.toContain("no-store");
  });
});

test.describe("the links that used to lead a signed-out visitor to /login now lead somewhere real", () => {
  test("the footer's Job Matching and Job Tracker links land on the landing pages", async ({ page }) => {
    for (const [label, path, h1] of [
      ["Job Matching", "/jobs", /jobs/i],
      ["Job Tracker", "/tracker", /every application/i],
    ] as const) {
      await page.goto("/about");
      await page.locator("footer").getByRole("link", { name: label }).click();
      await page.waitForURL(`**${path}`);
      expect(page.url()).not.toContain("/login");
      await expect(page.getByRole("heading", { level: 1 })).toContainText(h1);
    }
  });

  // Refer & Earn (send-515): /refer is a public landing page now, so the footer link goes straight to it (send-484 sent it through signup
  // while /refer was login-gated).
  test("the footer's Refer & Earn link lands on the public /refer page, not on login or signup", async ({ page }) => {
    await page.goto("/about");
    await page.locator("footer").getByRole("link", { name: "Refer & Earn" }).click();
    await page.waitForURL("**/refer");
    expect(page.url()).not.toContain("/login");
    expect(page.url()).not.toContain("/signup");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });
});

test.describe("everything else that needs a session still does", () => {
  test("other app routes, and everything under /tracker, still redirect a signed-out visitor", async ({ request }) => {
    for (const path of ["/refer/anything", "/settings", "/billing", "/tracker/00000000-0000-0000-0000-000000000000/sent"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), `${path} must still redirect a signed-out visitor`).toBe(307);
      expect(res.headers()["location"]).toContain("/login");
    }
  });

  test("a job detail page for an id that does not exist is still a real 404, not a redirect", async ({ request }) => {
    const res = await request.get("/jobs/00000000-0000-0000-0000-000000000000", { maxRedirects: 0 });
    expect(res.status()).toBe(404);
  });
});

test.describe("/jobs and /tracker in the generated sitemap and robots.txt", () => {
  test("both appear in sitemap.xml as their own entries", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/<loc>https?:\/\/[^<]*\/jobs<\/loc>/);
    expect(body).toMatch(/<loc>https?:\/\/[^<]*\/tracker<\/loc>/);
  });

  test("robots.txt no longer disallows the bare /jobs or /tracker, still disallows everything under /tracker and under /refer/ (the bare /refer is public now)", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body, "control: everything under /refer/ must stay disallowed").toMatch(/Disallow: \/refer\/\s*$/m);
    expect(body, "the bare /refer is a public page").not.toMatch(/Disallow: \/refer\s*$/m);
    expect(body).toMatch(/Disallow: \/tracker\/\s*$/m);
    expect(body).not.toMatch(/Disallow: \/tracker\s*$/m);
    expect(body).not.toMatch(/Disallow: \/jobs\$/);
    expect(body).not.toMatch(/Disallow: \/jobs\s*$/m);
  });
});
