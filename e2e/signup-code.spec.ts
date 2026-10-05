import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";

/**
 * Signing up with the six-digit code (S1-101), in a real browser against the CI stack's real GoTrue.
 *
 * WHAT IS REAL AND WHAT IS MINTED. There is no inbox in CI, so the code comes from `admin.generateLink({ type: "signup" })`, which creates the unconfirmed
 * account and returns the same `email_otp` the email would have carried: the page's check goes to the real verifyOtp, so a correct code really confirms the
 * account and really signs the browser in. (Same approach as forgot-password.spec.ts for the recovery token.) The one thing set by hand is the pending-signup
 * cookie that the signup action sets in production; its format is the codec's (src/lib/auth/signup-pending-codec.ts: base64url JSON {e: address, r:
 * destination, t: issued-at ms}), written here without importing the app so this file stays free of app modules.
 *
 * The unit and markup tests (tests/auth/signup-code-*.test.ts*) cover every branch of the actions; this file proves the page in a browser: a paste of six
 * digits, a wrong code that keeps what was typed, the cooldown on "Resend code", and landing on onboarding signed in.
 */
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (process.env.CI && (!SERVICE || !SUPA_URL)) throw new Error("signup-code spec cannot run in CI without Supabase credentials");
const admin =
  SERVICE && SUPA_URL && !SERVICE.startsWith("PASTE")
    ? createClient<Database>(SUPA_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;

/** Generated per run, never written down (the secret scan's rule for credentials in specs): the prefix gives upper and lower case, the slice the length, the digit is guaranteed. */
const PASSWORD = `Code${randomUUID().slice(0, 12)}1`;

async function pendingCookie(context: BrowserContext, baseURL: string, email: string, issuedAtMsAgo: number, redirectTo = "") {
  const value = Buffer.from(JSON.stringify({ e: email, r: redirectTo, t: Date.now() - issuedAtMsAgo })).toString("base64url");
  await context.addCookies([{ name: "tr_signup_pending", value, url: new URL("/signup", baseURL).toString() }]);
}

async function unconfirmedAccount(): Promise<{ email: string; otp: string; userId: string }> {
  const email = `code-${randomUUID()}@talentrah.test`;
  const { data, error } = await admin!.auth.admin.generateLink({ type: "signup", email, password: PASSWORD, options: { data: { first_name: "Code", last_name: "Test", country: "Nigeria" } } });
  if (error) throw error;
  return { email, otp: data.properties.email_otp, userId: data.user.id };
}

test.describe("signing up with the emailed code", () => {
  test.skip(!admin, "no usable SUPABASE_SERVICE_ROLE_KEY: this spec mints its own account");

  test("a correct code signs the browser in and lands on onboarding, with no address in any URL", async ({ page, context, baseURL }) => {
    test.setTimeout(90_000);
    const { email, otp, userId } = await unconfirmedAccount();
    try {
      await pendingCookie(context, baseURL!, email, 120_000);
      await page.goto("/signup/check-email");
      expect(page.url()).not.toContain("@");
      await expect(page.getByText(/^[a-z]••••@talentrah\.test$/)).toBeVisible();

      await page.getByLabel("6-digit code").fill(otp);
      await page.getByRole("button", { name: "Confirm email" }).click();

      await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
      expect(page.url()).not.toContain("@");
      expect(page.url()).not.toContain("%40");
    } finally {
      await admin!.auth.admin.deleteUser(userId);
    }
  });

  test("a pasted code with a space in it works (the page keeps the six digits)", async ({ page, context, baseURL }) => {
    test.setTimeout(90_000);
    const { email, otp, userId } = await unconfirmedAccount();
    try {
      await pendingCookie(context, baseURL!, email, 120_000);
      await page.goto("/signup/check-email");
      const box = page.getByLabel("6-digit code");
      await box.focus();
      await page.keyboard.insertText(`${otp.slice(0, 3)} ${otp.slice(3)}`);
      await expect(box).toHaveValue(otp);
      await page.getByRole("button", { name: "Confirm email" }).click();
      await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
    } finally {
      await admin!.auth.admin.deleteUser(userId);
    }
  });

  test("a wrong code shows one plain message, keeps what was typed, and puts the cursor back in the box", async ({ page, context, baseURL }) => {
    test.setTimeout(90_000);
    const { email, otp, userId } = await unconfirmedAccount();
    const wrong = otp === "000000" ? "111111" : "000000";
    try {
      await pendingCookie(context, baseURL!, email, 120_000);
      await page.goto("/signup/check-email");
      const box = page.getByLabel("6-digit code");
      await box.fill(wrong);
      await page.getByRole("button", { name: "Confirm email" }).click();

      await expect(page.getByTestId("code-status")).toContainText("That code didn't work");
      await expect(box).toHaveValue(wrong);
      await expect(box).toBeFocused();
      expect(page.url()).toContain("/signup/check-email");
    } finally {
      await admin!.auth.admin.deleteUser(userId);
    }
  });

  test("a code that is not six digits is refused beside the field and the field is marked invalid", async ({ page, context, baseURL }) => {
    await pendingCookie(context, baseURL!, `short-${randomUUID()}@talentrah.test`, 120_000);
    await page.goto("/signup/check-email");
    const box = page.getByLabel("6-digit code");
    await box.fill("12");
    await page.getByRole("button", { name: "Confirm email" }).click();
    await expect(page.getByText("Enter the 6-digit code from the email.")).toBeVisible();
    await expect(box).toHaveAttribute("aria-invalid", "true");
  });

  test("'Resend code' is held for the first minute, with the time left, and works after it", async ({ page, context, baseURL }) => {
    test.setTimeout(90_000);
    const { email, userId } = await unconfirmedAccount();
    try {
      await pendingCookie(context, baseURL!, email, 5_000);
      await page.goto("/signup/check-email");
      const held = page.getByRole("button", { name: /^Resend code in \d+s$/ });
      await expect(held).toBeVisible();
      await expect(held).toBeDisabled();

      await context.clearCookies();
      await pendingCookie(context, baseURL!, email, 120_000);
      await page.goto("/signup/check-email");
      const ready = page.getByRole("button", { name: "Resend code" });
      await expect(ready).toBeEnabled();
      await ready.click();
      await expect(page.getByTestId("resend-status")).toContainText("We sent a new code. Check your inbox.");
      await expect(page.getByRole("button", { name: /^Resend code in \d+s$/ })).toBeDisabled();
    } finally {
      await admin!.auth.admin.deleteUser(userId);
    }
  });

  test("with no pending signup the page says so plainly and offers the way back", async ({ page }) => {
    await page.goto("/signup/check-email");
    await expect(page.getByText("This step has timed out.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to sign up" })).toHaveAttribute("href", "/signup");
  });

  test("an old ?email= link shows nothing from the URL: the address in a query string is ignored", async ({ page }) => {
    await page.goto("/signup/check-email?email=someone%40talentrah.dev");
    await expect(page.getByText("someone@talentrah.dev")).toHaveCount(0);
    await expect(page.getByText("This step has timed out.")).toBeVisible();
  });
});
