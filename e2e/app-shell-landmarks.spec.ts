/**
 * The signed-in app shell (src/components/app-shell/app-shell.tsx +
 * masthead.tsx) had the identical no-landmark-region gap the marketing site
 * had before send-381's own fix (e2e/wcag-2026-audit.spec.ts) — that fix's
 * own stated scope was "the public marketing site and the login page" only,
 * and explicitly did not cover this file. Confirmed at the time: zero
 * <header>/<main>/<footer> anywhere in src/components/app-shell/*.tsx.
 *
 * app-shell.tsx has TWO branches — signed-in (Masthead + Farah panel) and
 * signed-out (MarketingMasthead, used only by the public, existence-gated
 * routes under (app): jobs/[id], scholarships/[id],
 * scholarships/degree/[level] — see that file's own comment). Both needed
 * their own <main id="main-content">. The signed-out branch's masthead
 * (MarketingMasthead) already gets its own <header> + skip link from
 * send-381's marketing-site fix independently — that is a SEPARATE
 * component this file doesn't touch, so the signed-out test below only
 * asserts the <main> half of the fix, not header count, to avoid coupling
 * this PR's pass/fail to whichever of the two merges first.
 */
import { test, expect, admin } from "./fixtures/authed";
import type { Page } from "@playwright/test";

async function landmarks(page: Page) {
  return page.evaluate(() => ({
    main: document.querySelectorAll("main").length,
    header: document.querySelectorAll("header").length,
    footer: document.querySelectorAll("footer").length,
    skipLink: !!document.querySelector('a[href="#main-content"]'),
    mainHasId: !!document.getElementById("main-content"),
  }));
}

test.describe("signed-in app shell — header/main landmarks", () => {
  test(
    "the jobs feed has exactly one header, one main, no footer, and a working skip link",
    async ({ authedPage }) => {
      await authedPage.goto("/jobs");
      const found = await landmarks(authedPage);
      expect(found).toEqual({
        main: 1,
        header: 1,
        footer: 0,
        skipLink: true,
        mainHasId: true,
      });
    },
  );

  test("the skip link actually moves focus target to #main-content, not just decoration", async ({ authedPage }) => {
    await authedPage.goto("/jobs");
    await authedPage.keyboard.press("Tab");
    await expect(authedPage.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    await authedPage.getByRole("link", { name: "Skip to main content" }).click();
    expect(authedPage.url()).toContain("#main-content");
  });

  test("a second signed-in page (/tracker) reusing the same shell also has the fix", async ({ authedPage }) => {
    await authedPage.goto("/tracker");
    const found = await landmarks(authedPage);
    expect(found).toMatchObject({ main: 1, header: 1, footer: 0, mainHasId: true });
  });
});

test.describe("signed-out app shell branch (public job detail page) — main landmark", () => {
  let JOB: string;

  test.beforeAll(async () => {
    /*
     * `.limit(1)` rather than `.single()`, deliberately different from
     * public-job-page.spec.ts's own version of this lookup: a fresh
     * per-job CI database seeds this row exactly once, but a shared local
     * dev database re-seeded across sessions can carry more than one row
     * with this exact company/title pair, which `.single()` treats as an
     * error rather than picking one. Any one of them exercises the same
     * shell code path this test is actually about.
     */
    const { data, error } = await admin
      .from("job_postings")
      .select("id")
      .eq("company_name", "Zaria Digital")
      .eq("title", "Backend Engineer (Node.js)")
      .limit(1);
    if (error || !data?.length) {
      throw new Error(
        `seeded "Backend Engineer (Node.js)" posting not found — run \`npm run seed\`: ${error?.message ?? "no row"}`,
      );
    }
    JOB = data[0].id;
  });

  test("the public job detail page renders exactly one <main id=\"main-content\">", async ({ page }) => {
    const res = await page.goto(`/jobs/${JOB}`);
    expect(res?.status(), "signed-out request must not redirect").toBe(200);
    const found = await page.evaluate(() => ({
      main: document.querySelectorAll("main").length,
      mainHasId: !!document.getElementById("main-content"),
    }));
    expect(found).toEqual({ main: 1, mainHasId: true });
  });
});
