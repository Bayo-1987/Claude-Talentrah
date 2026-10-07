/**
 * HWR-2: on an info page (here /how-we-review-resumes) a signed-in visitor sees ONE "Go to your dashboard" button instead of "Log in" and "Get started for free", and clicking it
 * lands on their own home: a seeker on /jobs, an employer (a member of an organisation) on the employer jobs page. A signed-out visitor still sees the two auth buttons and no
 * dashboard link. The session is read in the browser after hydration, so the first assertion waits for the swap rather than expecting it on first paint. Minted-session fixture;
 * the employer's company is named "E2E Employer Co …" so the same cleanup the other employer specs use removes it.
 */
import { test, expect, admin } from "./fixtures/authed";
import { test as base, expect as baseExpect } from "@playwright/test";
import { runCleanups } from "../tests/support/teardown";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";

test.use({ viewport: { width: 1280, height: 900 } });

test.afterEach(async () => {
  await runCleanups([
    "employer organisations (masthead dashboard button)",
    async () => {
      const { data: orgs, error } = await admin.from("organizations").select("id").like("name", "E2E Employer Co%");
      if (error) throw new Error(`listing organisations: ${error.message}`);
      await deleteOrgsCascade(admin, (orgs ?? []).map((o) => o.id));
    },
  ]);
});

test("a signed-in seeker on How we review sees one dashboard button, and it goes to /jobs", async ({ authedPage: page }) => {
  await page.goto("/how-we-review-resumes");
  const dashboard = page.getByRole("link", { name: "Go to your dashboard" });
  await expect(dashboard).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Get started for free" })).toHaveCount(0);
  await dashboard.click();
  await expect(page).toHaveURL(/\/jobs$/);
});

test("a signed-in employer on How we review sees the same button, and it goes to the employer home", async ({ authedPage: page, testUser }) => {
  await page.goto("/employer");
  await expect(page).toHaveURL(/\/employer\/onboarding$/);
  await page.getByLabel("Company name").fill(`E2E Employer Co ${testUser.id.slice(0, 8)}`);
  await page.getByLabel("Company website domain").fill("e2e-employer.example");
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/employer\/jobs$/);

  await page.goto("/how-we-review-resumes");
  const dashboard = page.getByRole("link", { name: "Go to your dashboard" });
  await expect(dashboard).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" })).toHaveCount(0);
  await dashboard.click();
  await expect(page).toHaveURL(/\/employer\/jobs$/);
});

base("a signed-out visitor still sees Log in and Get started for free, and no dashboard link", async ({ page }) => {
  await page.goto("/how-we-review-resumes");
  await baseExpect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  await baseExpect(page.getByRole("link", { name: "Get started for free" })).toBeVisible();
  await baseExpect(page.getByRole("link", { name: "Go to your dashboard" })).toHaveCount(0);
});
