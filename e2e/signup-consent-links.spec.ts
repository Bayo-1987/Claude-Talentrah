/**
 * send-396 — the signup form's consent checkbox linked to /terms and
 * /privacy, neither of which exists as a real route (only /legal/terms and
 * /legal/privacy do — confirmed live in production and in source, no
 * rewrite maps one to the other). A 404'd Terms/Privacy link at the exact
 * moment a user is asked to agree to them is a compliance exposure, not
 * just a broken-link nuisance — see src/components/auth/signup-form.tsx.
 *
 * Checked before writing this: no other `href="/terms"` or `href="/privacy"`
 * exists anywhere in src/ — this was the only instance of the mistake.
 */
import { test, expect } from "@playwright/test";

test.describe("send-396: signup consent checkbox links to real routes", () => {
  test("Terms of Service and Privacy Policy links point at /legal/terms and /legal/privacy, and both resolve", async ({
    page,
  }) => {
    await page.goto("/signup");

    const termsLink = page.getByRole("link", { name: "Terms of Service" });
    const privacyLink = page.getByRole("link", { name: "Privacy Policy" });

    await expect(termsLink).toBeVisible();
    await expect(privacyLink).toBeVisible();

    expect(await termsLink.getAttribute("href")).toBe("/legal/terms");
    expect(await privacyLink.getAttribute("href")).toBe("/legal/privacy");

    // The whole point of this bug: a link next to a consent checkbox that
    // actually 404s. Follow both for real rather than trusting the href
    // string alone.
    const termsRes = await page.request.get("/legal/terms");
    expect(termsRes.status()).toBe(200);
    const privacyRes = await page.request.get("/legal/privacy");
    expect(privacyRes.status()).toBe(200);

    // The old, wrong paths must actually 404 — otherwise this test could
    // pass by coincidence (e.g. a catch-all route serving everything 200).
    const oldTermsRes = await page.request.get("/terms");
    expect(oldTermsRes.status()).toBe(404);
    const oldPrivacyRes = await page.request.get("/privacy");
    expect(oldPrivacyRes.status()).toBe(404);
  });
});
