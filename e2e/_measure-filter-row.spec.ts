import { test, type Page } from "@playwright/test";

/**
 * TEMPORARY diagnostic — not part of the suite, deleted before this PR is
 * finalized. Measures the desktop filter row's own rendered width at three
 * viewports, to replace a guess with a number before deciding where the row
 * actually needs to collapse.
 */

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password").fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
}

test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set");

for (const width of [901, 1024, 1280]) {
  test(`measure filter row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const row = [...document.querySelectorAll("div")].find(
        (d) => d.className.includes("min-[901px]:flex") && d.className.includes("flex-nowrap"),
      );
      const doc = document.documentElement;
      if (!row) return { found: false };
      const r = row.getBoundingClientRect();
      const parent = row.parentElement?.getBoundingClientRect();
      return {
        found: true,
        rowWidth: r.width,
        parentWidth: parent?.width ?? null,
        docClientWidth: doc.clientWidth,
        docScrollWidth: doc.scrollWidth,
      };
    });
    console.log(`WIDTH=${width} RESULT=${JSON.stringify(result)}`);
  });
}
