/**
 * send-480 — /scholarships used to redirect every signed-out visitor to /login (a
 * 307 from proxy.ts, before any page ran). It is now a real public landing page,
 * the same shape /mentorship took in send-385.
 *
 * THIS FILE IS SIGNED-OUT AND HTTP-ONLY on purpose: it imports nothing from
 * ./fixtures, so it needs no database and can be pointed at any deployment with
 * E2E_BASE_URL. Everything that needs seeded rows or a signed-in session is in
 * e2e/scholarships-public-landing-data.spec.ts.
 *
 * Every test here uses a browser context of its own (the `page` fixture is not
 * shared with any signed-in state) — see e2e/mentorship-public-landing.spec.ts for
 * why the distinction matters.
 */
import { test, expect, type Page } from "@playwright/test";

/** The common low-end Android widths this product's market actually uses. */
const PHONE_WIDTHS = [360, 390, 412];

/**
 * The route's streamed loading fallback ("Loading scholarships…") is in the DOM until the real page
 * replaces it, and `goto` resolves on `load`, which can come first. A one-shot read straight after
 * `goto` (innerText, title(), count()) can therefore see the skeleton, and a NEGATIVE assertion
 * ("there is no X") passes vacuously on it. Everything below that reads the page waits for this
 * first: the skeleton is gone AND the page's own <h1> (the skeleton has none) is there.
 */
async function pageSettled(page: Page) {
  await expect(page.getByText("Loading scholarships…")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test.describe("signed-out visitor at /scholarships", () => {
  test("gets a real 200 — not the 307 to /login this route always used to send", async ({ request }) => {
    const res = await request.get("/scholarships", { maxRedirects: 0 });
    expect(res.status(), "a signed-out request to /scholarships must not redirect").toBe(200);
  });

  test("has its own title and meta description, never the login page's", async ({ page }) => {
    const response = await page.goto("/scholarships");
    expect(response?.status()).toBe(200);
    expect(page.url()).not.toContain("/login");
    await pageSettled(page);

    // Auto-retrying: head metadata can stream in after the shell, so no one-shot title() read.
    await expect(page).toHaveTitle(/Scholarships/);
    await expect(page).not.toHaveTitle("Log in — Talentrah");
    await expect(page, "the signed-in page's plain title must not be what a visitor gets").not.toHaveTitle(
      "Scholarships — Talentrah",
    );

    const descriptionTag = page.locator('meta[name="description"]').first();
    await expect(descriptionTag).toHaveAttribute("content", /\S/);
    const description = await descriptionTag.getAttribute("content");
    expect(description!.length, "meta description must fit a search result").toBeLessThanOrEqual(160);

    // A <head> fixed while the body still bounced client-side would pass the title checks alone.
    await expect(page.getByRole("heading", { name: /log in/i })).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test("has exactly ONE <h1> in the RAW response, not just in the rendered DOM", async ({ request }) => {
    /*
     * A streamed loading.tsx fallback lands in the raw HTML alongside the page. If the
     * placeholder carries its own <h1> (as /mentorship's still does), the response a
     * crawler reads has two. The DOM after hydration hides that, so this reads the
     * bytes: request.get never executes any script.
     */
    const res = await request.get("/scholarships", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html.match(/<h1[\s>]/g)?.length ?? 0, "expected exactly one <h1> in the raw HTML").toBe(1);
  });

  test("every query-string variant serves the same landing (200, one <h1>, canonical without the query)", async ({ request }) => {
    /*
     * With the /scholarships$ disallow gone, /scholarships?level=phd (and every other filter URL) is
     * crawlable and serves this same page to a signed-out visitor. It must not error, must not show a
     * second <h1>, and must name the bare path as its canonical so the variants collapse into one URL.
     */
    for (const qs of ["?level=phd", "?tab=saved&page=2", "?q=chevening&within=30&funding=full", "?anything=at-all", "?level=%ZZ&page=-1"]) {
      const res = await request.get(`/scholarships${qs}`, { maxRedirects: 0 });
      expect(res.status(), `/scholarships${qs}`).toBe(200);
      const html = await res.text();
      expect(html.match(/<h1[\s>]/g)?.length ?? 0, `/scholarships${qs}: expected exactly one <h1>`).toBe(1);
      expect(html, `/scholarships${qs}: canonical`).toMatch(/<link rel="canonical" href="https?:\/\/[^"?]*\/scholarships"\s*\/?>/);
    }
  });

  test("renders the approved <h1>, one <main> landmark and one footer", async ({ page }) => {
    await page.goto("/scholarships");
    await pageSettled(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Scholarships open to applicants from Nigeria and across Africa — deadline confirmed at the source, or not shown at all.",
    );
    // The shell's signed-out branch supplies <main id="main-content"> and the footer
    // (send-432); the landing page must add neither a second main nor a second footer.
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("footer")).toHaveCount(1);
    // Nothing that only makes sense for a signed-in user.
    await expect(page.getByText(/Saved & tracking/)).toHaveCount(0);
  });

  test("offers a real path to create an account, scoped to what is actually free", async ({ page }) => {
    await page.goto("/scholarships");
    await pageSettled(page);
    await expect(page.getByRole("link", { name: "Create a free account" }).first()).toBeVisible();
    await expect(page.locator('a[href="/signup?redirectTo=%2Fscholarships"]').first()).toBeVisible();
    await expect(page.getByRole("main").locator('a[href="/login?redirectTo=%2Fscholarships"]').first()).toBeVisible();
    // The masthead's Log in carries the same destination now (S1-50).
    await expect(page.getByRole("banner").getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login?redirectTo=%2Fscholarships");
    await expect(page.locator('a[href="/scholarships/apply-now"]').first()).toBeVisible();
    // Auto-retrying text assertions on the settled page, not an innerText snapshot.
    await expect(page.locator("body")).toContainText("Reading every listing is free and needs no account.");
    await expect(page.locator("body")).not.toContainText(/\bsign(ing)? up\b/i);
  });

  for (const width of PHONE_WIDTHS) {
    test(`at ${width}px nothing makes the page scroll sideways`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage();
      await page.goto("/scholarships");
      await pageSettled(page);
      const geometry = await page.evaluate(() => ({
        clientW: document.documentElement.clientWidth,
        scrollW: document.documentElement.scrollWidth,
      }));
      expect(geometry.scrollW, "something on the page is wider than the viewport").toBeLessThanOrEqual(geometry.clientW);
      await context.close();
    });
  }
});

test.describe("the links that used to lead a signed-out visitor to /login now lead here", () => {
  test("the homepage 'Find a scholarship' shortcut lands on the landing page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Find a scholarship" }).click();
    await page.waitForURL("**/scholarships");
    expect(page.url()).not.toContain("/login");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Scholarships open to applicants");
  });

  test("the footer's Scholarships link lands on the landing page", async ({ page }) => {
    await page.goto("/about");
    await page.locator("footer").getByRole("link", { name: "Scholarships" }).click();
    await page.waitForURL("**/scholarships");
    expect(page.url()).not.toContain("/login");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Scholarships open to applicants");
  });
});

