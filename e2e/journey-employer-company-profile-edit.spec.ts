/**
 * QA journey (UNRUN when written: authored on a machine with no local stack, CI is its first run).
 *
 * An employer edits their own Company Profile through the page: onboarding creates the company, the masthead's "Company Profile" link opens it, the
 * description is typed and saved, "Saved." appears, and the text is still there after a reload. No job is posted and no candidate is contacted.
 * Every step is clicked or typed and screenshotted (attached to the test report). The company is named "E2E Employer Co …" so the same cleanup
 * employer.spec.ts uses removes it. Starts from the minted session in ./fixtures/authed; the sign-in-through-the-page journeys are in journey-human-sign-in.
 */
import { test, expect, admin } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";

test.use({ viewport: { width: 1280, height: 900 } });

test.afterEach(async () => {
  await runCleanups([
    "employer organisations (QA journey)",
    async () => {
      const { data: orgs, error } = await admin.from("organizations").select("id").like("name", "E2E Employer Co%");
      if (error) throw new Error(`listing organisations: ${error.message}`);
      await deleteOrgsCascade(admin, (orgs ?? []).map((o) => o.id));
    },
  ]);
});

test("an employer edits the Company Profile description and it is still there after a reload", async ({ authedPage: page, testUser }, info) => {
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  await page.goto("/employer");
  await expect(page).toHaveURL(/\/employer\/onboarding$/);
  await page.getByLabel("Company name").fill(`E2E Employer Co ${testUser.id.slice(0, 8)}`);
  await page.getByLabel("Company website domain").fill("e2e-employer.example");
  await shot("1-onboarding-filled");
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/employer\/jobs$/);

  // Reach the profile the way a person does: the masthead link, not the address bar.
  await page.getByRole("link", { name: "Company Profile" }).first().click();
  await expect(page).toHaveURL(/\/employer\/profile$/);
  await expect(page.getByRole("heading", { name: "Company Profile" })).toBeVisible();
  await expect(page.getByText("Unverified", { exact: true })).toBeVisible();
  await shot("2-company-profile");

  const about = `We build payment tools for small merchants. QA ${testUser.id.slice(0, 6)}`;
  await page.getByLabel("What the company does").fill(about);
  await shot("3-description-typed");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await shot("4-saved");

  await page.reload();
  await expect(page.getByLabel("What the company does")).toHaveValue(about);
  await shot("5-after-reload");

  // Nothing was posted by this journey.
  await page.getByRole("link", { name: "Jobs Posted" }).first().click();
  await expect(page).toHaveURL(/\/employer\/jobs$/);
  await expect(page.getByText("0 applications")).toHaveCount(0);
});
