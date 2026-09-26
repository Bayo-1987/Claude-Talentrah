/**
 * send-461 — two new standalone SEO comparison/alternative pages
 * (/vs/jobright, /vs/jobcopilot). Same test shape as
 * resume-ats-landing-pages.spec.ts (send-386) — extending the existing
 * marketing-landing-page pattern rather than inventing new test
 * infrastructure, per this send's own "keep it light" instruction.
 */
import { test, expect } from "@playwright/test";

const PAGES = [
  {
    path: "/vs/jobright",
    titleContains: "Jobright Alternative",
    h1: "Jobright doesn't work outside the US. Here's what does.",
    otherPageLinkText: "how Talentrah compares to JobCopilot →",
  },
  {
    path: "/vs/jobcopilot",
    titleContains: "Talentrah vs. JobCopilot",
    h1: "Two AI job copilots built for Africa. Here's how they differ.",
    otherPageLinkText: "how Talentrah compares to Jobright →",
  },
];

test.describe("send-461: /vs/jobright and /vs/jobcopilot", () => {
  for (const p of PAGES) {
    test(`${p.path} has a real, unique title/description/H1 — not the generic site fallback`, async ({ page }) => {
      const response = await page.goto(p.path);
      expect(response?.status()).toBe(200);

      const title = await page.title();
      expect(title).toContain(p.titleContains);
      expect(title).not.toBe("Talentrah");
      expect(title).not.toBe("AI Job Search Copilot — Talentrah"); // the homepage's own title

      const description = await page.locator('meta[name="description"]').first().getAttribute("content");
      expect(description).toBeTruthy();
      expect(description!.length).toBeGreaterThan(40);

      await expect(page.getByRole("heading", { level: 1, name: p.h1 })).toBeVisible();
    });

    test(`${p.path} carries real og:title/og:description of its own, not the site-wide fallback`, async ({
      page,
    }) => {
      await page.goto(p.path);
      const read = (sel: string) => page.locator(sel).first().getAttribute("content");
      const ogTitle = await read('meta[property="og:title"]');
      const ogDescription = await read('meta[property="og:description"]');
      expect(ogTitle).toContain(p.titleContains);
      expect(ogDescription).toBeTruthy();
    });

    test(`${p.path} cross-links to the sibling comparison page, not a dead anchor`, async ({ page }) => {
      await page.goto(p.path);
      const link = page.getByRole("link", { name: p.otherPageLinkText });
      await expect(link).toBeVisible();
      const href = await link.getAttribute("href");
      expect(href).not.toBe("#");
      expect(href).toMatch(/^\/vs\/(jobright|jobcopilot)$/);
    });

    test(`${p.path} has a real "Create a free account" CTA, not a dead anchor`, async ({ page }) => {
      await page.goto(p.path);
      const links = page.getByRole("link", { name: "Create a free account" });
      expect(await links.count()).toBeGreaterThan(0);
      const href = await links.first().getAttribute("href");
      expect(href).toMatch(/^\/signup/);
    });
  }

  test("the two pages' own titles and H1s are genuinely distinct from each other, not copy-pasted", async ({
    page,
  }) => {
    await page.goto("/vs/jobright");
    const titleA = await page.title();
    const h1A = await page.locator("h1").first().innerText();

    await page.goto("/vs/jobcopilot");
    const titleB = await page.title();
    const h1B = await page.locator("h1").first().innerText();

    expect(titleA).not.toBe(titleB);
    expect(h1A).not.toBe(h1B);
  });

  test("appear in the generated sitemap", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/<loc>https?:\/\/[^<]*\/vs\/jobright<\/loc>/);
    expect(body).toMatch(/<loc>https?:\/\/[^<]*\/vs\/jobcopilot<\/loc>/);
  });

  test("do not collide with any existing sitemap route", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    const body = await res.text();
    for (const path of ["/vs/jobright", "/vs/jobcopilot"]) {
      const occurrences = body.split(`<loc>https://www.talentrah.com${path}</loc>`).length - 1;
      expect(occurrences, `${path} should appear exactly once in the sitemap`).toBe(1);
    }
  });

  test("are not blocked in robots.txt", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).not.toMatch(/Disallow:\s*\/vs\b/);
  });

  test("are linked from the marketing footer's Compare column with a real href, not a dead anchor", async ({
    page,
  }) => {
    await page.goto("/");
    const jobrightLink = page.getByRole("link", { name: "Jobright Alternative" });
    const jobcopilotLink = page.getByRole("link", { name: "vs. JobCopilot" });
    await expect(jobrightLink).toBeVisible();
    await expect(jobcopilotLink).toBeVisible();
    expect(await jobrightLink.getAttribute("href")).toBe("/vs/jobright");
    expect(await jobcopilotLink.getAttribute("href")).toBe("/vs/jobcopilot");
  });

  test("no competitor comparison claim is presented as Talentrah's own published pricing", async ({ page }) => {
    // Jobright's reported pricing must read as reported/third-party, never
    // as a bare, unqualified number that looks like Talentrah's own catalog.
    await page.goto("/vs/jobright");
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/[Rr]eported/);
  });
});

test.describe("send-461 regression: the homepage's own embedded demo and metadata are unchanged", () => {
  test("homepage still has its own title and the JD-paste demo textarea", async ({ page }) => {
    await page.goto("/");
    expect(await page.title()).toBe("AI Job Search Copilot — Talentrah");
    await expect(page.locator("#jd-demo")).toBeVisible();
  });
});
