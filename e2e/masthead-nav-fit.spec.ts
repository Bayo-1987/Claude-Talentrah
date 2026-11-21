import { test, expect, type Page } from "@playwright/test";

/**
 * The masthead's nav must never sit on top of the right-hand group.
 *
 * ── THE BUG THIS EXISTS FOR ───────────────────────────────────────────────
 *
 * Between 760 and roughly 920px the nav overlapped the credits pill by up to
 * 87px, and the EN chip by up to 138px. Nothing caught it, and the reason is
 * the part worth keeping: THE DOCUMENT NEVER OVERFLOWED. The left group was
 * flex-shrunk to fit, its link boxes stopped moving at 684px, and the text
 * inside kept painting over whatever was to its right. Every scrollWidth
 * assertion in the suite passed throughout.
 *
 * So this measures two things a scrollWidth check cannot:
 *
 *   1. the PAINTED extent of the last nav link, via a Range over its text
 *      rather than its bounding box — the box is what shrinks, the text is
 *      what overlaps
 *   2. the gap between that and the FIRST element of the right-hand group,
 *      whichever that currently is
 *
 * ── WHY IT SWEEPS RATHER THAN CHECKING ONE WIDTH ──────────────────────────
 *
 * The bug arrived because a seventh nav item was added and the breakpoint was
 * never re-derived. A single-width test would have passed at 1280 the whole
 * time it was broken at 800. The sweep covers every width where the shell
 * renders a nav, including the boundary either side of the breakpoint.
 *
 * If this fails after a nav item is added, the fix is to re-measure and move
 * the breakpoint — not to shave the gap until it just fits. A threshold that
 * only just fits is the state this test was written to end.
 */

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

if (process.env.CI && !DEMO_PASSWORD) {
  throw new Error("masthead-nav-fit spec cannot run in CI: DEMO_PASSWORD is not set");
}

/**
 * NAV-DROPDOWN-REALIGN-1 (owner decision OWNER-DECISION-NAV-DEFAULTS-1, Option B): the bar is on screen from 1024 and steps with the width; below 1024 the nav is behind the disclosure.
 * The step table is src/components/app-shell/nav-model.ts, restated here on purpose so a change to the model has to change a test:
 *
 *   Ask Farah (the bar button) is in the bar from 1680 only; the docked panel is Farah's entry below that.
 *   >= 1536   Jobs, Job Tracker, Auto-Apply, Resume Builder, Scholarships, Mentorship, Talent Directory, Feedback; no "More"
 *   1480-1535 the first seven; "More" holds Feedback
 *   1280-1479 the first five; "More" holds Mentorship, Talent Directory, Feedback
 *   1024-1279 the first three; "More" holds the other five
 */
const NAV_BREAKPOINT = 1024;

const ALL_LINKS = ["Jobs", "Job Tracker", "Auto-Apply", "Resume Builder", "Scholarships", "Mentorship", "Talent Directory", "Feedback"];
/** width -> how many of ALL_LINKS (in order) are in the bar at that width; the rest are behind More. */
function barCountAt(width: number): number {
  return width >= 1536 ? 8 : width >= 1480 ? 7 : width >= 1280 ? 5 : 3;
}

/** Boundary either side of every step, then the widths a laptop actually reports. */
const WIDTHS = [760, 800, 845, 900, 1023, 1024, 1160, 1279, 1280, 1360, 1440, 1479, 1480, 1535, 1536, 1679, 1680, 1728];

/** Minimum breathing room between the nav and the right-hand group. */
const MIN_GAP_PX = 16;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
}

