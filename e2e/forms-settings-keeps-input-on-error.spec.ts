/**
 * Forms sweep (QA, owner rule 8 Oct): /settings (signed in, minted session). The rule: an error keeps what was typed; two saves in a row work.
 *  - deliberate error: a first name with no visible characters is refused by the server; the last name and country the person chose are STILL in the form, and so is the
 *    first name as typed;
 *  - save one: a name change is saved and the form shows it; save two straight after with a different name: also saved, and the database holds the second one only.
 * Settings keeps showing the saved values on purpose (it is an edit form, not an add form), so "starts clean" here means "shows the latest saved values, nothing stale".
 */
import { test, expect, admin, seedBaseResume } from "./fixtures/authed";
import { submitAndSettle, expectStaysFor } from "./support/form-keeps";

test("/settings: an error keeps what was typed, and two saves in a row each stick", async ({ authedPage: page, testUser }, info) => {
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await seedBaseResume(testUser.id);
  const first = page.getByLabel("First name");
  const last = page.getByLabel("Last name");
  const country = page.getByLabel("Country");
  const save = page.getByRole("button", { name: "Save changes" });
  const dbRow = async () => (await admin.from("profiles").select("first_name, last_name, country").eq("id", testUser.id).single()).data;

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Your profile" })).toBeVisible();

  // Deliberate error: no visible characters in the first name.
  await first.fill("   ");
  await last.fill("QASurnameKept");
  await country.selectOption("Kenya");
  await submitAndSettle(page, () => save.click());
  await expect(page.getByText(/at least one visible character|Check the highlighted|isn.t valid|required/i).first()).toBeVisible({ timeout: 15_000 });
  await shot("1-error-shown");
  await expectStaysFor(async () => ({ first: await first.inputValue(), last: await last.inputValue(), country: await country.inputValue() }), { first: "   ", last: "QASurnameKept", country: "Kenya" }, "after a refused save the typed values stay in the form, throughout");
  expect((await dbRow())?.last_name, "an error saves nothing").not.toBe("QASurnameKept");

  // Save one.
  await first.fill("QAFirstOne");
  await save.click();
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 15_000 });
  expect(await dbRow()).toMatchObject({ first_name: "QAFirstOne", last_name: "QASurnameKept", country: "Kenya" });
  await expect(first).toHaveValue("QAFirstOne");
  await shot("2-first-save");

  // Save two, straight after.
  await first.fill("QAFirstTwo");
  await country.selectOption("Nigeria");
  await save.click();
  await expect.poll(async () => (await dbRow())?.first_name, { timeout: 15_000 }).toBe("QAFirstTwo");
  expect((await dbRow())?.country).toBe("Nigeria");
  await page.reload();
  await expect(first).toHaveValue("QAFirstTwo");
  await expect(country).toHaveValue("Nigeria");
  await shot("3-second-save-after-reload");
});
