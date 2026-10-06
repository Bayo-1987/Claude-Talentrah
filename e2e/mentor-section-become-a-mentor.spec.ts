import { test, expect, admin, seedBaseResume } from "./fixtures/authed";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";

/**
 * The homepage "Real human mentors" section's "Become a mentor" link, end to end (owner request, 6 Oct 2026, rule 6).
 *
 * `/mentorship/apply` needs an account, and a signed-out visitor must never be sent to /login by an internal link (send-477's ratchet,
 * e2e/signed-out-link-gate.spec.ts). So the link goes to the SIGNUP page with the destination as `redirectTo`
 * (`/signup?redirectTo=%2Fmentorship%2Fapply`), the same shape send-491 used for the other gated destinations. From there every way in ends on
 * `/mentorship/apply`:
 *   - the signup page's own "Log in" link keeps the way back, so an existing account logs in and lands there;
 *   - a new account is created, goes through onboarding with the destination riding along, and lands there;
 *   - an already signed-in visitor who clicks the link is forwarded by /signup straight there.
 * Same shape as e2e/login-return-to-page.spec.ts: throwaway accounts (the password is generated per run, no literal in the source).
 * This file's first run is in CI; the unit side of the same chain is tests/marketing/mentor-apply-return-path.test.ts.
 */
const domain = () => `${randomUUID().slice(0, 12)}.talentrah.test`;
/** Meets the password rule (upper, lower, digit, 8+) without a literal anywhere in the source. */
const makePassword = () => `Aa1-${randomUUID()}`;
const SIGNUP_LINK = "/signup?redirectTo=%2Fmentorship%2Fapply";

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

const becomeAMentorLink = (page: Page) => page.locator("#mentorship").getByRole("link", { name: /Become a mentor/ });

async function clickBecomeAMentorSignedOut(page: Page) {
  await page.goto("/");
  const link = becomeAMentorLink(page);
  await expect(link).toHaveAttribute("href", SIGNUP_LINK);
  await link.click();
  await expect(page).toHaveURL(/\/signup\?redirectTo=%2Fmentorship%2Fapply$/);
}

async function goToLoginFromSignup(page: Page) {
  await page.getByRole("link", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?redirectTo=%2Fmentorship%2Fapply$/);
}

async function logIn(page: Page, creds: { email: string; password: string }) {
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password", { exact: true }).fill(creds.password);
  await page.getByRole("button", { name: "Log in" }).click();
}

test("signed out on the homepage: 'Become a mentor' opens signup with the way back; the Log in link keeps it, and signing in lands on /mentorship/apply", async ({ page }) => {
  const creds = await createAccount({ resume: true });
  await clickBecomeAMentorSignedOut(page);
  await goToLoginFromSignup(page);
  await logIn(page, creds);
  await page.waitForURL(/\/mentorship\/apply$/);
  await expect(page.getByRole("heading", { level: 1, name: /Become a mentor|Your mentor profile/ })).toBeVisible();
});

test("the same for an account with no resume: onboarding is offered first, then it goes on to /mentorship/apply", async ({ page }) => {
  const creds = await createAccount({ resume: false });
  await clickBecomeAMentorSignedOut(page);
  await goToLoginFromSignup(page);
  await logIn(page, creds);
  await page.waitForURL(/\/onboarding\?next=%2Fmentorship%2Fapply$/);
  await page.getByRole("button", { name: /Skip for now/ }).or(page.getByRole("link", { name: /Skip for now/ })).click();
  await page.waitForURL(/\/mentorship\/apply$/);
});

test("creating a new account from that signup page goes through onboarding with the destination riding along, and ends on /mentorship/apply", async ({ page }) => {
  const email = `mentor-section-signup-${randomUUID()}@${domain()}`;
  await clickBecomeAMentorSignedOut(page);
  await page.getByLabel("First name").fill("Mentor");
  await page.getByLabel("Last name").fill("Section");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Country").selectOption("Nigeria");
  await page.getByLabel("Password", { exact: true }).fill(makePassword());
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create a free account" }).click();
  await page.waitForURL(/\/onboarding\?next=%2Fmentorship%2Fapply$/);
  await page.getByRole("button", { name: /Skip for now/ }).or(page.getByRole("link", { name: /Skip for now/ })).click();
  await page.waitForURL(/\/mentorship\/apply$/);
  const { data: profile } = await admin.from("profiles").select("id").eq("email", email).single();
  if (profile) made.userIds.push(profile.id);
});

test("an already signed-in visitor who clicks the link is forwarded by /signup straight to /mentorship/apply", async ({ authedPage }) => {
  await authedPage.goto("/");
  await becomeAMentorLink(authedPage).click();
  await authedPage.waitForURL(/\/mentorship\/apply$/);
});
