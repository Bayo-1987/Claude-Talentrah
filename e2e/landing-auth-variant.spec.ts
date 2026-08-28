import { test, expect } from "@playwright/test";

/**
 * The landing page is static; the hero's signed-in variant is resolved in the
 * browser.
 *
 * WHY THIS EXISTS. `/` used to read the auth cookie in a Server Component,
 * which opts the WHOLE route into dynamic rendering — the FAQ, the footer and
 * the board preview were all re-rendered per request so that one caption could
 * differ. Moving the check into the client component that already consumed it
 * makes the page prerenderable, and the risk it introduces is that the
 * signed-in variant silently stops working. Both states are asserted here, not
 * just the common one.
 */

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

if (process.env.CI && !DEMO_PASSWORD) {
  throw new Error("landing-auth-variant spec cannot run in CI: DEMO_PASSWORD is not set");
}

const SIGNED_OUT = /No account needed/i;
const SIGNED_IN = /Tailored against your saved resume/i;

test("a signed-out visitor gets the anonymous hero", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("jd-demo-caption")).toHaveText(SIGNED_OUT);
});

test("a signed-in visitor gets the signed-in hero", async ({ page }) => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password").fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");

  await page.goto("/");
  /*
   * The static HTML ships the signed-out copy and the client swaps it once the
   * session resolves, so this waits rather than reading the first paint. That
   * IS the trade this change makes, and asserting it here is what keeps it a
   * known one instead of a surprise.
   */
  await expect(page.getByTestId("jd-demo-caption")).toHaveText(SIGNED_IN);
});

test("the page's HTML is the same for both — the difference is client-side", async ({ page }) => {
  /*
   * The point of the change, pinned. If the server ever starts varying this
   * markup again the route stops being cacheable, and nothing else here would
   * notice.
   */
  const anonymous = await (await page.request.get("/")).text();
  expect(anonymous).toContain("No account needed");
  expect(anonymous).not.toContain("Tailored against your saved resume");
});
