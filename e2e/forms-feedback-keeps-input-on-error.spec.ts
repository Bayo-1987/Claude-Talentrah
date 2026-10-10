/**
 * Forms sweep (QA, owner rule 8 Oct): /feedback (signed in, minted session). Rule: complete it twice in a row, then once with a deliberate error.
 *  - an error (message under 10 characters, refused by the server) keeps what was typed: the category and the message are still there;
 *  - a good message is sent (thank-you shown) and the next visit to the form starts clean; a second good message is sent;
 *  - both rows are in the database for this user. Screenshots at each step.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin, seedBaseResume } from "./fixtures/authed";

test("/feedback: an error keeps the input, and two sends in a row each start clean", async ({ authedPage: page, testUser }, info) => {
  test.setTimeout(90_000);
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await seedBaseResume(testUser.id);
  const tag = randomUUID().slice(0, 6);
  const category = page.getByLabel("What's this about?");
  const message = page.getByLabel("Tell us what happened");

  // Deliberate error first: too short for the server.
  await page.goto("/feedback");
  await category.selectOption({ index: 1 });
  const picked = await category.inputValue();
  await message.fill("too short");
  await page.locator("form", { has: page.getByLabel("Tell us what happened") }).locator("button[type=submit]").click();
  await expect(page.getByText(/at least 10 characters/i)).toBeVisible({ timeout: 15_000 });
  await shot("1-short-message-error");
  await expect(category, "the category is kept").toHaveValue(picked);
  await expect(message, "the message is kept").toHaveValue("too short");

  // First good send.
  await message.fill(`QA sweep feedback one ${tag}: an automated form-rule check, please ignore.`);
  await page.locator("form", { has: page.getByLabel("Tell us what happened") }).locator("button[type=submit]").click();
  await expect(page.getByText(/that's with us/i)).toBeVisible({ timeout: 15_000 });
  await shot("2-first-send-thanks");

  // The next visit starts clean, and a second good send works.
  await page.goto("/feedback");
  await expect(page.getByLabel("Tell us what happened")).toHaveValue("");
  await expect(page.getByLabel("What's this about?")).toHaveValue("");
  await page.getByLabel("What's this about?").selectOption({ index: 1 });
  await page.getByLabel("Tell us what happened").fill(`QA sweep feedback two ${tag}: an automated form-rule check, please ignore.`);
  await page.locator("form", { has: page.getByLabel("Tell us what happened") }).locator("button[type=submit]").click();
  await expect(page.getByText(/that's with us/i)).toBeVisible({ timeout: 15_000 });
  await shot("3-second-send-thanks");

  const { data: rows } = await admin.from("feedback").select("message").eq("user_id", testUser.id);
  expect(rows?.map((r) => r.message).sort()).toEqual([`QA sweep feedback one ${tag}: an automated form-rule check, please ignore.`, `QA sweep feedback two ${tag}: an automated form-rule check, please ignore.`]);
});
