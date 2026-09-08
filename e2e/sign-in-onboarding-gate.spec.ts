import { test, expect, admin, seedBaseResume } from "./fixtures/authed";
import { randomUUID } from "node:crypto";

/**
 * Signing in with a password must reach onboarding, exactly like the other
 * entry points already did.
 *
 * ── THE BUG, AS IT ACTUALLY HAPPENED ──────────────────────────────────────
 *
 * `signInAction` ended with `redirect(safeRedirectTo(formData.get("redirectTo"),
 * "/jobs"))` — the feed, with no onboarding check of any kind. Signup and the
 * OAuth/One Tap callback both routed to `/onboarding`, so two of three entry
 * points gated and one did not.
 *
 * A confirmation link is single-use. Any account whose first click does not
 * cleanly land — Gmail prefetching the link while scanning incoming mail, a
 * second device, a closed tab — falls back to this form, and from there can
 * never reach `/onboarding` short of typing the URL, because signup and the
 * callback are its only other entrances. Seen on production: an account
 * reached `/employer` with zero rows in `resumes`, having never been offered
 * a CV upload.
 *
 * ── WHY THE SECOND TEST IS THE IMPORTANT ONE ──────────────────────────────
 *
 * The obvious fix — "send anyone without a base resume to onboarding" — trades
 * this bug for a worse one, because resume-existence cannot tell "declined on
 * purpose" from "never got here". Both are no resume, and they need opposite
 * treatment. `onboarding_skipped_at` (0112) is the fact that separates them,
 * and the skip test is what fails if a future change starts inferring from the
 * resume again.
 *
 * These drive the REAL /login form rather than the cookie-injecting fixture,
 * because the fixture deliberately does not type into the login form — so it
 * cannot exercise the code path that was broken. Each test therefore mints its
 * own password account.
 */

async function passwordAccount(): Promise<{ id: string; email: string; password: string }> {
  const email = `e2e-gate-${randomUUID()}@${randomUUID().slice(0, 12)}.talentrah.test`;
  const password = `Gate-${randomUUID()}Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    // Confirmed, because the bug is about what happens AFTER confirmation —
    // the user who falls back to the sign-in form has a usable account.
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("no user");
  return { id: data.user.id, email, password };
}

async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

test.describe("password sign-in routes through onboarding", () => {
  const created: string[] = [];
  test.afterAll(async () => {
    for (const id of created) {
      const { error } = await admin.auth.admin.deleteUser(id);
      // Reported, not swallowed: an unchecked delete that is refused resolves
      // rather than throwing, which is how test accounts pile up unnoticed.
      if (error) console.error("[sign-in-gate cleanup]", id, error.message);
    }
  });

  test("THE BUG: no resume and no skip marker lands on /onboarding, not /jobs", async ({ page }) => {
    const acct = await passwordAccount();
    created.push(acct.id);

    await signIn(page, acct.email, acct.password);

    await page.waitForURL("**/onboarding**");
    // Not just the URL: the thing the screen exists for has to be on it. A
    // redirect that lands on a page rendering nothing would satisfy the URL
    // assertion and still leave the user with no way to upload a CV.
    await expect(page.getByRole("button", { name: "Choose a file" })).toBeVisible();
  });

  test("a user who SKIPPED still goes straight to /jobs", async ({ page }) => {
    /*
     * The case the naive fix breaks. This account has no base resume either —
     * identical to the one above in every way except the marker — so if the
     * gate ever goes back to inferring from resume-existence, this test is
     * what fails.
     */
    const acct = await passwordAccount();
    created.push(acct.id);

    const { error } = await admin
      .from("profiles")
      .update({ onboarding_skipped_at: new Date().toISOString() })
      .eq("id", acct.id);
    if (error) throw new Error(`could not set the skip marker: ${error.message}`);

    await signIn(page, acct.email, acct.password);

    await page.waitForURL("**/jobs");
    await expect(page.getByRole("button", { name: "Choose a file" })).toHaveCount(0);
  });

  test("a user with a base resume also goes straight to /jobs", async ({ page }) => {
    // The other arm of the bounce, so the two facts are both covered and a
    // change that dropped either one is visible.
    const acct = await passwordAccount();
    created.push(acct.id);
    await seedBaseResume(acct.id);

    await signIn(page, acct.email, acct.password);

    await page.waitForURL("**/jobs");
  });

  test("clicking Skip writes the marker, so the next sign-in respects it", async ({ page }) => {
    /*
     * The write itself, which everything above depends on and nothing above
     * exercises: tests 1 and 2 set the marker by hand. If the skip button
     * stopped persisting — the action renamed, the prop dropped when the
     * component is next refactored, the write refused by a missing grant —
     * every one of them would still pass while real users were re-prompted
     * forever. This is the test that notices.
     */
    const acct = await passwordAccount();
    created.push(acct.id);

    await signIn(page, acct.email, acct.password);
    await page.waitForURL("**/onboarding**");

    await page.getByRole("button", { name: "Skip for now" }).click();
    await page.waitForURL("**/jobs");

    const { data, error } = await admin
      .from("profiles")
      .select("onboarding_skipped_at")
      .eq("id", acct.id)
      .single();
    if (error) throw new Error(error.message);
    expect(
      data?.onboarding_skipped_at,
      "Skip navigated but persisted nothing — this user will be re-prompted on every sign-in",
    ).not.toBeNull();

    // And the round trip: sign in again, and the marker must actually be honoured.
    await page.goto("/logout").catch(() => {});
    await page.context().clearCookies();
    await signIn(page, acct.email, acct.password);
    await page.waitForURL("**/jobs");
  });

  test("the intended destination survives the detour", async ({ page }) => {
    /*
     * Signing in from a link to somewhere specific must still end up there
     * once onboarding hands them on. Without this, routing everyone through
     * /onboarding would quietly become "the product forgot what you were
     * doing" for every returning user.
     */
    const acct = await passwordAccount();
    created.push(acct.id);
    await seedBaseResume(acct.id);

    await page.goto("/login?redirectTo=%2Ftracker");
    await page.getByLabel("Email").fill(acct.email);
    await page.getByLabel("Password").fill(acct.password);
    await page.getByRole("button", { name: "Log in" }).click();

    await page.waitForURL("**/tracker");
  });
});