test.describe("the masthead nav fits where it is shown", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");

  test("never overlaps the right-hand group, at any width", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(180);

      const m = await page.evaluate(() => {
        const bar = document.querySelector('[data-testid="masthead"]')!;
        const nav = bar.querySelector("nav") as HTMLElement | null;
        if (!nav || getComputedStyle(nav).display === "none") {
          return { navShown: false as const };
        }

        // The last thing on screen in the bar: a link, or the "More" button when it is shown. Elements a step has hidden are display:none and have no box.
        const links = [...nav.querySelectorAll("a, button")].filter((el) => el.getBoundingClientRect().width > 0);
        const last = links[links.length - 1];
        const visibleLinks = [...nav.querySelectorAll("a")].filter((el) => el.getBoundingClientRect().width > 0).map((el) => el.textContent?.trim() ?? "");
        const askFarahShown = [...nav.querySelectorAll("button")].some((el) => (el.textContent ?? "").includes("Ask Farah") && el.getBoundingClientRect().width > 0);
        const moreShown = [...nav.querySelectorAll("button")].some((el) => (el.textContent ?? "").trim() === "More" && el.getBoundingClientRect().width > 0);

        /*
         * The PAINTED right edge. `getBoundingClientRect()` on the anchor
         * returns the box, which is exactly what shrinks under flex pressure —
         * it read a constant 684px across 200px of viewport while the text
         * inside kept moving. A Range over the contents reports where the ink
         * actually ends.
         */
        const range = document.createRange();
        range.selectNodeContents(last);
        const textRight = range.getBoundingClientRect().right;

        /*
         * The first thing to the nav's right, found by position rather than by
         * name, so this keeps working when the right group's contents change.
         * Elements are filtered to those actually laid out — the EN chip and
         * "Post a job" each appear only above their own breakpoints.
         */
        const rightGroup = bar.querySelector(
          '[data-testid="masthead-actions"]',
        ) as HTMLElement | null;
        const candidates = rightGroup
          ? [...rightGroup.children]
              .map((el) => el.getBoundingClientRect())
              .filter((r) => r.width > 0)
          : [];
        const firstRight = candidates.length
          ? candidates.reduce((a, b) => (a.left < b.left ? a : b))
          : null;

        return {
          navShown: true as const,
          lastLabel: last.textContent?.trim() ?? "",
          visibleLinks,
          moreShown,
          askFarahShown,
          textRight: Math.round(textRight),
          rightGroupLeft: firstRight ? Math.round(firstRight.left) : null,
          gap: firstRight ? Math.round(firstRight.left - textRight) : null,
        };
      });

      if (width < NAV_BREAKPOINT) {
        expect(
          m.navShown,
          `the nav renders at ${width}px, below the ${NAV_BREAKPOINT}px breakpoint where it was measured to fit`,
        ).toBe(false);
        continue;
      }

      expect(m.navShown, `the nav is hidden at ${width}px, at or above the breakpoint`).toBe(true);
      expect(m.gap, `could not locate the right-hand group at ${width}px`).not.toBeNull();
      expect(
        m.gap!,
        `"${m.lastLabel}" overlaps or crowds the right-hand group at ${width}px ` +
          `(text ends ${m.textRight}, group starts ${m.rightGroupLeft})`,
      ).toBeGreaterThanOrEqual(MIN_GAP_PX);

      // The step table: exactly these links in the bar, in this order, and "More" only below 1536.
      expect(m.visibleLinks, `the bar's links at ${width}px`).toEqual(ALL_LINKS.slice(0, barCountAt(width)));
      expect(m.moreShown, `More at ${width}px`).toBe(width < 1536);
      expect(m.askFarahShown, `the Ask Farah bar button at ${width}px`).toBe(width >= 1680);
    }
  });

  test("every destination survives the collapse below the breakpoint", async ({ page }) => {
    /*
     * Below 1024 the nav is behind the disclosure and must stay COMPLETE: the eight links and, under 900, "Post a job". 880 is under both. Refer a Friend is in the account menu (not here) and
     * there is no Ask Farah row (the launcher or the docked panel is Farah's entry), both asserted absent.
     */
    await page.setViewportSize({ width: 880, height: 900 });
    await login(page);

    const trigger = page.getByRole("button", { name: "Main menu" });
    await expect(trigger).toBeVisible();

    const menu = page.getByRole("menu").first();
    await expect(async () => {
      await trigger.click();
      await expect(menu).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });

    for (const label of [...ALL_LINKS, "Post a job"]) {
      await expect(
        menu.getByRole("menuitem", { name: label }),
        `${label} is unreachable at 880px — it is in neither the bar nor the menu`,
      ).toBeVisible();
    }
    for (const gone of ["Refer a Friend", "Ask Farah"]) {
      await expect(menu.getByRole("menuitem", { name: gone }), `${gone} must not be in the menu`).toHaveCount(0);
    }
  });

  test("Post a job is on screen once at every width", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);
    for (const width of [360, 700, 880, 899, 900, 1023, 1024, 1280, 1536, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(150);
      // Under 1024 the nav lives in the disclosure, so open it; from 1024 the bar is the whole story.
      const trigger = page.getByRole("button", { name: "Main menu" });
      if (await trigger.isVisible()) {
        const menu = page.getByRole("menu").first();
        await expect(async () => {
          if (!(await menu.isVisible())) await trigger.click();
          await expect(menu).toBeVisible({ timeout: 1000 });
        }).toPass({ timeout: 15_000 });
      }
      const visible = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="masthead"] a')].filter((a) => (a.textContent ?? "").trim() === "Post a job" && a.getBoundingClientRect().width > 0).length,
      );
      expect(visible, `"Post a job" visible ${visible} times at ${width}px`).toBe(1);
    }
  });

  test("the menu at 360px sits inside the viewport, and the page does not scroll sideways", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await login(page);

    const trigger = page.getByRole("button", { name: "Main menu" });
    await expect(trigger).toBeVisible();
    const menu = page.getByRole("menu").first();
    await expect(async () => {
      await trigger.click();
      await expect(menu).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });

    const panel = await menu.boundingBox();
    expect(panel, "the menu has no box at 360px").not.toBeNull();
    expect(panel!.x, "the menu starts left of the viewport at 360px").toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width, "the menu runs past the right edge at 360px").toBeLessThanOrEqual(360);
    const item = menu.getByRole("menuitem", { name: "Talent Directory" });
    await expect(item).toBeVisible();
    const box = await item.boundingBox();
    expect(box, "Talent Directory has no box at 360px").not.toBeNull();
    expect(box!.x + box!.width, "Talent Directory runs past the right edge at 360px").toBeLessThanOrEqual(360);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "the page scrolls sideways at 360px").toBeLessThanOrEqual(360);
    await testInfo.attach("menu-360px", { body: await page.screenshot(), contentType: "image/png" });
  });
});
