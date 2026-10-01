/**
 * send-491 — the last five signed-out links that led to /login, re-pointed (the production crawl,
 * `npm run check-signed-out-links`, listed exactly these):
 *
 *   1. the footer's "Resume Builder"            /resume-builder  ->  /ai-resume-builder
 *   2. the hero demo's "Build a resume"         /resume-builder  ->  session-aware: signed in /resume-builder,
 *                                                                    signed out /signup?redirectTo=%2Fresume-builder
 *   3-4. the blog's ATS-template and two Tailor links             ->  /ai-resume-builder, /ai-resume-tailoring
 *   5. the blog's cover-letter link   /tailor?coverLetter=1      ->  /signup?redirectTo=%2Ftailor%3FcoverLetter%3D1
 *
 * THIS FILE IS SIGNED OUT AND DATABASE-FREE (it imports nothing from ./fixtures), so it can be pointed at any
 * deployment with E2E_BASE_URL. The signed-in half (the hero link once the session resolves, the signed-in-only
 * "Build or upload your resume" link, and the cover-letter forward) is in e2e/signed-in-link-repoints.spec.ts.
 *
 * The blog posts themselves are not seeded in CI's database, so rows 3-5 are checked here from the SAME map the
 * blog page renders (`relatedLinksForPost`), and on the live pages after deploy. Row 5's round trip is the part
 * only a browser can show: the encoded query string must survive the signup page's hidden `redirectTo` field.
 */
import { test, expect } from "@playwright/test";
import { relatedLinksForPost } from "../src/lib/blog/related-links";

const COVER_LETTER_SLUG = "cover-letters-that-dont-sound-like-a-template";
const COVER_LETTER_HREF = "/signup?redirectTo=%2Ftailor%3FcoverLetter%3D1";
const COVER_LETTER_LOGIN_HREF = "/login?redirectTo=%2Ftailor%3FcoverLetter%3D1";

test.describe("row 1: the footer's Resume Builder link", () => {
  test("goes to the public /ai-resume-builder landing page, and that page is public", async ({ page }) => {
    await page.goto("/about");
    const link = page.locator("footer").getByRole("link", { name: "Resume Builder", exact: true });
    await expect(link).toHaveAttribute("href", "/ai-resume-builder");
    await link.click();
    await page.waitForURL("**/ai-resume-builder");
    expect(page.url(), "a signed-out visitor was sent to /login").not.toContain("/login");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("row 2: the hero demo's 'Build a resume' link is session-aware", () => {
  test("signed out: it goes through signup and returns to the builder; the siblings are unchanged", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Build a resume", exact: true })).toHaveAttribute(
      "href",
      "/signup?redirectTo=%2Fresume-builder",
    );
    await expect(page.getByRole("link", { name: "Tailor my resume to a job", exact: true })).toHaveAttribute("href", "/signup");
    await expect(page.getByRole("link", { name: "Check my match score", exact: true })).toHaveAttribute("href", "/signup");
    await expect(page.getByRole("link", { name: "Find a scholarship", exact: true })).toHaveAttribute("href", "/scholarships");
    await expect(page.getByRole("link", { name: "Browse jobs instead →" })).toHaveAttribute("href", "/jobs");
  });

  test("signed out: following it lands on the signup page carrying the redirect to the builder", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Build a resume", exact: true }).click();
    await page.waitForURL("**/signup**");
    expect(page.url()).not.toContain("/login");
    await expect(page.locator('input[name="redirectTo"]')).toHaveValue("/resume-builder");
  });

});

test.describe("rows 3-5: the blog's links, from the map the blog page renders", () => {
  test("none of the re-pointed blog links leads a signed-out reader to /login", async ({ request }) => {
    const wanted: Array<[string, string, string]> = [
      ["beating-the-ats", "Build a resume from an ATS-safe template", "/ai-resume-builder"],
      ["beating-the-ats", "Tailor your resume with Farah", "/ai-resume-tailoring"],
      ["reading-your-match-score", "Tailor your resume to a specific job", "/ai-resume-tailoring"],
      [COVER_LETTER_SLUG, "Write your cover letter with Farah", COVER_LETTER_HREF],
    ];
    for (const [slug, label, href] of wanted) {
      const link = relatedLinksForPost(slug).find((l) => l.label === label);
      expect(link, `${slug}: "${label}" is gone`).toBeDefined();
      expect(link!.href, `${slug}: "${label}"`).toBe(href);
      const res = await request.get(link!.href, { maxRedirects: 0 });
      expect(res.status(), `${slug}: ${link!.href} must answer a signed-out reader with a page, not a redirect`).toBe(200);
    }
  });
});

test.describe("row 5: the cover-letter link's encoded redirect survives the signup round trip", () => {
  test("signed out: the signup page's hidden redirectTo is /tailor?coverLetter=1, and its login link carries it too", async ({
    page,
  }) => {
    const link = relatedLinksForPost(COVER_LETTER_SLUG).find((l) => l.label === "Write your cover letter with Farah");
    expect(link?.href).toBe(COVER_LETTER_HREF);
    await page.goto(link!.href);
    expect(page.url(), "the link must land on the signup page").toContain("/signup");
    // Decoded exactly once: the query string inside the destination is intact.
    await expect(page.locator('input[name="redirectTo"]')).toHaveValue("/tailor?coverLetter=1");
    // The masthead's own "Log in" link is plain; the one in the page body carries the redirect.
    await expect(page.locator(`a[href="${COVER_LETTER_LOGIN_HREF}"]`)).toHaveCount(1);
  });

});
