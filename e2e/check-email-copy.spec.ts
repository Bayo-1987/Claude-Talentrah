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
 */
test("check-email page guides a possibly-returning user without revealing account existence", async ({
  page,
}) => {
  await page.goto("/signup/check-email?email=someone%40talentrah.dev");

  await expect(page.getByText("someone@talentrah.dev")).toBeVisible();

  await expect(
    page.getByText(/we've sent a confirmation link/i),
  ).toBeVisible();

  await expect(
    page.getByText(/if you already have an account with this email/i),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "log in instead" })).toHaveAttribute(
    "href",
    "/login",
  );
});
