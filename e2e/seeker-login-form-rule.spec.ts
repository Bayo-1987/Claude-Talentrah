/**
 * Seeker log in through the real page (QA, 9 Oct; form rule): a wrong password shows the generic message and keeps the email (never echoes the password); the right password logs in, signing out and back
 * in works a second time and the form starts clean; the failure message does not say whether the email exists. Local stack only, a throwaway user with a GENERATED password.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { settle } from "./support/settle";

test("seeker login: wrong password keeps the email; right password in, out, in; same message for an unknown email", async ({ page }, info) => {
  test.setTimeout(120_000);
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const tag = randomUUID().slice(0, 8);
  const email = `qa-login-${tag}@${tag}.talentrah.test`;
  const password = `Qa${randomUUID().replace(/-/g, "").slice(0, 14)}9`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { first_name: "QA", last_name: "Login", country: "Nigeria" } });
  if (error) throw error;
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("Wrong" + password);
    await page.getByRole("button", { name: "Log in" }).click();
    const err = page.locator("p.text-rust, [role=alert]").filter({ hasText: /\S/ }).first();
    await expect(err).toBeVisible({ timeout: 30_000 });
    const known = (await err.innerText()).trim();
    await shot("1-wrong-password");
    await settle(page);
    expect.soft(await page.getByLabel("Email").inputValue(), "LOGIN-SEEKER-KEEP-1: the email typed is kept after a failed log-in").toBe(email);
    expect(await page.getByLabel("Password", { exact: true }).inputValue(), "the password is never kept").toBe("");

    // An unknown email gets the same message.
    await page.getByLabel("Email").fill(`nobody-${tag}@${tag}.talentrah.test`);
    await page.getByLabel("Password", { exact: true }).fill("Wrong" + password);
    await page.getByRole("button", { name: "Log in" }).click();
    await settle(page);
    const unknown = (await page.locator("p.text-rust, [role=alert]").filter({ hasText: /\S/ }).first().innerText()).trim();
    expect(unknown, "the message does not reveal whether the email exists").toBe(known);

    for (const round of [1, 2]) {
      await page.goto("/login");
      await expect(page.getByLabel("Email"), `round ${round}: a fresh login form starts clean`).toHaveValue("");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Log in" }).click();
      await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45_000 });
      await shot(`2-in-${round}`);
      await page.context().clearCookies(); // signing out itself is covered by sign-out-scope.spec; here the point is the second log-in from a clean form
    }
  } finally {
    await admin.auth.admin.deleteUser(data.user.id);
  }
});
