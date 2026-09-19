/**
 * send-387 Part 2 — /how-auto-apply-works, a plain-prose explainer page for
 * Auto-Apply, closing an SEO gap for a real differentiator (CLAUDE.md:
 * "positioned as a trust/quality feature — not a spam-driving volume
 * feature") that had no public-facing content before this page.
 *
 * Deliberately no FAQPage structured data — same non-decision as
 * faq-section.tsx's own header comment (Google narrowed, then removed,
 * documentation for the FAQ rich result feature). This file asserts that
 * absence directly rather than trusting it stays that way.
 */
import { test, expect } from "@playwright/test";

test.describe("send-387: /how-auto-apply-works", () => {
  test("real 200, unique title/description, real H1 — not the generic site fallback", async ({ page }) => {
    const res = await page.goto("/how-auto-apply-works");
    expect(res?.status()).toBe(200);

    const title = await page.title();
    expect(title).toBe("How Auto-Apply Works — Talentrah");
    expect(title).not.toBe("Talentrah");

    const description = await page.locator('meta[name="description"]').first().getAttribute("content");
    expect(description).toBeTruthy();
    expect(description!.length).toBeGreaterThan(40);

    await expect(
      page.getByRole("heading", { level: 1, name: "It reviews matches for you. It never submits without your say-so." }),
    ).toBeVisible();
  });

  test("carries its own og:title/og:description, not the site-wide fallback", async ({ page }) => {
    await page.goto("/how-auto-apply-works");
    const read = (sel: string) => page.locator(sel).first().getAttribute("content");
    expect(await read('meta[property="og:title"]')).toBe("How Auto-Apply Works — Talentrah");
    expect(await read('meta[property="og:description"]')).toBeTruthy();
  });

  test("does NOT ship FAQPage structured data, even though the content reads as Q&A", async ({ page }) => {
    await page.goto("/how-auto-apply-works");
    const ldJsonBlocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    for (const block of ldJsonBlocks) {
      expect(block).not.toContain("FAQPage");
    }
    // Belt and suspenders: no ld+json script at all on this page, since it
    // carries no other structured-data need either.
    expect(await page.locator('script[type="application/ld+json"]').count()).toBe(0);
  });

  test("states the real product boundary: external matches are handed off, never marked applied", async ({
    page,
  }) => {
    await page.goto("/how-auto-apply-works");
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/hand(ed|s)? off|open(s|ing)? the original posting/i);
    expect(bodyText.toLowerCase()).toContain("never marked as applied");
    // Never claims a submission it doesn't make.
    expect(bodyText).not.toMatch(/automatically appl(y|ies) to (every|all) (external|job)/i);
  });

  test("does not claim the match score is fixed once a job is queued", async ({ page }) => {
    await page.goto("/how-auto-apply-works");
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.toLowerCase()).toMatch(/checked again (at|when)|re-?check/);
  });

  test("never promises a silent or automatic-without-confirmation mode", async ({ page }) => {
    await page.goto("/how-auto-apply-works");
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.toLowerCase()).toContain("no silent mode");
    expect(bodyText).not.toMatch(/applies (for|to) you (automatically|without (asking|confirming))/i);
  });

  test("appears in the generated sitemap", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/<loc>https?:\/\/[^<]*\/how-auto-apply-works<\/loc>/);
  });

  test("is linked from the marketing footer with a real href, not a dead anchor", async ({ page }) => {
    await page.goto("/");
    const link = page.getByRole("link", { name: "Auto-Apply" });
    await expect(link).toBeVisible();
    expect(await link.getAttribute("href")).toBe("/how-auto-apply-works");
  });

  test("links to signup, not to the gated /auto-apply queue a signed-out visitor can't use", async ({ page }) => {
    await page.goto("/how-auto-apply-works");
    const cta = page.getByRole("link", { name: "Create a free account" });
    await expect(cta).toBeVisible();
    expect(await cta.getAttribute("href")).toMatch(/^\/signup/);
  });
});

test.describe("send-387 regression: this page touches no Auto-Apply feature code", () => {
  test("the real, gated /auto-apply queue still requires a session", async ({ page }) => {
    await page.goto("/auto-apply");
    // Middleware redirects a signed-out visitor to /login before the page
    // itself ever runs.
    expect(page.url()).toContain("/login");
  });
});
