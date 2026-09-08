import { test, expect } from "@playwright/test";

/**
 * Regression test for QA audit bug #2 (Tier 3): the check-email page used to
 * give a returning user (an email that's already registered) no guidance —
 * signUp() deliberately doesn't error for a duplicate email (anti-enumeration:
 * Supabase mimics a fresh signup either way), so the app can't know at this
 * point whether the address is new or already registered, and must never
 * reveal which. The fix was copy that covers both cases without branching on
 * which one is true. Since the page can't distinguish the cases, this test
 * only has one path to check: that both messages are present and neither
 * outright confirms/denies the account already exists.
 *
 * UPDATED for the check-email redesign (resend action + webmail link): the
 * two-paragraph hedge collapsed to one sentence and "log in instead" moved
 * out of that sentence into its own de-emphasized line below a divider
 * ("Already confirmed? Log in") — the property under test (both cases
 * covered, neither confirmed) is unchanged, only the exact wording is.
 */
test("check-email page guides a possibly-returning user without revealing account existence", async ({
  page,
}) => {
  await page.goto("/signup/check-email?email=someone%40talentrah.dev");

  await expect(page.getByText("someone@talentrah.dev")).toBeVisible();

  await expect(
    page.getByText(/we've sent a confirmation link/i),
  ).toBeVisible();

  // One sentence now, not two paragraphs — but it still says both things
  // without branching on which is true: activate a new account, or nothing
  // new goes out for one that already exists.
  await expect(
    page.getByText(/if you already have one here, no new email goes out/i),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" })).toHaveAttribute(
    "href",
    "/login",
  );
});
