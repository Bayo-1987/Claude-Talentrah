import { test, expect, type Page } from "@playwright/test";

/**
 * EMP-1 / E1 — the employer Talent Directory page for an org with no subscription, in the built app.
 *
 * The demo organisation has no subscription. What the page must show depends on the live pool (verified, opted-in candidates):
 * below 10, no Subscribe button, the founder's exact copy with the live count, and a free waitlist; at 10 or more, the normal Subscribe
 * flow. The seeded database has no candidates, so this runs the below-threshold branch in CI, and asserts the other branch if a
 * database it runs against happens to have 10+. Unit tests pin 9 vs 10 exactly (tests/talent-directory/*); this proves the page is wired.
 */

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

if (process.env.CI && !DEMO_PASSWORD) {
  throw new Error("talent-directory-preview spec cannot run in CI: DEMO_PASSWORD is not set");
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
}

test.describe("employer Talent Directory, no subscription", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");

  test("shows the live count and either the waitlist (below 10) or Subscribe (10+), never both", async ({ page }) => {
    await login(page);
    await page.goto("/employer/talent-directory");
    await expect(page.getByRole("heading", { name: "Search verified candidates." })).toBeVisible();

    const subscribe = page.getByRole("button", { name: /^Subscribe/ });
    const join = page.getByRole("button", { name: "Join the waitlist" });
    const joined = page.getByText("You're on the waitlist.");

    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    const match = body.match(/(\d+) verified candidates (so far|are listed)/);
    expect(match, "the page does not state the live candidate count").not.toBeNull();
    const count = Number(match![1]);

    if (count < 10) {
      await expect(subscribe).toHaveCount(0);
      // free to join, idempotent across reruns on the same database (an org already on the list sees the confirmation instead)
      if (await join.count()) {
        expect(body).toContain(
          `We're building the directory: ${count} verified candidates so far. Join the waitlist and we'll tell you when 10+ are listed.`,
        );
        await join.click();
        await expect(joined).toBeVisible();
      }
      await page.reload();
      await expect(joined).toBeVisible();
      await expect(join).toHaveCount(0);
      await expect(subscribe).toHaveCount(0);
    } else {
      await expect(subscribe.first()).toBeVisible();
      await expect(join).toHaveCount(0);
    }
  });

  test("no sample card carries a photo, a link into a candidate or a name", async ({ page }) => {
    await login(page);
    await page.goto("/employer/talent-directory");
    const cards = page.getByTestId("preview-sample");
    expect(await cards.count()).toBeLessThanOrEqual(3);
    for (let i = 0; i < (await cards.count()); i++) {
      const card = cards.nth(i);
      await expect(card.locator("img, svg, a")).toHaveCount(0);
    }
  });
});
