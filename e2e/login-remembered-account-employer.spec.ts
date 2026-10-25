import { expect } from "@playwright/test";
import { test, admin } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";
import { randomUUID } from "node:crypto";
import { openMenu, storedEmail, submitLoginForm, waitForHydration } from "./support/remembered-account";

/**
 * f) the employer's sign-in is the same /login page, so the same card must work for an employer: create a company through the real
 * employer onboarding, sign out through the employer masthead's account menu, sign back in with a password, and be offered "Continue as <email>".
 */
test.use({ viewport: { width: 1280, height: 900 } });

test.afterEach(async ({ testUser }) => {
  await runCleanups([
    "employer organisations",
    async () => {
      const { data: orgs, error } = await admin
        .from("organizations")
        .select("id")
        .like("name", `E2E Remembered Co%${testUser.id.slice(0, 8)}`);
      if (error) throw new Error(`listing organisations: ${error.message}`);
      await deleteOrgsCascade(admin, (orgs ?? []).map((o) => o.id));
    },
  ]);
});

test("f) an employer signs in, signs out, and is offered 'Continue as <email>'", async ({ authedPage: page, testUser }) => {
  await page.goto("/employer");
  await page.getByLabel("Company name").fill(`E2E Remembered Co ${testUser.id.slice(0, 8)}`);
  await page.getByLabel("Company website domain").fill(`e2e-remembered-${testUser.id.slice(0, 8)}.example`);
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/employer\/jobs$/);

  // The fixture signs in by magic link and has no password; give this employer one so the password form can be used.
  const password = `Aa1!${randomUUID()}`;
  const { error } = await admin.auth.admin.updateUserById(testUser.id, { password });
  if (error) throw error;

  await expect(async () => {
    await openMenu(page, "Account menu");
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/employer"), { timeout: 3000 });
  }).toPass({ timeout: 20_000 });
  expect(await storedEmail(page)).toBeNull();

  await page.goto("/login");
  await waitForHydration(page);
  await submitLoginForm(page, testUser.email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  expect(await storedEmail(page)).toBe(testUser.email);

  // Sign out again (employer masthead), then the card is there.
  await page.goto("/employer/jobs");
  await expect(async () => {
    await openMenu(page, "Account menu");
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/employer"), { timeout: 3000 });
  }).toPass({ timeout: 20_000 });
  await page.goto("/login");
  await expect(page.getByRole("button", { name: `Continue as ${testUser.email}` })).toBeVisible();
});
