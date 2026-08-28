import { test, expect, type Page } from "@playwright/test";

/**
 * The feed's steering row is `position: fixed`, and this asserts the three
 * things that can go wrong when you convert a `sticky` element to a fixed one.
 *
 * WHY BEHAVIOUR AND NOT CSS. Asserting `position: fixed` in the computed style
 * would pass in the one failure mode worth catching: an ancestor with
 * `transform`, `filter`, `perspective`, `backdrop-filter` or `contain: paint`
 * makes ITSELF the containing block, and the element then scrolls with the
 * page while still reporting `fixed`. Nothing in the CSS says so. Only the
 * coordinates do, so the coordinates are what these tests read.
 */

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

if (process.env.CI && !DEMO_PASSWORD) {
  // A skip must not read as a pass on the summary line.
  throw new Error("fixed-tab-row spec cannot run in CI: DEMO_PASSWORD is not set");
}

/** The masthead's height, and therefore where this row is pinned. */
const TOP = 68;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password").fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
  // The row measures itself in a layout effect; wait for it to have taken.
  await page.locator('[data-testid="feed-header"]').waitFor();
}

async function boxOf(page: Page, testid: string) {
  return page.locator(`[data-testid="${testid}"]`).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  });
}

test.describe("the feed's tab row is fixed to the viewport", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");
  test.use({ viewport: { width: 1280, height: 900 } });

  test("its viewport coordinates do not move under scroll", async ({ page }) => {
    await login(page);

    const before = await boxOf(page, "feed-header");
    expect(before.top).toBeCloseTo(TOP, 0);

    // Far enough that a sticky-inside-a-transformed-ancestor bug, or a plain
    // static element, would be unmistakably gone from this position.
    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForFunction(() => window.scrollY === 1500);
    const after = await boxOf(page, "feed-header");

    expect(await page.evaluate(() => window.scrollY)).toBe(1500);
    // The assertion that catches the containing-block trap: same coordinates,
    // not merely "still visible".
    expect(after.top).toBeCloseTo(before.top, 0);
    expect(after.left).toBeCloseTo(before.left, 0);
    expect(after.width).toBeCloseTo(before.width, 0);
  });

  test("it really is fixed, not sticky pretending", async ({ page }) => {
    await login(page);
    const position = await page
      .locator('[data-testid="feed-header"]')
      .evaluate((el) => getComputedStyle(el).position);
    expect(position).toBe("fixed");
  });

  test("no ancestor captures it as a containing block", async ({ page }) => {
    /*
     * The direct check, kept alongside the behavioural one because it names
     * the culprit instead of just proving something is wrong. If this ever
     * fails, the offending element and property are in the message.
     */
    await login(page);
    const offenders = await page.locator('[data-testid="feed-header"]').evaluate((el) => {
      const bad: string[] = [];
      for (let node = el.parentElement; node; node = node.parentElement) {
        const s = getComputedStyle(node);
        const props = {
          transform: s.transform,
          filter: s.filter,
          perspective: s.perspective,
          backdropFilter: s.backdropFilter,
          contain: s.contain,
          willChange: s.willChange,
        };
        for (const [k, v] of Object.entries(props)) {
          const captures =
            (k === "contain" && /paint|layout|strict|content/.test(v)) ||
            (k === "willChange" && /transform|filter|perspective/.test(v)) ||
            (k !== "contain" && k !== "willChange" && v !== "none" && v !== "");
          if (captures) {
            bad.push(`${node.tagName.toLowerCase()}.${String(node.className).slice(0, 40)} → ${k}: ${v}`);
          }
        }
      }
      return bad;
    });
    expect(offenders, `these ancestors would capture the fixed row: ${offenders.join(" | ")}`).toEqual([]);
  });

  test("the spacer holds exactly the row's height, so nothing jumps", async ({ page }) => {
    await login(page);

    const bar = await boxOf(page, "feed-header");
    const spacer = await boxOf(page, "feed-header-spacer");

    // The whole point of the spacer: the space it reserves in flow equals the
    // space the fixed bar would have taken. A mismatch IS the content jump.
    expect(spacer.height).toBeCloseTo(bar.height, 0);
    expect(spacer.width).toBeCloseTo(bar.width, 0);
    expect(spacer.left).toBeCloseTo(bar.left, 0);
  });

  test("the first card sits where the row leaves it, with no load-time jump", async ({ page }) => {
    await login(page);

    const firstCardTop = () =>
      page.evaluate(() => {
        const spacer = document.querySelector('[data-testid="feed-header-spacer"]');
        let el = spacer?.nextElementSibling as HTMLElement | null;
        // Skip anything that renders nothing (conditional error banners).
        while (el && el.getBoundingClientRect().height === 0) {
          el = el.nextElementSibling as HTMLElement | null;
        }
        return el ? el.getBoundingClientRect().top : null;
      });

    const settled = await firstCardTop();
    expect(settled).not.toBeNull();

    // Re-measure after a forced reflow and a repeat layout pass. If the spacer
    // were wrong, or applied a frame late, the content below would shift.
    await page.evaluate(() => {
      void document.body.offsetHeight;
      window.dispatchEvent(new Event("resize"));
    });
    await page.waitForTimeout(150);
    const afterReflow = await firstCardTop();

    expect(afterReflow!).toBeCloseTo(settled!, 0);
    // And it must sit below the bar, not underneath it.
    const bar = await boxOf(page, "feed-header");
    expect(afterReflow!).toBeGreaterThanOrEqual(bar.top + bar.height - 1);
  });

  test("the masthead still paints above it", async ({ page }) => {
    /*
     * Both are now viewport-anchored and both are positioned, so the z-order
     * is worth re-checking rather than assuming it survived the change. The
     * row is z-10 and the masthead's wrapper z-20; where they meet, the
     * masthead must win.
     */
    await login(page);
    await page.evaluate(() => window.scrollTo(0, 1200));

    const winner = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="feed-header"]')!;
      const r = bar.getBoundingClientRect();
      // One pixel inside the masthead band, horizontally over the row.
      const hit = document.elementFromPoint(r.left + r.width / 2, 40);
      if (!hit) return "nothing";
      if (hit.closest('[data-testid="feed-header"]')) return "FEED ROW";
      if (hit.closest("nav") || hit.closest(".border-b-\\[2\\.5px\\]")) return "MASTHEAD";
      return `${hit.tagName}.${String(hit.className).slice(0, 30)}`;
    });

    expect(winner).toBe("MASTHEAD");
  });
});

