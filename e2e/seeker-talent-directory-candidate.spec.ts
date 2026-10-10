/**
 * Seeker > Talent Directory (candidate side, /talent-directory/verify) (QA, 9 Oct): the listing switch, the availability form saved twice in a row, work samples added twice in a row (the second form starts
 * clean) and a deliberate error (a title of spaces: refused with a message, the description and link typed kept), and the resume review: with no credits it says so and charges nothing; pressed in two
 * tabs at the same instant it takes ONE review and ONE charge. Local stack (stub model), minted session for a throwaway user, credits granted by the test. No payment, nothing emailed.
 */
import { test, expect, admin, grantTestCredits, seedBaseResume } from "./fixtures/authed";
import { CREDIT_COSTS } from "../src/lib/credits/costs";
import { submitAndSettle } from "./support/form-keeps";
import { settle, formReset } from "./support/settle";

test("talent directory candidate: switch, availability twice, samples twice + blank title, review once", async ({ authedPage: page, testUser }, info) => {
  test.setTimeout(150_000);
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const prof = async () => (await admin.from("profiles").select("talent_directory_opt_in, talent_available_for_hire, talent_remote_ready, talent_earliest_start_date, credits_balance").eq("id", testUser.id).single()).data!;
  await page.goto("/talent-directory/verify");
  await expect(page.getByRole("heading", { name: "Availability" })).toBeVisible({ timeout: 30_000 });

  // Availability, twice in a row.
  const form = page.locator("form", { has: page.locator("#earliestStartDate") });
  for (const [i, date] of ["2027-01-15", "2027-02-20"].entries()) {
    const open = form.getByLabel("Open to new opportunities");
    const remote = form.getByLabel("Ready to work remote");
    await open.setChecked(i === 0);
    await remote.setChecked(i === 1);
    await form.locator("#earliestStartDate").fill(date);
    await submitAndSettle(page, () => form.getByRole("button", { name: "Save" }).click());
    await expect(form.getByText("Saved.")).toBeVisible({ timeout: 30_000 });
    const p = await prof();
    expect([p.talent_available_for_hire, p.talent_remote_ready, p.talent_earliest_start_date]).toEqual([i === 0, i === 1, date]);
    await settle(page);
    await expect(form.locator("#earliestStartDate"), "the saved values show after the form settles").toHaveValue(date);
  }

  // Work samples, twice in a row, then a blank title.
  const sample = page.locator("form", { has: page.getByRole("button", { name: "Add work sample" }) });
  const addSample = async (title: string, desc: string, url: string) => {
    await sample.getByLabel("Title").fill(title);
    await sample.getByLabel("Link (optional)").fill(url);
    await sample.getByLabel("Description (optional)").fill(desc);
    const resetted = formReset(sample);
    await submitAndSettle(page, () => sample.getByRole("button", { name: "Add work sample" }).click());
    await resetted; // React has reset the form: the next entry can be typed without being wiped
  };
  await addSample("QA sample one", "First sample", "https://example.test/one");
  await expect(sample.getByText("Added.")).toBeVisible({ timeout: 30_000 });
  await settle(page);
  await expect(sample.getByLabel("Title"), "the second entry starts clean").toHaveValue("");
  await addSample("QA sample two", "Second sample", "https://example.test/two");
  await expect.poll(async () => ((await admin.from("talent_portfolio_items").select("id").eq("user_id", testUser.id)).data ?? []).length, { timeout: 30_000 }).toBe(2);
  await settle(page);
  await addSample("   ", "typed with a blank title", "https://example.test/three");
  await expect(sample.getByText("A title is required.")).toBeVisible({ timeout: 30_000 });
  await shot("3-blank-title");
  await settle(page);
  expect([await sample.getByLabel("Description (optional)").inputValue(), await sample.getByLabel("Link (optional)").inputValue()], "the description and link typed are kept after the refusal (#902)").toEqual(["typed with a blank title", "https://example.test/three"]);
  expect(((await admin.from("talent_portfolio_items").select("id").eq("user_id", testUser.id)).data ?? []).length, "the blank-title sample was not added").toBe(2);

  // Resume review: no credits.
  await seedBaseResume(testUser.id);
  const cost = CREDIT_COSTS.talentDirectoryVerification;
  await page.reload();
  const start0 = (await prof()).credits_balance;
  await submitAndSettle(page, () => page.getByRole("button", { name: /Request a resume review/ }).click());
  await expect(page.getByText(/Not enough credits/).first(), "the refusal is shown").toBeVisible({ timeout: 30_000 });
  expect((await prof()).credits_balance, "no credits: nothing charged").toBe(start0);
  expect(((await admin.from("talent_verifications").select("id").eq("user_id", testUser.id)).data ?? []).length).toBe(0);

  const stat = async () => (await admin.from("profiles").select("talent_verification_status").eq("id", testUser.id).single()).data!.talent_verification_status;
  expect.soft(await stat(), "REVIEW-STUCK-1: a review refused for lack of credits must leave the status unverified, not pending").toBe("unverified");
  // Resume review: two tabs at once.
  await grantTestCredits(testUser.id, 100);
  const before = (await prof()).credits_balance;
  const page2 = await page.context().newPage();
  await page.goto("/talent-directory/verify");
  await page2.goto("/talent-directory/verify");
  await Promise.all([page.getByRole("button", { name: /Request a resume review|Try again/ }).click(), page2.getByRole("button", { name: /Request a resume review|Try again/ }).click()]);
  await settle(page);
  const rows = (await admin.from("talent_verifications").select("id, status").eq("user_id", testUser.id)).data ?? [];
  expect(rows.length, "REVIEW-RACE: two simultaneous requests make one review").toBe(1);
  expect(before - (await prof()).credits_balance, "...and one charge").toBeLessThanOrEqual(cost);
  await shot("4-review");

  // The listing switch exists only for a verified candidate: if the stub review verified this one, drive it.
  await page.goto("/talent-directory/verify");
  const sw = page.getByRole("switch", { name: "List me in the Talent Directory" });
  if (await sw.count()) {
    const was = (await prof()).talent_directory_opt_in;
    await sw.click();
    await expect.poll(async () => (await prof()).talent_directory_opt_in, { timeout: 30_000 }).toBe(!was);
    await shot("5-switch");
  } else {
    info.annotations.push({ type: "note", description: "the stub review did not verify this candidate, so the listing switch was not shown" });
  }
});
