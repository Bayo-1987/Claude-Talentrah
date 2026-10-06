import { test, expect, admin, seedBaseResume } from "./fixtures/authed";
import { randomUUID } from "node:crypto";

/**
 * The homepage "Real human mentors" section's "Become a mentor" link, end to end (owner request, 6 Oct 2026, rule 6 and answer 6).
 *
 * `/mentorship/apply` needs an account. A signed-out visitor who clicks the link must land on the login page carrying the way back
 * (`?redirectTo=%2Fmentorship%2Fapply`), and after signing in must end on `/mentorship/apply`, not on the job feed. Same shape as
 * e2e/login-return-to-page.spec.ts: throwaway accounts (the password is generated per run, no literal in the source).
 *
 * Two accounts, because the destination rides through onboarding for an account with no resume (the existing S1-50 rule): one with a base
 * resume goes straight back; one without is offered the resume upload first, then goes on to /mentorship/apply.
 * This file's first run is in CI; the unit side of the same chain is tests/marketing/mentor-apply-return-path.test.ts.
 */
const domain = () => `${randomUUID().slice(0, 12)}.talentrah.test`;
/** Meets the password rule (upper, lower, digit, 8+) without a literal anywhere in the source. */
const makePassword = () => `Aa1-${randomUUID()}`;

const made: { userIds: string[] } = { userIds: [] };
test.afterEach(async () => {
  for (const id of made.userIds) await admin.auth.admin.deleteUser(id);
  made.userIds = [];
});

async function createAccount(opts: { resume: boolean }) {
  const email = `mentor-section-${randomUUID()}@${domain()}`;
  const password = makePassword();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  made.userIds.push(data.user.id);
  if (opts.resume) await seedBaseResume(data.user.id);
  return { email, password };
}

async function clickBecomeAMentorSignedOut(page: import("@playwright/test").Page) {
  await page.goto("/");
  const link = page.locator("#mentorship").getByRole("link", { name: /Become a mentor/ });
  await expect(link).toHaveAttribute("href", "/mentorship/apply");
  await link.click();
  await expect(page).toHaveURL(/\/login\?redirectTo=%2Fmentorship%2Fapply$/);
}

async function logIn(page: import("@playwright/test").Page, creds: { email: string; password: string }) {
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password", { exact: true }).fill(creds.password);
  await page.getByRole("button", { name: "Log in" }).click();
}

test("signed out on the homepage: 'Become a mentor' goes to login with the way back, and signing in lands on /mentorship/apply", async ({ page }) => {
  const creds = await createAccount({ resume: true });
  await clickBecomeAMentorSignedOut(page);
  await logIn(page, creds);
  await page.waitForURL(/\/mentorship\/apply$/);
  await expect(page.getByRole("heading", { level: 1, name: /Become a mentor|Your mentor profile/ })).toBeVisible();
});

test("the same for an account with no resume: onboarding is offered first, then it goes on to /mentorship/apply", async ({ page }) => {
  const creds = await createAccount({ resume: false });
  await clickBecomeAMentorSignedOut(page);
  await logIn(page, creds);
  await page.waitForURL(/\/onboarding\?next=%2Fmentorship%2Fapply$/);
  await page.getByRole("button", { name: /Skip for now/ }).or(page.getByRole("link", { name: /Skip for now/ })).click();
  await page.waitForURL(/\/mentorship\/apply$/);
});
