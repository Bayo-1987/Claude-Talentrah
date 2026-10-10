/**
 * Seeker > Settings > Delete account: the request form (QA, 9 Oct). STOPS BEFORE the irreversible step: the confirmation link in the email is never opened (a local stack has no email provider, so none is sent).
 * Deliberate error first: the confirmation phrase typed slightly wrong ("delete my acount"): the error is shown and what was typed is still in the box so it can be corrected. Then the exact phrase: a result
 * message is shown (either "emailed a confirmation link" or, with no email provider as here, "can't send email right now"; never silence, never a crash). The account is NOT deleted or scheduled either way.
 * Local stack only, minted session for a throwaway user.
 */
import { test, expect, admin } from "./fixtures/authed";
import { submitAndSettle } from "./support/form-keeps";
import { settle } from "./support/settle";

test("delete-account request: a near-miss phrase keeps what was typed; the exact phrase gets a visible result; nothing is deleted", async ({ authedPage: page, testUser }, info) => {
  test.setTimeout(90_000);
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await page.goto("/settings");
  const section = page.getByRole("region", { name: "Delete account" });
  const field = section.getByLabel(/^Type ".+" to confirm$/);
  await field.fill("delete my acount");
  await submitAndSettle(page, () => section.getByRole("button", { name: "Email me a confirmation link" }).click());
  await expect(section.getByText(/exactly to continue/)).toBeVisible({ timeout: 30_000 });
  await shot("1-near-miss");
  await settle(page);
  expect.soft(await field.inputValue(), "DELETE-KEEP-1: the phrase typed must stay in the box so it can be corrected").toBe("delete my acount");

  await field.fill("delete my account");
  await submitAndSettle(page, () => section.getByRole("button", { name: "Email me a confirmation link" }).click());
  await expect(section.getByText(/emailed a confirmation link|can.t send email right now|couldn.t send the confirmation email|couldn.t start that/i)).toBeVisible({ timeout: 30_000 });
  await shot("2-exact-phrase");
  const { data: profile } = await admin.from("profiles").select("*").eq("id", testUser.id).single();
  expect(profile, "the account still exists").not.toBeNull();
  expect((profile as Record<string, unknown>).deletion_requested_at ?? null, "not scheduled for deletion by a request alone").toBeNull();
});
