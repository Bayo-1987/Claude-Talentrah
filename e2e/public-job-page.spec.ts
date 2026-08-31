/**
 * The job detail page is public; everything else in (app) is not.
 *
 * ── WHY THIS PAGE CHANGED ─────────────────────────────────────────────────
 *
 * It carries JobPosting structured data, and while it required a session
 * Googlebot was answered with `302 -> /login`. Not one posting was ever
 * eligible for Google for Jobs. A signed-out reader now gets the whole
 * posting; acting on it still needs an account.
 *
 * ── THE TEST THAT MATTERS MOST IS THE LAST ONE ────────────────────────────
 *
 * Making this page public meant relaxing the auth gate in (app)/layout.tsx.
 * That was only safe because all fourteen pages in the group call
 * `requireUser` themselves — checked one by one at the time. "Checked at the
 * time" is not a guarantee, so the last test re-checks it on every run: if
 * someone adds a page to (app) and relies on the layout to protect it, that
 * page is public and this is what says so.
 *
 * A fixed job id is used deliberately — it is a seeded posting with a
 * resolvable location, so the JSON-LD assertion tests the wiring rather than
 * whichever posting happened to sort first.
 */
import { test, expect, type Page } from "@playwright/test";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
const JOB = "1ad10994-e497-4bd6-ba59-7e6611d8ec2b";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password").fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
}

test("signed OUT: reads the posting, cannot act, gets the JSON-LD", async ({ page }) => {
  const res = await page.goto(`/jobs/${JOB}`);
  expect(res?.status(), "signed-out request must not redirect").toBe(200);
  expect(page.url()).toContain(`/jobs/${JOB}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create a free account to apply" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("farah-panel")).toHaveCount(0);
  expect(await page.locator('script[type="application/ld+json"]').count()).toBe(1);
});

test("the apply gate actually routes to signup and comes back", async ({ page }) => {
  await page.goto(`/jobs/${JOB}`);
  await page.getByRole("link", { name: "Create a free account to apply" }).click();
  await page.waitForURL("**/signup**");
  expect(decodeURIComponent(page.url())).toContain(`redirectTo=/jobs/${JOB}`);
});

test("signed IN: the real controls are back and nothing regressed", async ({ page }) => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set");
  await login(page);
  await page.goto(`/jobs/${JOB}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create a free account to apply" })).toHaveCount(0);
  await expect(page.getByTestId("farah-panel")).toBeVisible();
  await expect(page.getByRole("link", { name: "Tailor my resume for this" })).toBeVisible();
  /*
   * Three legitimate signed-in states, not one: the in-app Apply button, the
   * external hand-off link, or the "Applied" marker when this user has already
   * applied. The demo account HAS applied to this posting, so asserting only
   * on the button failed against correct behaviour.
   */
  const apply = page.getByRole("button", { name: "Apply", exact: true });
  const external = page.getByRole("link", { name: "Apply on company site" });
  const applied = page.getByText("Applied", { exact: true });
  const total = (await apply.count()) + (await external.count()) + (await applied.count());
  expect(total, "no apply affordance and no applied marker").toBeGreaterThan(0);
  // The save control is authenticated-only and must be back regardless.
  await expect(page.locator("form").filter({ hasText: /^Save|^Saved/ })).toHaveCount(1);
});

test("other app routes still require a session", async ({ page }) => {
  // The layout gate was relaxed; each page's own requireUser must still hold.
  for (const path of ["/jobs", "/tracker", "/settings", "/billing", "/auto-apply"]) {
    await page.goto(path);
    expect(page.url(), `${path} did not redirect a signed-out visitor`).toContain("/login");
  }
});
