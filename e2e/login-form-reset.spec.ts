import { test, expect } from "@playwright/test";

/**
 * Regression test for the Tier 2 QA bug on LoginForm: after a failed login,
 * the email should persist (a typo'd password shouldn't force retyping the
 * email) but the password should clear (never re-show a failed password).
 *
 * Unlike SignupForm's Country <select> and Terms checkbox, LoginForm has no
 * select/checkbox/radio input, so it was never at risk of the native
 * form-reset-after-action DOM-clobbering race that required the ref+effect
 * hard-sync fix there (see signup-form-reset.spec.ts and
 * src/components/auth/signup-form.tsx). Email is a controlled text input —
 * React's own value tracker corrects a controlled text input's DOM value
 * regardless of when the native reset fires, so this test is expected to
 * pass without any equivalent fix. It exists to prove that behavior rather
 * than just assert it from reading the code.
 */
test("email survives a failed login, password does not", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("Email").fill("nobody-e2e@talentrah.dev");
  await page.getByLabel("Password").fill("whatever-wrong-password");

  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page.getByText("Incorrect email or password.")).toBeVisible();

  await expect(page.getByLabel("Email")).toHaveValue("nobody-e2e@talentrah.dev");
  await expect(page.getByLabel("Password")).toHaveValue("");
});
