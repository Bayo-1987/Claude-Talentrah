/**
 * QA journeys (UNRUN when written: authored on a machine with no local stack, CI is their first run).
 *
 * The HUMAN experience, per role: a person who types into the real pages. Each test creates a throwaway user with a GENERATED password (never real,
 * never printed or attached), then drives /signup or /login with clicks and typing only, and screenshots every step (attached to the test report).
 * The role journeys that follow may start from the minted session in ./fixtures/authed; these are the ones that go through the pages themselves.
 *
 * Local stack or CI only: ./fixtures/authed's admin client refuses production, and these tests create users with it.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin, seedBaseResume } from "./fixtures/authed";
import type { Page, TestInfo } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 900 } });

/** Generated per run: upper, lower, digit, 12+ chars (the app's password rule). Never logged. */
const newPassword = () => `Qa${randomUUID().replace(/-/g, "").slice(0, 14)}9`;
const newEmail = (role: string) => `qa-${role}-${randomUUID()}@${randomUUID().slice(0, 10)}.talentrah.test`;

async function shot(page: Page, info: TestInfo, step: string) {
  await info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

async function throwawayUser(role: string, meta: Record<string, string> = { first_name: "QA", last_name: role, country: "Nigeria" }) {
  const email = newEmail(role);
  const password = newPassword();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: meta });
  if (error) throw error;
  return { id: data.user.id, email, password };
}

async function logInThroughThePage(page: Page, info: TestInfo, email: string, password: string) {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /Log in to Talentrah/ })).toBeVisible();
  await shot(page, info, "1-login-page");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await shot(page, info, "2-login-filled-password-hidden");
  await page.getByRole("button", { name: "Log in" }).click();
}

test("QA Seeker: logs in through /login with an email and password and lands in the app", async ({ page }, info) => {
  const u = await throwawayUser("seeker");
  try {
    await seedBaseResume(u.id);
    await logInThroughThePage(page, info, u.email, u.password);
    await page.waitForURL("**/jobs", { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Log in" })).toHaveCount(0);
    await shot(page, info, "3-jobs-after-login");
  } finally {
    await admin.auth.admin.deleteUser(u.id);
  }
});

test("QA Seeker: a wrong password is refused on the page and the person stays on /login", async ({ page }, info) => {
  const u = await throwawayUser("seeker-wrong");
  try {
    await logInThroughThePage(page, info, u.email, `${newPassword()}x`);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("alert").or(page.getByText(/invalid|incorrect|didn.t work/i)).first()).toBeVisible();
    await shot(page, info, "3-wrong-password-message");
  } finally {
    await admin.auth.admin.deleteUser(u.id);
  }
});

test("QA Seeker: creates an account on /signup with the form, then reaches the code page", async ({ page }, info) => {
  // Real signup + code + onboarding with a screenshot per step: the 30 s default is too tight (signup-code.spec.ts uses 90 s for the same reason).
  test.setTimeout(90_000);
  const email = newEmail("signup");
  const password = newPassword();
  let userId: string | undefined;
  try {
    await page.goto("/signup");
    await expect(page.getByText("Create a free account", { exact: false }).first()).toBeVisible();
    await shot(page, info, "1-signup-page");
    await page.getByLabel("First name").fill("QA");
    await page.getByLabel("Last name").fill("Signup");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Country").selectOption("Nigeria");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("checkbox").check();
    await shot(page, info, "2-signup-filled-password-hidden");
    await page.getByRole("button", { name: "Create a free account" }).click();

    await page.waitForURL(/\/(signup\/check-email|onboarding)/, { timeout: 30_000 });
    expect(page.url()).not.toContain("@");
    if (/\/onboarding/.test(page.url())) {
      // The CI/local stack has [auth.email] enable_confirmations = false (supabase/config.toml), so signing up signs the person straight in. Production
      // requires the emailed code, and that screen is covered against a minted code by signup-code.spec.ts. Found by CI run 37537700703.
      info.annotations.push({ type: "note", description: "stack has email confirmations off: signup went straight to onboarding; the code screen was not reachable here" });
      await shot(page, info, "3-onboarding-straight-after-signup");
      return;
    }
    await expect(page.getByLabel("6-digit code")).toBeVisible();
    await shot(page, info, "3-check-email-page");

    // No inbox in CI: ask GoTrue for the same six-digit code the email carries (the approach e2e/signup-code.spec.ts uses).
    const { data: found } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
    userId = found?.id;
    const { data: link, error } = await admin.auth.admin.generateLink({ type: "signup", email, password });
    const otp = link?.properties?.email_otp;
    test.skip(!!error || !otp, `could not mint a code for the account the page just created (${error?.message ?? "no otp"}): finish this journey by hand`);
    userId = userId ?? link?.user?.id;

    await page.getByLabel("6-digit code").fill(otp ?? "");
    await page.getByRole("button", { name: "Confirm email" }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
    await shot(page, info, "4-onboarding-after-code");
  } finally {
    if (!userId) {
      const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
      userId = data?.users.find((x) => x.email === email)?.id;
    }
    if (userId) await admin.auth.admin.deleteUser(userId);
  }
});

test("QA Employer: logs in through /login, opens Employer, and is offered company onboarding (no job is posted)", async ({ page }, info) => {
  const u = await throwawayUser("employer");
  try {
    await seedBaseResume(u.id);
    await logInThroughThePage(page, info, u.email, u.password);
    await page.waitForURL("**/jobs", { timeout: 30_000 });
    await page.goto("/employer");
    await expect(page).toHaveURL(/\/employer\/onboarding$/);
    await expect(page.getByRole("heading", { name: "Hire on Talentrah" })).toBeVisible();
    await shot(page, info, "3-employer-onboarding");
    // Deliberately stops here: no company is created, so nothing can be posted.
  } finally {
    await admin.auth.admin.deleteUser(u.id);
  }
});

test("QA Mentor: logs in through /login and reaches the mentor application page", async ({ page }, info) => {
  const u = await throwawayUser("mentor");
  try {
    await seedBaseResume(u.id);
    await logInThroughThePage(page, info, u.email, u.password);
    await page.waitForURL("**/jobs", { timeout: 30_000 });
    await page.goto("/mentorship");
    await shot(page, info, "3-mentorship");
    await page.goto("/mentorship/apply");
    await expect(page.getByRole("heading", { name: "Become a mentor" })).toBeVisible();
    await shot(page, info, "4-mentor-apply-page");
    // Deliberately stops before submitting: no application is created.
  } finally {
    await admin.auth.admin.deleteUser(u.id);
  }
});
