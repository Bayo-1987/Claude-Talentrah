import { test, expect, type Page } from "@playwright/test";

/**
 * CLAUDE.md fixes a >=40x40px minimum on every interactive element, and
 * records it as a bug this project has already shipped: "icon glyph sized !=
 * clickable area sized".
 *
 * This spec measures rather than reads. That distinction is the reason it
 * exists: the feed's skill-facet row once carried `min-h-10` and still
 * failed, because 40px of height says nothing about width and "sql (38)"
 * came out 39.1px wide. A test that asserted the class would have passed on
 * it. Only `getBoundingClientRect()` catches that.
 *
 * REWRITTEN for the multi-select filter redesign (0095) — the previous
 * version located elements by literal label text ("Work type:",
 * "Seniority:", "Mentioned in the job text:") that this redesign deleted
 * outright: the labelled always-visible rows are gone, replaced by
 * FilterMenu — a `<details>/<summary>` trigger plus a list of `<a>` items —
 * and the skill-facet row ("Mentioned in the job text:") was removed by
 * this same PR, not merely relabelled. There is no new selector that makes
 * the old assertions true; they tested a concept that no longer exists.
 *
 * COVERAGE THIS VERSION ADDS, which the old one never had: the collapsed
 * `<details>` state below 1140px (filter-bar.tsx's own comment explains why
 * 1140, not the old 901) was entirely untested before — every control this
 * spec now measures at a narrow viewport (the four FilterMenu triggers, and
 * every item inside each one once opened) is new surface, not a
 * continuation of old coverage.
 *
 * Measured before the fix (skill-facet row, since deleted), at a 1440px
 * viewport:
 *
 *   Work type   Remote 41.4x18.8  Hybrid 35.3x18.8  Onsite 33.7x18.8
 *   Seniority   Entry 28.1x18.8   Lead 25.2x18.8    Executive 49.5x18.8
 *               Mid-level 47.6x18.8   Senior 34.9x18.8
 *   Facet       sql (38) 39.1x40
 *   FilterChip  x button 16x16
 *
 * The Work type/Seniority numbers above are historical — that markup is
 * gone — kept only so a reader can see what "reads fine, measures short"
 * looked like the first time this spec caught it. This version's controls
 * (BROWSE_LINK's min-h-10 min-w-10, and FilterMenu's own min-h-10 min-w-10
 * on both the trigger and every item) all measured >=40x40 at rewrite time
 * with no changes needed to filter-bar.tsx or filter-menu.tsx themselves —
 * this spec exists to keep it that way, not because it found a new failure.
 */
const MIN = 40;

type Undersized = { where: string; text: string; w: number; h: number };

async function login(page: Page, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
}

/** Measures every `<a>` inside the element carrying `data-testid="testId"`. */
async function measureLinksIn(page: Page, testId: string, where: string, min: number) {
  return page.evaluate(
    ({ testId, where, min }) => {
      const root = document.querySelector(`[data-testid="${testId}"]`);
      const links = [...(root?.querySelectorAll("a") ?? [])];
      return links
        .map((a) => {
          const r = a.getBoundingClientRect();
          return {
            where,
            text: (a.textContent ?? "").trim().slice(0, 30),
            w: Math.round(r.width * 10) / 10,
            h: Math.round(r.height * 10) / 10,
          };
        })
        .filter((m) => m.w < min || m.h < min);
    },
    { testId, where, min },
  );
}

async function linkCountIn(page: Page, testId: string): Promise<number> {
  return page.evaluate(
    (testId) => document.querySelector(`[data-testid="${testId}"]`)?.querySelectorAll("a").length ?? 0,
    testId,
  );
}

/** Measures a FilterMenu's own `<summary>` trigger by the menu's testid. */
async function measureTrigger(page: Page, testId: string) {
  return page.evaluate((testId) => {
    const root = document.querySelector(`[data-testid="${testId}"]`);
    const summary = root?.querySelector("summary");
    if (!summary) return { where: testId, text: "(not found)", w: 0, h: 0 };
    const r = summary.getBoundingClientRect();
    return {
      where: testId,
      text: (summary.textContent ?? "").trim(),
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
    };
  }, testId);
}

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

test("every filter control on the feed clears the 40x40 hit-target floor", async ({ page }) => {
  const password = process.env.DEMO_PASSWORD;
  test.skip(!password, "DEMO_PASSWORD is not set — see scripts/seed.ts");

  const undersized: Undersized[] = [];
  let count = 0;

  // --- The desktop row (>=1140px): Country's own menu, plus the three
  // plain-link groups (Work type / Seniority / Posted). ---
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, password!);
  await page.goto("/jobs?tab=recommended&workType=remote&seniority=senior");
  await page.getByTestId("filter-bar-desktop").waitFor();

  undersized.push(...(await measureLinksIn(page, "filter-bar-desktop", "desktop row (Work type/Seniority/Posted)", MIN)));
  count += await linkCountIn(page, "filter-bar-desktop");

  const countryDesktopTrigger = await measureTrigger(page, "filter-menu-country-desktop");
  count += 1;
  if (countryDesktopTrigger.w < MIN || countryDesktopTrigger.h < MIN) undersized.push(countryDesktopTrigger);

  await page.getByTestId("filter-menu-country-desktop").locator("summary").click();
  undersized.push(...(await measureLinksIn(page, "filter-menu-country-desktop", "Country menu (desktop)", MIN)));
  count += await linkCountIn(page, "filter-menu-country-desktop");

  // --- The applied-filters control's own "Clear filters" link — still a
  // real `<a>` even though the per-filter removable chip row it used to sit
  // beside is gone (filter-bar.tsx's own comment: "a second, redundant
  // display of the same state... is gone"). ---
  undersized.push(...(await measureLinksIn(page, "applied-filters", "Clear filters", MIN)));
  count += await linkCountIn(page, "applied-filters");

  // --- The collapsed row (<1140px): every FilterMenu becomes a trigger,
  // covering surface the pre-redesign spec never measured at all. ---
  await page.setViewportSize({ width: 900, height: 900 });
  await page.reload();
  await page.getByTestId("filter-bar-mobile").waitFor();

  for (const menuTestId of [
    "filter-menu-country-mobile",
    "filter-menu-work-type",
    "filter-menu-seniority",
    "filter-menu-posted",
  ]) {
    const trigger = await measureTrigger(page, menuTestId);
    count += 1;
    if (trigger.w < MIN || trigger.h < MIN) undersized.push(trigger);

    await page.getByTestId(menuTestId).locator("summary").click();
    undersized.push(...(await measureLinksIn(page, menuTestId, `${menuTestId} items (collapsed)`, MIN)));
    count += await linkCountIn(page, menuTestId);
    // Close before opening the next one — two open menus can overlap, and
    // measuring a covered element is not measuring what a user could click.
    await page.getByTestId(menuTestId).locator("summary").click();
  }

  // Desktop: Work type (3) + Seniority (5) + Posted (4) links, the Country
  // trigger + its 5 items, Clear filters (1) = 19. Mobile: 4 triggers +
  // (5 Country + 3 Work type + 5 Seniority + 4 Posted) items = 21. 40 total
  // when every selector still finds what it's looking for — a number well
  // below that means a selector stopped matching, not that the controls
  // shrank.
  expect(count).toBeGreaterThanOrEqual(30);
  expect<Undersized[]>(undersized).toEqual([]);
});
