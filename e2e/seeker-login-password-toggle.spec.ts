import { test, expect } from "@playwright/test";

/**
 * The shared `PasswordField` (src/components/ui/password-field.tsx), now
 * used on a seeker-facing form — /login is one of three (login/signup/
 * reset-password) that switched from a plain `TextField` to this component.
 *
 * Mirrors e2e/admin-login-password-toggle.spec.ts's own first test: the
 * static shape (button type, starting state, real password field) is
 * asserted offline in tests/auth/login-form.test.tsx; what needs a real
 * browser is the part that only exists once something is clicked. One case
 * here is enough to prove the shared component behaves the same way outside
 * admin's own page — the toggle mechanics themselves are already covered in
 * full by the admin spec and are not duplicated per caller.
 */
test("the password reveal toggle works on the seeker login form", async ({ page }) => {
  await page.goto("/login");

  // exact: true — the reveal toggle itself carries an accessible name
  // containing "Password" ("Show password"/"Hide password"), so a substring
  // match resolves ambiguously between the field and the button.
  const field = page.getByLabel("Password", { exact: true });
  await expect(field).toHaveAttribute("type", "password");

  const show = page.getByRole("button", { name: "Show password" });
  await expect(show).toBeVisible();
  await expect(show).toHaveAttribute("aria-pressed", "false");

  // Same hit-target regression this project has shipped before — measured
  // in a browser, not assumed from the class names.
  const box = await show.boundingBox();
  expect(box, "the toggle should be on the page").not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(40);
  expect(box!.height).toBeGreaterThanOrEqual(40);

  await field.fill("whatever-not-a-real-password");
  await show.click();

  await expect(field).toHaveAttribute("type", "text");
  const hide = page.getByRole("button", { name: "Hide password" });
  await expect(hide).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Show password" })).toHaveCount(0);
  // The typed value survives the reveal — this only swaps the input's type.
  await expect(field).toHaveValue("whatever-not-a-real-password");

  await hide.click();
  await expect(field).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: "Show password" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});
