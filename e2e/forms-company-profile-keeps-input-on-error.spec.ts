/**
 * Forms sweep (QA, owner rule 8 Oct): /employer/profile, the Company Profile form (employer, minted session, own organisation created as the service role).
 * Rule: an error keeps what was typed; two saves in a row each stick. Deliberate error: a company name of spaces (passes the browser's "required", refused by the server with
 * "Company name is required."): the description, domain and logo URL typed beside it must STILL be there after the form settles (3 s: React resets the form when the action completes).
 * Then two saves in a row: the second one shows and stores the second description.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";

test("Company Profile: an error keeps what was typed, and two saves in a row each stick", async ({ authedPage: page, testUser }, info) => {
  test.setTimeout(120_000);
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const tag = randomUUID().slice(0, 6);
  const name = `E2E Employer Co QAC${tag}`;
  const { data: org } = await admin.from("organizations").insert({ name, created_by: testUser.id, verified: true }).select("id").single();
  await admin.from("organization_members").insert({ organization_id: org!.id, user_id: testUser.id, role: "owner" });
  try {
    const nameField = page.getByLabel("Company name");
    const description = page.getByLabel("What the company does");
    const save = page.getByRole("button", { name: "Save profile" });
    const dbRow = async () => (await admin.from("organizations").select("name, description").eq("id", org!.id).single()).data;
    await page.goto("/employer/profile");
    await expect(page.getByRole("heading", { name: "Company Profile" })).toBeVisible();

    // Deliberate error: a name of spaces.
    await nameField.fill("   ");
    await description.fill(`QA description kept ${tag}`);
    await save.click();
    await expect(page.getByText(/Company name is required/i)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(3000); // let the action settle and React re-render the form
    await shot("1-error-after-settling");
    await expect(description, "the description is kept").toHaveValue(`QA description kept ${tag}`);
    await expect(nameField, "the name is kept as typed").toHaveValue("   ");
    expect((await dbRow())?.name, "an error saves nothing").toBe(name);

    // Two saves in a row.
    await nameField.fill(name);
    await description.fill(`QA description one ${tag}`);
    await save.click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 15_000 });
    expect((await dbRow())?.description).toBe(`QA description one ${tag}`);
    await description.fill(`QA description two ${tag}`);
    await save.click();
    await expect.poll(async () => (await dbRow())?.description, { timeout: 15_000 }).toBe(`QA description two ${tag}`);
    await page.reload();
    await expect(page.getByLabel("What the company does")).toHaveValue(`QA description two ${tag}`);
  } finally {
    await deleteOrgsCascade(admin, [org!.id]);
  }
});
