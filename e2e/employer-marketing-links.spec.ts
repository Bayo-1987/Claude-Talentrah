import { test, expect } from "@playwright/test";

/**
 * Regression coverage for send-303/send-304: the About page's "For employers
 * too" section and the footer's "Hire through Talentrah" link both used to
 * point at /contact and describe self-serve job posting as "in development"
 * — false, since /employer is a real, live, free self-serve flow. Both were
 * fixed to link to /employer.
 *
 * UPDATED for send-350: /employer used to redirect a signed-out visitor to
 * /login?redirectTo=%2Femployer (getEmployerContext() called requireUser()
 * internally, and the seeker-app gate in proxy.ts blocked the bare path
 * too). /employer is now a real public marketing page — see
 * components/employer/employer-public-landing.tsx and proxy.ts's
 * PROTECTED_SUBPATH_ONLY_PREFIXES — so a signed-out visitor clicking either
 * link now lands directly on it, no login redirect first. The dashboard
 * routes underneath it (/employer/jobs etc.) are unaffected and still
 * redirect to /login, covered by tests/proxy/seeker-app-gate.test.ts.
 *
 * This pins the actual navigation TARGET (the post-click URL), not just the
 * anchor's href attribute — a href can be correct while something else
 * intercepts the click, and checking the href alone wouldn't catch that.
 */
test.describe("employer links point at the real self-serve flow, not /contact", () => {
  test("the About page's employer CTA lands on /employer directly, not /contact or a login redirect", async ({
    page,
  }) => {
    await page.goto("/about");
    await page.getByRole("link", { name: "Post a job" }).click();
    await expect(page).toHaveURL(/\/employer$/);
  });

  test("the footer's employer link lands on /employer directly, not /contact or a login redirect", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Hire through Talentrah" }).click();
    await expect(page).toHaveURL(/\/employer$/);
  });
});
