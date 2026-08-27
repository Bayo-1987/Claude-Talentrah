import { test, expect } from "@playwright/test";

/**
 * Reading a job in full.
 *
 * There was no route for this at all. The feed hard-truncated every
 * description at 280 characters and the card title was not a link, so an
 * internal posting — which has no source site to be sent to — could not be
 * read past that slice by any means.
 *
 * The load-bearing assertion is the LAST one: the score on the detail page
 * equals the score on the card. Both go through computeAndStoreMatchScores, and
 * the moment one of them recomputes differently the product is telling a
 * seeker two different things about the same job.
 */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

if (process.env.CI && !DEMO_PASSWORD) {
  // A skip must not read as a pass on the summary line.
  throw new Error("job-detail spec cannot run in CI: DEMO_PASSWORD is not set");
}

test.use({ viewport: { width: 1280, height: 950 } });

test.beforeEach(async ({ page }) => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password").fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
});

test("the card title opens the job, and the job is not truncated there", async ({ page }) => {
  const title = page.locator("h3 a").first();
  await expect(title).toBeVisible();

  const label = (await title.textContent())!.trim();
  const href = await title.getAttribute("href");
  expect(href).toMatch(/^\/jobs\/[0-9a-f-]{36}$/);

  const cardDescription = (await page.locator("p.line-clamp-3").first().textContent())!.trim();

  await title.click();
  await page.waitForURL("**/jobs/**");

  await expect(page.locator("h1")).toHaveText(label);

  const full = (await page.locator("div.whitespace-pre-line").first().textContent())!.trim();
  // The card slices at 280. Anything at or below that means the page is
  // rendering the same truncation it exists to undo.
  expect(full.length).toBeGreaterThan(cardDescription.length);
  expect(full.length).toBeGreaterThan(280);
  expect(full).toContain(cardDescription.slice(0, 100));
});

test("a job that does not exist is a 404, not a blank page", async ({ page }) => {
  // Also the answer for a posting RLS hides — an unverified company's listing
  // (0027) or a removed one (0056). Distinguishing "no such job" from "not
  // yours to see" would itself leak which ids exist.
  const res = await page.goto("/jobs/00000000-0000-0000-0000-000000000000");
  expect(res?.status()).toBe(404);
});

test("the detail page names the job in the tab title", async ({ page }) => {
  const title = page.locator("h3 a").first();
  const label = (await title.textContent())!.trim();
  const href = (await title.getAttribute("href"))!;

  // Navigated directly rather than clicked: generateMetadata runs on the
  // server, and a client-side navigation swaps document.title only after
  // hydration — so clicking would race the assertion rather than test it.
  await page.goto(href);
  expect(await page.title()).toContain(label);
});

test("the match score on the page agrees with the one on the card", async ({ page }) => {
  // Walk up from the title link to the card that contains it and read the
  // percentage out of that card's own text — no xpath, no assumption about
  // where the badge sits relative to the heading.
  const found = await page.evaluate(() => {
    const link = document.querySelector("h3 a") as HTMLAnchorElement | null;
    if (!link) return null;
    let el: HTMLElement | null = link;
    while (el && !/[0-9]+%/.test(el.innerText)) el = el.parentElement;
    return {
      href: link.getAttribute("href"),
      pct: el ? (el.innerText.match(/([0-9]+)%/) ?? [])[1] ?? null : null,
    };
  });
  expect(found?.pct, "the card should show a percentage").toBeTruthy();

  await page.goto(found!.href!);
  const onPage = await page.evaluate(
    () => (document.body.innerText.match(/([0-9]+)%/) ?? [])[1] ?? null,
  );

  expect(onPage).toBe(found!.pct);
});
