/**
 * The scholarship detail page is public; the list behind it is not.
 *
 * ── WHY THIS PAGE EXISTS ──────────────────────────────────────────────────
 *
 * There was no detail route at all before this: every listing lived only as
 * a card on the authenticated /scholarships feed, so "fully funded
 * scholarships for Nigerians"-class search queries had nothing of
 * Talentrah's to rank. The scholarship-side equivalent of #152's
 * /jobs/[id], and following the same shape deliberately — see
 * e2e/public-job-page.spec.ts, which this file mirrors test-for-test where
 * the two surfaces genuinely match, and diverges where they don't (there is
 * no in-app "apply" for a scholarship — the official page is always where
 * that happens, and the account-gated actions are Save and Farah's
 * eligibility check instead).
 *
 * ── THE TEST THAT MATTERS MOST IS THE LAST ONE ────────────────────────────
 *
 * The layout gate in (app)/layout.tsx was already relaxed for /jobs/[id],
 * and this page relies on that SAME relaxation rather than a second one —
 * so the risk is not "does the gate exist" but "does something under (app)
 * quietly start depending on the layout for protection it does not have".
 * Re-asserted here, independently of the jobs file, because a regression
 * that broke this list without breaking the jobs one should still be caught.
 *
 * A fixed scholarship id is used deliberately, matching the job test's own
 * reasoning: it is a verified listing with a real host institution and a
 * dated deadline, so the assertions test the wiring rather than whichever
 * listing happens to sort first.
 */
import { test, expect, type Page } from "@playwright/test";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
const SCHOLARSHIP = "6082edbd-bab1-4462-830e-8d40a6572463"; // Gates Cambridge Scholarship

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password").fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
}

test("signed OUT: reads the listing, cannot act, gets no JSON-LD", async ({ page }) => {
  const res = await page.goto(`/scholarships/${SCHOLARSHIP}`);
  expect(res?.status(), "signed-out request must not redirect").toBe(200);
  expect(page.url()).toContain(`/scholarships/${SCHOLARSHIP}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Gates Cambridge Scholarship");
  await expect(
    page.getByRole("link", { name: "Create a free account to save this scholarship" }),
  ).toBeVisible();
  // The official-source link is not gated — it is the point of the page.
  await expect(page.getByRole("link", { name: /View the official listing/ })).toBeVisible();
  // Farah's actions and the save control are authenticated-only.
  await expect(page.getByRole("button", { name: /Check my eligibility/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save this scholarship" })).toHaveCount(0);
  await expect(page.getByTestId("farah-panel")).toHaveCount(0);
  /*
   * No structured data, deliberately — checked against Google's current
   * documentation rather than shipped on memory: there is no
   * scholarship-specific rich result type in Google's structured data
   * gallery (checked 2026-09-01; the education-adjacent entries are Course
   * list and Education Q&A, neither of which fits a funding programme). See
   * docs/scholarship-sources.md for the record of that check.
   */
  expect(await page.locator('script[type="application/ld+json"]').count()).toBe(0);
});

test("the save CTA routes to signup and comes back", async ({ page }) => {
  await page.goto(`/scholarships/${SCHOLARSHIP}`);
  await page.getByRole("link", { name: "Create a free account to save this scholarship" }).click();
  await page.waitForURL("**/signup**");
  expect(decodeURIComponent(page.url())).toContain(`redirectTo=/scholarships/${SCHOLARSHIP}`);
});

test("a pending listing 404s exactly like a nonexistent one", async ({ page, request }) => {
  /*
   * The two cases — "no such id" and "not yours to see" — must not be
   * distinguishable, or the 404 itself becomes a way to enumerate real ids.
   * RLS is what makes this true (0084): the page issues the same query
   * either way and never learns which case it is in.
   */
  const pendingRes = await request.get("/scholarships/b35f9bbf-5497-4f50-969f-6437dbd473e0", {
    maxRedirects: 0,
  });
  const missingRes = await request.get("/scholarships/00000000-0000-0000-0000-000000000000", {
    maxRedirects: 0,
  });
  expect(pendingRes.status(), "a pending listing must 404, not redirect or 200").toBe(404);
  expect(missingRes.status()).toBe(404);
});

test("signed IN: the account-gated controls are back and nothing regressed", async ({ page }) => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set");
  await login(page);
  await page.goto(`/scholarships/${SCHOLARSHIP}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Gates Cambridge Scholarship");
  await expect(
    page.getByRole("link", { name: "Create a free account to save this scholarship" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("farah-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: /Check my eligibility/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Draft my personal statement/ })).toBeVisible();
  /*
   * Two legitimate signed-in states for the save control, not one: it may
   * read "Save this scholarship" or "Remove from saved scholarships"
   * depending on whether the demo account already saved this listing.
   */
  const save = page.getByRole("button", { name: "Save this scholarship" });
  const saved = page.getByRole("button", { name: "Remove from saved scholarships" });
  expect((await save.count()) + (await saved.count()), "no save affordance found").toBeGreaterThan(
    0,
  );
});

test("other app routes, including the scholarships list, still require a session", async ({
  page,
}) => {
  // The layout gate is shared; each page's own requireUser must still hold.
  for (const path of ["/scholarships", "/jobs", "/tracker", "/settings", "/billing"]) {
    await page.goto(path);
    expect(page.url(), `${path} did not redirect a signed-out visitor`).toContain("/login");
  }
});
