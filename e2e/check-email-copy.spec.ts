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
  context,
  baseURL,
}) => {
  // The address reaches the page in the pending-signup cookie the signup action sets (S1-101), never in the URL. Same format as the codec's.
  const value = Buffer.from(JSON.stringify({ e: "someone@talentrah.dev", r: "", t: Date.now() - 120_000 })).toString("base64url");
  await context.addCookies([{ name: "tr_signup_pending", value, url: new URL("/signup", baseURL!).toString() }]);
  await page.goto("/signup/check-email");

  // Shown masked, never in full.
  await expect(page.getByText("s••••@talentrah.dev")).toBeVisible();
  await expect(page.getByText("someone@talentrah.dev")).toHaveCount(0);

  await expect(page.getByText(/we've sent a 6-digit code/i)).toBeVisible();

  // Still says both things without branching on which is true: enter the code for a new account, or nothing new goes out for one that already exists.
  await expect(page.getByText(/if you already have an account here, no code goes out/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
});
