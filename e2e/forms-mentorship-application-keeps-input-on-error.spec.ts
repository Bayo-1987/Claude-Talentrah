/**
 * Forms sweep (QA, owner rule 8 Oct): /mentorship/apply (signed in, minted session, no existing mentor profile). Deliberate error: a bio under the 80-character minimum.
 * After the form settles (3 s) every field typed beside it must still be there: display name, bio (the rich editor), roles, industries, years, price. Local stack only; nothing is
 * submitted successfully, so no mentor application is created.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin, seedBaseResume } from "./fixtures/authed";
import { submitAndSettle, expectStaysFor } from "./support/form-keeps";

test("mentor application: a too-short bio error keeps everything typed", async ({ authedPage: page, testUser }, info) => {
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await seedBaseResume(testUser.id);
  const tag = randomUUID().slice(0, 6);
  await page.goto("/mentorship/apply");
  await expect(page.getByRole("heading", { name: "Become a mentor" })).toBeVisible();
  await page.getByLabel(/Display name/).fill(`QA Applicant ${tag}`);
  await page.getByRole("textbox", { name: /Bio/ }).click();
  await page.getByRole("textbox", { name: /Bio/ }).pressSequentially("Too short a bio.");
  await page.getByLabel(/Roles you can speak to/).fill("Product Manager, Engineer");
  await page.getByLabel(/Industries/).fill("Fintech");
  await page.getByLabel(/Years of experience/).fill("7");
  await page.getByLabel(/Price per session/).fill("15000");
  await shot("1-filled-with-a-short-bio");
  await submitAndSettle(page, () => page.locator("form", { has: page.getByLabel(/Display name/) }).locator("button[type=submit]").click());
  await expect(page.getByText(/at least 80/i).last()).toBeVisible({ timeout: 15_000 });
  await shot("2-error-after-settling");
  await expectStaysFor(async () => ({ name: await page.getByLabel(/Display name/).inputValue(), bio: ((await page.getByRole("textbox", { name: /Bio/ }).innerText()) || "").trim(), roles: await page.getByLabel(/Roles you can speak to/).inputValue(), industries: await page.getByLabel(/Industries/).inputValue(), years: await page.getByLabel(/Years of experience/).inputValue(), price: await page.getByLabel(/Price per session/).inputValue() }), { name: `QA Applicant ${tag}`, bio: "Too short a bio.", roles: "Product Manager, Engineer", industries: "Fintech", years: "7", price: "15000" }, "after a refused application every typed value stays in the form, throughout");
  const { count } = await admin.from("mentor_profiles").select("user_id", { count: "exact", head: true }).eq("user_id", testUser.id);
  expect(count, "nothing was saved").toBe(0);
});