test.describe("at a mobile width, where the row wraps", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");
  test.use({ viewport: { width: 390, height: 844 } });

  test("the spacer tracks the taller wrapped row and it stays fixed", async ({ page }) => {
    /*
     * The reason the spacer is measured rather than hardcoded. The filter
     * control alone goes from one line to three at this width, so a constant
     * would be wrong on one of the two viewports — and wrong quietly, as a
     * gap or an overlap rather than an error.
     */
    await login(page);

    const bar = await boxOf(page, "feed-header");
    const spacer = await boxOf(page, "feed-header-spacer");
    expect(spacer.height).toBeCloseTo(bar.height, 0);

    await page.evaluate(() => window.scrollTo(0, 800));
    await page.waitForFunction(() => window.scrollY === 800);
    const after = await boxOf(page, "feed-header");
    expect(after.top).toBeCloseTo(TOP, 0);
    expect(after.left).toBeCloseTo(bar.left, 0);

    /*
     * THE ROW must not spill sideways. Deliberately not asserting that the
     * PAGE doesn't scroll horizontally, which was the first version of this
     * line and failed: at 390px the document is 728px wide, and every
     * overflowing element is in the masthead — its nav, the nav links, the
     * credits pill, the account button. Measured against main's sticky
     * version too, which gives the identical 728, so it predates this change
     * and belongs to the masthead's missing mobile treatment. Asserting it
     * here would have made this spec fail for someone else's bug.
     */
    const clientW = await page.evaluate(() => document.documentElement.clientWidth);
    expect(after.left).toBeGreaterThanOrEqual(0);
    expect(after.left + after.width).toBeLessThanOrEqual(clientW + 1);
  });
});
