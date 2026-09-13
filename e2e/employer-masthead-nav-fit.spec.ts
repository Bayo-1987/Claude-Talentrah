import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/authed";

/**
 * The employer masthead's nav must never wrap or overlap the right-hand
 * group — the same guarantee e2e/masthead-nav-fit.spec.ts already proves for
 * the seeker side, mirrored here (send-219).
 *
 * ── THE BUG THIS EXISTS FOR ────────────────────────────────────────────────
 *
 * The nav's own breakpoint (`min-[640px]:flex`) was measured once, against
 * three links, and never re-derived when Analytics (0128) and Talent
 * Directory brought it to five. From 640 up through ~1180 the document never
 * overflowed and the nav never disappeared — it just wrapped its multi-word
 * labels onto a second line, at completely ordinary widths (768, 850, 1024)
 * that a laptop or a windowed browser reports every day. A `scrollWidth`
 * check would have missed this the same way masthead-nav-fit.spec.ts's own
 * header describes for the seeker side: the wrapping happened INSIDE the
 * nav's own box, not past the edge of the page.
 *
 * ── WHY THIS MEASURES HEIGHT, NOT JUST A GAP ───────────────────────────────
 *
 * The seeker masthead's failure mode was the last link's PAINTED TEXT
 * overlapping the right-hand group while its box still fit — measured via a
 * Range over the text. This bug is different: the box and the text both stay
 * within the nav's own column, so nothing overlaps and nothing is out of
 * bounds — the link just renders two lines rather than one, which looks
 * cramped rather than broken but is exactly the defect the sweep flagged.
 * `getBoundingClientRect().height` on each link is what actually detects
 * that (a wrapped `min-h-10` link measures ~40px tall; a single line is
 * ~18-20px) — a gap-to-the-right-hand-group check alone would pass at every
 * width in the broken range, since nothing there ever crowds anything else.
 *
 * The GAP check still matters once unwrapped, for the same reason it does on
 * the seeker side: confirming the new breakpoint has real margin, not one
 * that only just clears.
 */

const NAV_BREAKPOINT = 1280;

/** Boundary either side, then a few widths spanning the old broken range. */
const WIDTHS = [640, 768, 850, 900, 1024, 1160, 1200, 1279, 1280, 1281, 1360, 1536];

/** Minimum breathing room between the nav and the right-hand group, once shown. */
const MIN_GAP_PX = 16;

/** A link taller than this is wrapped onto a second line. */
const WRAPPED_HEIGHT_PX = 28;

async function createCompanyAndReachJobsPosted(page: Page, orgId: string) {
  await page.goto("/employer");
  await page.getByLabel("Company name").fill(`E2E Employer Co ${orgId}`);
  await page.getByLabel("Company website domain").fill("e2e-employer.example");
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/employer\/jobs$/);
}

test.describe("the employer masthead nav fits where it is shown", () => {
  test("never wraps a link to a second line, and never crowds the right-hand group, at any width", async ({
    authedPage,
    testUser,
  }) => {
    test.setTimeout(120_000);
    await authedPage.setViewportSize({ width: 1280, height: 900 });
    await createCompanyAndReachJobsPosted(authedPage, testUser.id.slice(0, 8));

    for (const width of WIDTHS) {
      await authedPage.setViewportSize({ width, height: 900 });
      await authedPage.waitForTimeout(180);

      const m = await authedPage.evaluate(() => {
        const bar = document.querySelector('[data-testid="employer-masthead"]')!;
        const nav = bar.querySelector("nav") as HTMLElement | null;
        if (!nav || getComputedStyle(nav).display === "none") {
          return { navShown: false as const };
        }

        /*
         * The link's own box height is useless here — it carries `min-h-10`
         * (40px) regardless of whether the text inside wraps, so it always
         * reads >=40 whether the label is one line or two. A Range over each
         * link's TEXT reports the painted extent instead, which is what
         * actually changes when a label wraps.
         */
        const links = [...nav.querySelectorAll("a")];
        const heights = links.map((a) => {
          const r = document.createRange();
          r.selectNodeContents(a);
          return r.getBoundingClientRect().height;
        });

        const last = links[links.length - 1];
        const range = document.createRange();
        range.selectNodeContents(last);
        const textRight = range.getBoundingClientRect().right;

        const actions = bar.querySelector(
          '[data-testid="employer-masthead-actions"]',
        ) as HTMLElement | null;
        const candidates = actions
          ? [...actions.children].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0)
          : [];
        const firstRight = candidates.length
          ? candidates.reduce((a, b) => (a.left < b.left ? a : b))
          : null;

        return {
          navShown: true as const,
          maxHeight: Math.max(...heights),
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
      expect(
        m.maxHeight!,
        `a nav link is wrapped onto a second line at ${width}px (tallest link measures ${m.maxHeight}px)`,
      ).toBeLessThan(WRAPPED_HEIGHT_PX);
      expect(m.gap, `could not locate the right-hand group at ${width}px`).not.toBeNull();
      expect(
        m.gap!,
        `"${m.lastLabel}" crowds the right-hand group at ${width}px ` +
          `(text ends ${m.textRight}, group starts ${m.rightGroupLeft})`,
      ).toBeGreaterThanOrEqual(MIN_GAP_PX);
    }
  });

  test("every destination survives the collapse below the breakpoint", async ({
    authedPage,
    testUser,
  }) => {
    /*
     * The breakpoint moved from 640 to 1280, pushing a much wider band of
     * viewports behind the disclosure. That is only acceptable because it
     * stays COMPLETE at every width below NAV_BREAKPOINT — asserted here at
     * a width that was previously served by the horizontal bar (1024, one of
     * the three the sweep confirmed broken).
     */
    await createCompanyAndReachJobsPosted(authedPage, testUser.id.slice(0, 8));
    await authedPage.setViewportSize({ width: 1024, height: 900 });

    const trigger = authedPage.getByRole("button", { name: "Main menu" });
    await expect(trigger).toBeVisible();

    const menu = authedPage.getByTestId("employer-nav-menu");
    await expect(async () => {
      await trigger.click();
      await expect(menu).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });

    for (const label of [
      "Jobs Posted",
      "Company Profile",
      "Ad Campaigns",
      "Analytics",
      "Talent Directory",
      "Looking for work?",
    ]) {
      await expect(
        menu.getByRole("menuitem", { name: label }),
        `${label} is unreachable at 1024px — it is in neither the bar nor the menu`,
      ).toBeVisible();
    }
  });
});
