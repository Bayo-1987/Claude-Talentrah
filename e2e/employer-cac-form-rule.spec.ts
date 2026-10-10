/**
 * Company Profile > Verify by CAC registration: the form rule (QA, 9 Oct). Submit twice in a row (the second is a correction and says "Resubmit"; "Submitted." shows each time and the database holds the
 * latest values), then once with a deliberate error (a business name with a blank RC number: whitespace passes the browser's required check, the server refuses it): the error is shown and the business
 * name typed is still there. Local stack only, minted session for a throwaway user, an unverified throwaway organisation removed afterwards.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";
import { submitAndSettle } from "./support/form-keeps";
import { settle, formReset } from "./support/settle";

test("CAC form: submit, resubmit, then a blank RC number keeps the business name", async ({ authedPage: page, testUser }, info) => {
  test.setTimeout(90_000);
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const tag = randomUUID().slice(0, 6);
  const { data: org, error } = await admin.from("organizations").insert({ name: `E2E Employer Co CAC${tag}`, created_by: testUser.id, verified: false }).select("id").single();
  if (error || !org) throw new Error(`fixture org: ${error?.message}`);
  await admin.from("organization_members").insert({ organization_id: org.id, user_id: testUser.id, role: "owner" });
  const row = async () => (await admin.from("organizations").select("cac_number, cac_business_name").eq("id", org.id).single()).data;
  try {
    await page.goto("/employer/profile");
    const biz = page.getByLabel("Registered business name");
    const rc = page.getByLabel("RC number");
    await biz.fill(`QA Ltd ${tag}`);
    await rc.fill(`RC${tag}1`);
    await submitAndSettle(page, () => page.getByRole("button", { name: "Submit for review" }).click());
    await expect(page.getByText("Submitted. An admin will confirm")).toBeVisible({ timeout: 30_000 });
    await shot("1-first-submit");
    expect(await row()).toEqual({ cac_number: `RC${tag}1`, cac_business_name: `QA Ltd ${tag}` });

    await settle(page);
    await biz.fill(`QA Ltd corrected ${tag}`);
    await rc.fill(`RC${tag}2`);
    const resetted = formReset(page.locator("form", { has: biz }));
    await submitAndSettle(page, () => page.getByRole("button", { name: /Resubmit|Submit for review/ }).click());
    await expect.poll(async () => (await row())?.cac_number, { timeout: 30_000 }).toBe(`RC${tag}2`);
    expect(await row()).toEqual({ cac_number: `RC${tag}2`, cac_business_name: `QA Ltd corrected ${tag}` });
    await resetted; // React has reset the form: typing now is not wiped

    // Deliberate error: a business name typed, the RC number blank (spaces).
    await biz.fill(`QA Ltd third ${tag}`);
    await rc.fill("   ");
    await submitAndSettle(page, () => page.getByRole("button", { name: /Resubmit|Submit for review/ }).click());
    await expect(page.getByText("Both the RC number and the registered business name are required.")).toBeVisible({ timeout: 30_000 });
    await shot("3-error");
    await settle(page);
    expect.soft(await biz.inputValue(), "CAC-KEEP-1: the business name typed must stay after the error").toBe(`QA Ltd third ${tag}`);
    expect((await row())?.cac_number, "database untouched by the refused submit").toBe(`RC${tag}2`);
  } finally {
    await deleteOrgsCascade(admin, [org.id]);
  }
});
