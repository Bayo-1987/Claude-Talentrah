import { test, expect } from "@playwright/test";

/**
 * Regression test for the Tier 2 QA bug (and the general pattern behind it):
 * a <form action={fn}> using React 19's Actions triggers a native browser
 * form reset after the action completes, which clobbers a <select> or
 * checkbox's DOM value/checked even though React's own controlled state for
 * them is correct — text inputs aren't affected (React's value tracker
 * corrects them regardless). This is a real-browser DOM-timing issue that a
 * jsdom/component test would not reliably reproduce either way, which is why
 * this lives here as an actual Playwright test rather than a Vitest one.
 *
 * Covers SignupForm specifically. A follow-up audit
 * (see CLAUDE.md / commit history) found no other <form action={fn}> in the
 * codebase combining this pattern with a select/checkbox/radio input — every
 * other such form only contains buttons or static hidden inputs, and the
 * other places with a select/checkbox (tailor-form.tsx) use a plain
 * onSubmit handler, not the action prop, so they were never at risk.
 */
test("Country and Terms checkbox survive a failed signup submission", async ({ page }) => {
  await page.goto("/signup");

  await page.getByLabel("First name").fill("Regression");
  await page.getByLabel("Last name").fill("Test");
  await page.getByLabel("Email").fill(`e2e-regression-${Date.now()}@talentrah.dev`);
  await page.getByLabel("Country").selectOption("Kenya");
  await page.getByRole("checkbox").check();
  // Deliberately fails the server-side password policy (see
  // src/lib/auth/password.ts) so the form re-renders with an error instead
  // of redirecting — that failed-submission re-render is exactly what used
  // to clobber the select/checkbox.
  // exact: true — the password reveal toggle's own accessible name also
  // contains "Password" ("Show password"), which a substring match would
  // resolve ambiguously.
  // 12 characters, so the browser's own minLength lets it through to the server; no uppercase letter and no digit, so the
  // server's rule still refuses it. (A shorter password, like the old "weak", is now stopped by the browser before the
  // action runs, which would never exercise the failed-submission re-render this test is about.)
  await page.getByLabel("Password", { exact: true }).fill("weakpassword");

  await page.getByRole("button", { name: "Create a free account" }).click();

  // The server's own message, from the shared rule list: it names exactly what "weakpassword" lacks (it has length and lowercase).
  await expect(page.getByText("Your password needs one uppercase letter and one number.", { exact: true })).toBeVisible();

  await expect(page.getByLabel("Country")).toHaveValue("Kenya");
  await expect(page.getByRole("checkbox")).toBeChecked();
});