test.describe("everything else under /scholarships is unaffected", () => {
  for (const path of ["/scholarships/apply-now", "/scholarships/fully-funded", "/scholarships/degree/msc"]) {
    test(`${path} still returns 200 signed out`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(200);
    });
  }

  test("a nonexistent scholarship still 404s, not redirects", async ({ request }) => {
    const res = await request.get("/scholarships/00000000-0000-0000-0000-000000000000", { maxRedirects: 0 });
    expect(res.status()).toBe(404);
  });

  test("other app routes still require a session", async ({ request }) => {
    // send-484: /jobs and /tracker are public landing pages now, so they are controls no longer.
    for (const path of ["/refer/anything", "/settings", "/billing"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), `${path} must still redirect a signed-out visitor`).toBe(307);
      expect(res.headers()["location"]).toContain("/login");
    }
  });
});

test.describe("the Terms section the landing page links to", () => {
  test("/legal/terms has a #scholarship-listings anchor, and the landing page links to it", async ({ page }) => {
    await page.goto("/legal/terms");
    await expect(page.locator("h2#scholarship-listings")).toHaveText("Scholarship listings");
    await page.goto("/scholarships");
    await expect(page.locator('a[href="/legal/terms#scholarship-listings"]')).toBeVisible();
  });
});

test.describe("/scholarships in the generated sitemap and robots.txt", () => {
  test("appears in sitemap.xml as its own entry", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    expect(await res.text()).toMatch(/<loc>https?:\/\/[^<]*\/scholarships<\/loc>/);
  });

  test("robots.txt no longer disallows /scholarships, and still disallows everything under /refer/ (the bare /refer is public now)", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body, "control: everything under /refer/ must stay disallowed").toMatch(/Disallow: \/refer\/\s*$/m);
    expect(body, "the bare /refer is a public page").not.toMatch(/Disallow: \/refer\s*$/m);
    expect(body).not.toMatch(/Disallow: \/scholarships\$/);
    expect(body).not.toMatch(/Disallow: \/scholarships\s*$/m);
  });
});
