import { test, expect } from "@playwright/test";

/**
 * CLAUDE.md fixes a >=40x40px minimum on every interactive element, and
 * records it as a bug this project has already shipped: "icon glyph sized !=
 * clickable area sized".
 *
 * This spec measures rather than reads. That distinction is the reason it
 * exists: the feed's skill-facet row already carried `min-h-10` and still
 * failed, because 40px of height says nothing about width and "sql (38)"
 * came out 39.1px wide. A test that asserted the class would have passed on
 * it. Only `getBoundingClientRect()` catches that.
 *
 * Measured before the fix, at a 1440px viewport:
 *
 *   Work type   Remote 41.4x18.8  Hybrid 35.3x18.8  Onsite 33.7x18.8
 *   Seniority   Entry 28.1x18.8   Lead 25.2x18.8    Executive 49.5x18.8
 *               Mid-level 47.6x18.8   Senior 34.9x18.8
 *   Facet       sql (38) 39.1x40
 *   FilterChip  x button 16x16
 */
const MIN = 40;

type Undersized = { where: string; text: string; w: number; h: number };

test("the design system's own chips have real remove targets", async ({ page }) => {
  // /dev/design-check is ungated and is where FilterChip's removable variant
  // actually renders — the feed's applied filters are their own links now.
  await page.goto("/dev/design-check");

  const found = await page.evaluate((min) => {
    const buttons = [...document.querySelectorAll('button[aria-label^="Remove "]')];
    return {
      count: buttons.length,
      undersized: buttons
        .map((b) => {
          const r = b.getBoundingClientRect();
          return {
            where: "FilterChip",
            text: b.getAttribute("aria-label") ?? "",
            w: Math.round(r.width * 10) / 10,
            h: Math.round(r.height * 10) / 10,
          };
        })
        .filter((m) => m.w < min || m.h < min),
    };
  }, MIN);

  // Guard against a vacuous pass: an empty page has no undersized targets.
  expect(found.count).toBeGreaterThan(0);
  expect<Undersized[]>(found.undersized).toEqual([]);
});

test("every filter link on the feed is at least 40x40", async ({ page }) => {
  const password = process.env.DEMO_PASSWORD;
  test.skip(!password, "DEMO_PASSWORD is not set — see scripts/seed.ts");

  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");

  // Apply one of each so the merged control's segments are measured too.
  await page.goto("/jobs?tab=recommended&workType=remote&seniority=senior");
  await page.getByText("Work type:").waitFor();

  const found = await page.evaluate((min) => {
    const rows = ["Work type:", "Seniority:", "Mentioned in the job text:"];
    const links: { where: string; el: Element }[] = [];

    for (const label of rows) {
      const span = [...document.querySelectorAll("span")].find(
        (s) => s.textContent?.trim() === label,
      );
      for (const a of span?.parentElement?.querySelectorAll("a") ?? []) {
        links.push({ where: label, el: a });
      }
    }

    // The merged applied-filter control.
    const control = [...document.querySelectorAll("div")].find(
      (d) => typeof d.className === "string" && d.className.includes("border-[1.5px]"),
    );
    for (const a of control?.querySelectorAll("a") ?? []) {
      links.push({ where: "applied filters", el: a });
    }

    return {
      count: links.length,
      undersized: links
        .map(({ where, el }) => {
          const r = el.getBoundingClientRect();
          return {
            where,
            text: (el.textContent ?? "").trim().slice(0, 30),
            w: Math.round(r.width * 10) / 10,
            h: Math.round(r.height * 10) / 10,
          };
        })
        .filter((m) => m.w < min || m.h < min),
    };
  }, MIN);

  // The work-type and seniority rows are unconditional, so anything below
  // eight links means the selectors stopped finding the rows rather than the
  // rows passing.
  expect(found.count).toBeGreaterThanOrEqual(8);
  expect<Undersized[]>(found.undersized).toEqual([]);
});
