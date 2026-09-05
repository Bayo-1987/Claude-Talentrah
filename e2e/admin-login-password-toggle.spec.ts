import { test, expect } from "@playwright/test";

/**
 * The password reveal control on /admin/login, driven in a real browser.
 *
 * NO FIXTURE AND NO SIGN-IN. Everything here is true of the signed-out page,
 * which is the point: the control has to work for the person who cannot get
 * in, and creating an operator to test it would be creating the account whose
 * absence is the situation being served.
 *
 * The static half of these properties — the button's type, its starting state,
 * the field still being a password field — is asserted in
 * tests/admin/admin-login-form.test.tsx. What needs a browser is the part that
 * only exists once something is clicked.
 */
test.describe("the admin password reveal", () => {
  const field = "#admin-password";
  const toggle = (name: "Show password" | "Hide password") => `button[aria-label="${name}"]`;

  /*
   * The form's own error, not `getByRole("alert")`.
   *
   * Next renders a permanent route announcer — <div role="alert"
   * id="__next-route-announcer__"> — so the role matches two elements on every
   * page and an empty one is always present. `toHaveCount(0)` against the role
   * could therefore never pass, and `toHaveText` resolved to the announcer's
   * empty string. The form's message is a <p>, which is what these mean.
   */
  const formError = (page: import("@playwright/test").Page) => page.locator('p[role="alert"]');

  test("reveals and re-hides, and says which it is doing", async ({ page }) => {
    await page.goto("/admin/login");
    expect(new URL(page.url()).pathname).toBe("/admin/login");

    // Hidden to begin with.
    await expect(page.locator(field)).toHaveAttribute("type", "password");
    const show = page.locator(toggle("Show password"));
    await expect(show).toBeVisible();
    await expect(show).toHaveAttribute("aria-pressed", "false");

    // The target is the whole right edge of the field, not the glyph. #69
    // shipped a control past review that read as `min-h-10` and measured
    // 39.1px WIDE, because height and width are separate and only one was
    // named — so both are measured, in a browser.
    const box = await show.boundingBox();
    expect(box, "the toggle should be on the page").not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(40);
    expect(box!.height).toBeGreaterThanOrEqual(40);

    await show.click();

    await expect(page.locator(field)).toHaveAttribute("type", "text");
    const hide = page.locator(toggle("Hide password"));
    await expect(hide).toHaveAttribute("aria-pressed", "true");
    // The name changed with the state, so a screen reader announces that the
    // secret is currently on screen rather than only that a button is pressed.
    await expect(page.locator(toggle("Show password"))).toHaveCount(0);

    await hide.click();
    await expect(page.locator(field)).toHaveAttribute("type", "password");
    await expect(page.locator(toggle("Show password"))).toHaveAttribute("aria-pressed", "false");
  });

  test("revealing does not submit the form", async ({ page }) => {
    /*
     * THIS WATCHES FOR THE POST, and an earlier version of it did not.
     *
     * It used to click the toggle and assert no error message was on screen.
     * That passed with `type="button"` REMOVED — proven by deleting the
     * attribute, confirming the served HTML no longer carried it, and watching
     * all five tests still go green. Asserting an absence immediately after a
     * click races the round trip it is trying to detect: nothing had rendered
     * yet either way.
     *
     * A server action is a POST to this same URL, so the POST is the thing to
     * count. The submit at the end is a positive control: if clicking "Sign in"
     * did not produce one either, the detector is broken rather than the page
     * being well behaved.
     */
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST") posts.push(r.url());
    });

    await page.goto("/admin/login");
    await page.locator("#admin-email").fill("nobody@talentrah.test");
    await page.locator(field).fill("not-a-real-password");

    await page.locator(toggle("Show password")).click();
    await expect(page.locator(field)).toHaveAttribute("type", "text");
    // Give a submit time to actually leave the browser before concluding it did not.
    await page.waitForTimeout(1000);

    expect(posts, `revealing the password posted the form: ${posts.join(", ")}`).toHaveLength(0);
    expect(new URL(page.url()).pathname).toBe("/admin/login");
    await expect(page.locator(field)).toHaveValue("not-a-real-password");

    // Positive control: the real submit DOES post, so the counter above works.
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(formError(page)).toHaveText("Incorrect email or password.");
    expect(posts.length, "the POST detector never saw a real submit").toBeGreaterThan(0);
  });

  test("a reload starts hidden again", async ({ page }) => {
    await page.goto("/admin/login");
    await page.locator(toggle("Show password")).click();
    await expect(page.locator(field)).toHaveAttribute("type", "text");

    await page.reload();

    // Nothing persisted it — not storage, not a cookie, not the URL. If a
    // future edit "remembers" the preference, this fails.
    await expect(page.locator(field)).toHaveAttribute("type", "password");
    await expect(page.locator(toggle("Show password"))).toHaveAttribute("aria-pressed", "false");

    const storage = await page.evaluate(() => ({
      local: JSON.stringify(Object.entries(localStorage)),
      session: JSON.stringify(Object.entries(sessionStorage)),
    }));
    expect(storage.local.toLowerCase()).not.toContain("password");
    expect(storage.session.toLowerCase()).not.toContain("password");
  });

  test("a failed sign-in re-hides the password", async ({ page }) => {
    await page.goto("/admin/login");
    await page.locator("#admin-email").fill("nobody@talentrah.test");
    await page.locator(field).fill("not-a-real-password");
    await page.locator(toggle("Show password")).click();
    await expect(page.locator(field)).toHaveAttribute("type", "text");

    await page.getByRole("button", { name: "Sign in" }).click();

    // The attempt came back refused…
    await expect(formError(page)).toHaveText("Incorrect email or password.");
    // …and the password is no longer on screen. A rejected attempt is exactly
    // the moment someone may have walked away from a revealed secret.
    await expect(page.locator(field)).toHaveAttribute("type", "password");
  });

});
