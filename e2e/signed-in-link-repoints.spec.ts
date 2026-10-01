/**
 * send-491 — the signed-in half of the link re-points (the signed-out half is
 * e2e/signed-out-link-repoints.spec.ts, which needs no database).
 *
 *  - row 2: the hero demo's "Build a resume" link points at the builder once the session resolves;
 *  - the signed-in-only "Build or upload your resume →" link is unchanged;
 *  - row 5: the cover-letter signup link forwards a signed-in reader straight to /tailor?coverLetter=1
 *    (/signup redirects a signed-in user to redirectTo, query string included).
 *
 * Uses the `authedPage` fixture, so it needs the database, like e2e/landing-auth-variant.spec.ts.
 */
import { test, expect } from "./fixtures/authed";

const COVER_LETTER_HREF = "/signup?redirectTo=%2Ftailor%3FcoverLetter%3D1";

test.describe("signed in", () => {
  test("signed in: the same link points straight at the builder once the session resolves", async ({ authedPage }) => {
    await authedPage.goto("/");
    // The static HTML ships the signed-out variant and the client swaps it after the session read, so this
    // WAITS (auto-retrying) rather than reading the first paint. See e2e/landing-auth-variant.spec.ts.
    await expect(authedPage.getByRole("link", { name: "Build a resume", exact: true })).toHaveAttribute("href", "/resume-builder");
    await expect(authedPage.getByRole("link", { name: "Find a scholarship", exact: true })).toHaveAttribute("href", "/scholarships");
  });


  test("signed in, no base resume: the 'Build or upload your resume' link is unchanged", async ({ authedPage }) => {
    // The link renders only when a signed-in submit is answered with the 'needs a base resume' 400. Stubbing
    // that one response keeps the test off the model and off the database state of the test user.
    await authedPage.route("**/api/tailoring", (route) =>
      route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "You need a base resume first." }) }),
    );
    await authedPage.goto("/");
    await expect(authedPage.getByRole("link", { name: "Build a resume", exact: true })).toHaveAttribute("href", "/resume-builder");
    await authedPage.locator("#jd-demo").fill("Senior frontend engineer. ".repeat(6));
    await authedPage.getByRole("button", { name: "Send to Farah" }).click();
    const link = authedPage.getByRole("link", { name: "Build or upload your resume →" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/resume-builder");
  });

  test("signed in: the same link is forwarded straight to /tailor?coverLetter=1", async ({ authedPage }) => {
    await authedPage.goto(COVER_LETTER_HREF);
    await authedPage.waitForURL("**/tailor?coverLetter=1");
    expect(new URL(authedPage.url()).pathname).toBe("/tailor");
    expect(new URL(authedPage.url()).searchParams.get("coverLetter")).toBe("1");
  });
});
