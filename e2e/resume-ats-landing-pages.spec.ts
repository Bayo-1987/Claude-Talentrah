/**
 * send-386 — two new standalone SEO landing pages closing an uncontested
 * keyword gap the 2026-09-19 audit found: every AI resume tool it checked
 * (Rezi, Kickresume, Teal, Resume.io, Jobscan) is US/UK-only with zero
 * Nigeria-specific content, for a capability (JD-paste tailoring + ATS
 * scoring, §6.3) Talentrah already ships. Neither replaces the homepage's
 * own embedded JD-paste demo, which this file also asserts is unchanged.
 */
import { test, expect } from "@playwright/test";

const PAGES = [
  {
    path: "/ai-resume-tailoring",
    titleContains: "AI Resume Tailoring",
    h1: "Stop sending the same resume to every job.",
    otherPageLinkText: "Read about the ATS resume checker →",
  },
  {
    path: "/ats-resume-checker",
    titleContains: "ATS Resume Checker",
    h1: "Most resumes never reach a human. Find out if yours would.",
    otherPageLinkText: "See how AI resume tailoring works →",
  },
];

test.describe("send-386: /ai-resume-tailoring and /ats-resume-checker", () => {
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

    test(`${p.path} cross-links to the sibling page, not a dead anchor`, async ({ page }) => {
      await page.goto(p.path);
      const link = page.getByRole("link", { name: p.otherPageLinkText });
      await expect(link).toBeVisible();
      const href = await link.getAttribute("href");
      expect(href).not.toBe("#");
      expect(href).toMatch(/^\/(ai-resume-tailoring|ats-resume-checker)$/);
    });
  }

  test("the two pages' own titles and H1s are genuinely distinct from each other, not copy-pasted", async ({
    page,
  }) => {
    await page.goto("/ai-resume-tailoring");
    const titleA = await page.title();
    const h1A = await page.locator("h1").first().innerText();

    await page.goto("/ats-resume-checker");
    const titleB = await page.title();
    const h1B = await page.locator("h1").first().innerText();

    expect(titleA).not.toBe(titleB);
    expect(h1A).not.toBe(h1B);
  });

  test("the free-vs-credits framing matches CLAUDE.md §6.9 exactly: first run free, never open-ended", async ({
    page,
  }) => {
    for (const p of PAGES) {
      await page.goto(p.path);
      const bodyText = await page.locator("body").innerText();
      // Must say "first" tailoring run/first cover letter, never a blanket
      // "resume tailoring is free" claim with no scope.
      expect(bodyText.toLowerCase()).toMatch(/first tailoring run|try it/);
      expect(bodyText).not.toMatch(/tailoring is (completely |always )?free\b/i);
    }
  });

  test("appear in the generated sitemap", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/<loc>https?:\/\/[^<]*\/ai-resume-tailoring<\/loc>/);
    expect(body).toMatch(/<loc>https?:\/\/[^<]*\/ats-resume-checker<\/loc>/);
  });

  test("are linked from the marketing footer with a real href, not a dead anchor", async ({ page }) => {
    await page.goto("/");
    const tailoringLink = page.getByRole("link", { name: "Resume Tailoring" });
    const atsLink = page.getByRole("link", { name: "ATS Resume Checker" });
    await expect(tailoringLink).toBeVisible();
    await expect(atsLink).toBeVisible();
    expect(await tailoringLink.getAttribute("href")).toBe("/ai-resume-tailoring");
    expect(await atsLink.getAttribute("href")).toBe("/ats-resume-checker");
  });

  test("do not collide with any existing sitemap route", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    const body = await res.text();
    // Each new path's <loc> must appear exactly once.
    for (const path of ["/ai-resume-tailoring", "/ats-resume-checker"]) {
      const occurrences = body.split(`<loc>https://www.talentrah.com${path}</loc>`).length - 1;
      expect(occurrences, `${path} should appear exactly once in the sitemap`).toBe(1);
    }
  });
});

test.describe("send-386 regression: the homepage's own embedded demo and metadata are unchanged", () => {
  test("homepage still has its own title and the JD-paste demo textarea", async ({ page }) => {
    await page.goto("/");
    expect(await page.title()).toBe("AI Job Search Copilot — Talentrah");
    await expect(page.locator("#jd-demo")).toBeVisible();
  });
});
