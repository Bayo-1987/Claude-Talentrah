import { test, expect, admin, seedBaseResume } from "./fixtures/authed";
import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";

/**
 * "Take me back to where I was" after logging in or signing up, end to end (S1-50, S1-51).
 *
 * A signed-out visitor opens a product page from the footer, uses the masthead's Log in (or Get started for free), authenticates, and must
 * land on that page, not on the feed. These drive the real login and signup forms with throwaway accounts (the password is generated per
 * run). The employer cases pin the S1-51 rule: someone headed for /employer is never shown the job seeker's resume upload.
 */
const domain = () => `${randomUUID().slice(0, 12)}.talentrah.test`;
/** Meets the password rule (upper, lower, digit, 8+) without a literal anywhere in the source. */
const makePassword = () => `Aa1-${randomUUID()}`;

const made: { userIds: string[]; orgIds: string[] } = { userIds: [], orgIds: [] };

test.afterEach(async () => {
  if (made.orgIds.length) await deleteOrgsCascade(admin, made.orgIds);
  for (const id of made.userIds) await admin.auth.admin.deleteUser(id);
  made.userIds = [];
  made.orgIds = [];
});

async function createAccount(opts: { resume?: boolean; org?: boolean } = {}) {
  const email = `login-return-${randomUUID()}@${domain()}`;
  const password = makePassword();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  made.userIds.push(data.user.id);
  if (opts.resume) await seedBaseResume(data.user.id);
  if (opts.org) {
    const { data: org, error: orgErr } = await admin.from("organizations").insert({ name: `E2E Return Co ${randomUUID().slice(0, 8)}`, created_by: data.user.id, verified: true }).select("id").single();
    if (orgErr || !org) throw new Error(`fixture org: ${orgErr?.message}`);
    made.orgIds.push(org.id);
    const { error: memErr } = await admin.from("organization_members").insert({ organization_id: org.id, user_id: data.user.id, role: "owner" });
    if (memErr) throw new Error(`fixture membership: ${memErr.message}`);
  }
  return { email, password };
}

async function logInFromMasthead(page: Page, from: string, creds: { email: string; password: string }) {
  await page.goto(from);
  await page.getByRole("banner").getByRole("link", { name: "Log in" }).click();
  await expect(page).toHaveURL(new RegExp(`/login\\?redirectTo=${encodeURIComponent(from)}$`));
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password", { exact: true }).fill(creds.password);
  await page.getByRole("button", { name: "Log in" }).click();
}

for (const from of ["/mentorship", "/scholarships"]) {
  test(`signed out on ${from}: Log in, then land back on ${from}`, async ({ page }) => {
    const creds = await createAccount({ resume: true });
    await logInFromMasthead(page, from, creds);
    await page.waitForURL(new RegExp(`${from}$`));
    expect(new URL(page.url()).pathname).toBe(from);
  });
}

test("a first-time signup from /scholarships goes through onboarding and ends on /scholarships", async ({ page }) => {
  const email = `signup-return-${randomUUID()}@${domain()}`;
  await page.goto("/scholarships");
  await page.getByRole("banner").getByRole("link", { name: "Get started for free" }).click();
  await expect(page).toHaveURL(/\/signup\?redirectTo=%2Fscholarships$/);
  await page.getByLabel("First name").fill("Return");
  await page.getByLabel("Last name").fill("Test");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Country").selectOption("Nigeria");
  await page.getByLabel("Password", { exact: true }).fill(makePassword());
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create a free account" }).click();

  // a new account still goes through onboarding; the destination rides along
  await page.waitForURL(/\/onboarding\?next=%2Fscholarships$/);
  await page.getByRole("button", { name: /Skip for now/ }).or(page.getByRole("link", { name: /Skip for now/ })).click();
  await page.waitForURL(/\/scholarships$/);

  const { data: profile } = await admin.from("profiles").select("id").eq("email", email).single();
  if (profile) made.userIds.push(profile.id);
});

test("an employer account (organisation, no resume) logging in from /employer lands on the employer side and never sees the resume upload", async ({ page }) => {
  const creds = await createAccount({ org: true });
  const visited: string[] = [];
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) visited.push(new URL(f.url()).pathname); });
  await logInFromMasthead(page, "/employer", creds);
  await page.waitForURL(/\/employer\/jobs$/);
  expect(visited.filter((p) => p.startsWith("/onboarding")), `visited: ${visited.join(" > ")}`).toEqual([]);
});

test("a seeker with no resume logging in from /employer skips the resume prompt and gets the employer side's own onboarding", async ({ page }) => {
  const creds = await createAccount();
  await logInFromMasthead(page, "/employer", creds);
  await page.waitForURL(/\/employer\/onboarding$/);
});

test("a seeker with no resume logging in from /mentorship is still offered the resume upload first, then goes on to /mentorship", async ({ page }) => {
  const creds = await createAccount();
  await logInFromMasthead(page, "/mentorship", creds);
  await page.waitForURL(/\/onboarding\?next=%2Fmentorship$/);
  await page.getByRole("button", { name: /Skip for now/ }).or(page.getByRole("link", { name: /Skip for now/ })).click();
  await page.waitForURL(/\/mentorship$/);
});
