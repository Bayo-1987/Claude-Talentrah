/**
 * Forms sweep (QA, owner rule 8 Oct): /contact. An error must keep what was typed. Two errors are exercised:
 *  1. a server-side validation error (an email the server refuses): every field keeps its value;
 *  2. the page's "not wired up yet" error, which is what a valid submit returns wherever RESEND_API_KEY is not set (local stack and CI): every field keeps its value.
 * If the environment does have a mail key the second submit succeeds and shows the thank-you message, which is also accepted (nothing is asserted about the mail). The
 * twice-clean half of the rule (a SUCCESS followed by a fresh form) needs a mail stub and is NOT covered here. No password field. Screenshots at each step.
 */
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";

const tag = randomUUID().slice(0, 6);
const typed = { name: `QA Sweep ${tag}`, email: "a@b", topic: "Report a bug", message: `QA sweep message ${tag}: please ignore, an automated form-rule check.` };

async function expectKept(page: Page, email: string) {
  await expect(page.getByLabel("Your name")).toHaveValue(typed.name);
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
  await expect(page.getByLabel("Topic")).toHaveValue(typed.topic);
  await expect(page.getByLabel("Message")).toHaveValue(typed.message);
}

test("/contact keeps everything typed after a server validation error and after the 'not wired up' error", async ({ page }, info) => {
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await page.goto("/contact");
  await page.getByLabel("Your name").fill(typed.name);
  await page.getByLabel("Email", { exact: true }).fill(typed.email);
  await page.getByLabel("Topic").selectOption(typed.topic);
  await page.getByLabel("Message").fill(typed.message);
  await shot("1-filled-with-a-bad-email");
  await page.getByRole("button", { name: /send/i }).click();
  await expect(page.getByText(/email/i).filter({ hasText: /valid|invalid|enter/i }).first()).toBeVisible({ timeout: 15_000 });
  await shot("2-validation-error");
  await expectKept(page, typed.email);

  const good = `qa-sweep-${tag}@example.com`;
  await page.getByLabel("Email", { exact: true }).fill(good);
  await page.getByRole("button", { name: /send/i }).click();
  const thanks = page.getByText(/your message is on its way/i);
  const notWired = page.getByText(/isn't wired up yet|Something went wrong sending/i);
  await expect(thanks.or(notWired)).toBeVisible({ timeout: 15_000 });
  await shot("3-after-valid-submit");
  if (await notWired.isVisible()) await expectKept(page, good);
});
