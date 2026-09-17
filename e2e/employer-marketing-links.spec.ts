import { test, expect } from "@playwright/test";

/**
 * Regression coverage for send-303/send-304: the About page's "For employers
 * too" section and the footer's "Hire through Talentrah" link both used to
 * point at /contact and describe self-serve job posting as "in development"
 * — false, since /employer is a real, live, free self-serve flow. Both were
 * fixed to link to /employer, which redirects a signed-out visitor to
 * /login?redirectTo=%2Femployer (getEmployerContext() calls requireUser()
 * internally) rather than landing them on a contact form.
 *
 * This pins the actual navigation TARGET (the post-click URL), not just the
 * anchor's href attribute — a href can be correct while something else
 * intercepts the click, and checking the href alone wouldn't catch that.
 */
test.describe("employer links point at the real self-serve flow, not /contact", () => {
  test("the About page's employer CTA lands in /login?redirectTo=%2Femployer, not /contact", async ({
    page,
  }) => {
    await page.goto("/about");
    await page.getByRole("link", { name: "Post a job" }).click();
    await expect(page).toHaveURL(/\/login\?redirectTo=%2Femployer/);
  });

  test("the footer's employer link lands in /login?redirectTo=%2Femployer, not /contact", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Hire through Talentrah" }).click();
    await expect(page).toHaveURL(/\/login\?redirectTo=%2Femployer/);
  });
});
