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

/** Below `xl` the nav is behind the disclosure; at and above it, it renders. */
const NAV_BREAKPOINT = 1280;

/** Boundary either side, then the widths a laptop actually reports. */
const WIDTHS = [760, 800, 845, 900, 1024, 1160, 1279, 1280, 1360, 1440, 1536, 1728];

/** Minimum breathing room between the nav and the right-hand group. */
const MIN_GAP_PX = 16;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password").fill(DEMO_PASSWORD!);
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

        const links = [...nav.querySelectorAll("a")];
        const last = links[links.length - 1];

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
    }
  });

  test("every destination survives the collapse below the breakpoint", async ({ page }) => {
    /*
     * Raising the breakpoint from 760 to 1280 put tablet and small-laptop widths
     * behind the disclosure. That is only acceptable because it is COMPLETE —
     * asserted here rather than assumed, at a width that was previously served
     * by the horizontal bar.
     */
    await page.setViewportSize({ width: 900, height: 900 });
    await login(page);

    const trigger = page.getByRole("button", { name: "Main menu" });
    await expect(trigger).toBeVisible();

    const menu = page.getByRole("menu").first();
    await expect(async () => {
      await trigger.click();
      await expect(menu).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });

    for (const label of [
      "Jobs",
      "Job Tracker",
      "Auto-Apply",
      "Resume Builder",
      "Scholarships",
      "Refer a Friend",
      "Feedback",
      "Post a job",
    ]) {
      await expect(
        menu.getByRole("menuitem", { name: label }),
        `${label} is unreachable at 900px — it is in neither the bar nor the menu`,
      ).toBeVisible();
    }
  });
});
