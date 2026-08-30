import { test, expect, type Page } from "@playwright/test";

/**
 * The signed-in shell on a phone.
 *
 * THE BREAKPOINT IS MEASURED, NOT CHOSEN. The masthead's intrinsic width is
 * 728px — constant at 360, 390 and 412, because nothing in it shrank — so the
 * document scrolled sideways on every phone. 760 is the smallest breakpoint
 * already used in this codebase that clears 728, which is why the shell
 * switches there rather than at a round number.
 *
 * All three widths are exercised, not one. The single-sample version of this
 * work would have justified a breakpoint from 390 alone and had no way to know
 * whether 360 behaved differently — it does: the content column was 0px there
 * against 30px at 390.
 */

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

if (process.env.CI && !DEMO_PASSWORD) {
  throw new Error("mobile-shell spec cannot run in CI: DEMO_PASSWORD is not set");
}

/** The common low-end Android widths this product's market actually uses. */
const PHONE_WIDTHS = [360, 390, 412];

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password").fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
}

test.describe("the shell on a phone", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");

  for (const width of PHONE_WIDTHS) {
    test(`at ${width}px the content column is usable and the shell fits`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await login(page);

      const shell = await page.evaluate(() => {
        const doc = document.documentElement;
        const col = document.querySelector('[data-testid="content-column"]') as HTMLElement;
        const cs = getComputedStyle(col);
        const inner =
          col.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const masthead = document.querySelector('[data-testid="masthead"]') as HTMLElement;
        return {
          clientW: doc.clientWidth,
          scrollW: doc.scrollWidth,
          innerCol: Math.round(inner),
          mastheadRight: Math.round(masthead.getBoundingClientRect().right),
        };
      });

      /*
       * The column was 0px at 360, 30px at 390 and 52px at 412 before this —
       * not cramped, unusable. 280 is a floor a job card can actually render
       * in; the measured values are 312 / 342 / 364.
       */
      expect(shell.innerCol, "the content column must be wide enough to read").toBeGreaterThan(280);

      // The shell itself must not be what makes the page scroll sideways.
      expect(shell.mastheadRight).toBeLessThanOrEqual(shell.clientW + 1);

      /*
       * AND NOW THE PAGE-LEVEL FACT, which this spec deliberately could not
       * assert when it was written. The shell was fixed first and the job
       * card's action row was still 350px of non-shrinking buttons, so the
       * document stayed 456px wide at every phone width. Asserting it then
       * would have failed for another component's bug; asserting it now is the
       * whole point, and it is the assertion that catches the next thing that
       * overflows, wherever it lives.
       */
      expect(
        shell.scrollW,
        "something on this page is wider than the viewport",
      ).toBeLessThanOrEqual(shell.clientW);
    });

    test(`at ${width}px the nav is behind the menu, and reachable`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await login(page);

      // The horizontal list is gone; the disclosure replaces it.
      await expect(page.locator("nav")).toBeHidden();
      const trigger = page.getByRole("button", { name: "Main menu" });
      await expect(trigger).toBeVisible();

      // ≥40x40, the standing rule for anything new.
      const box = await trigger.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(40);
      expect(box!.height).toBeGreaterThanOrEqual(40);

      /*
       * Retried, because the trigger is server-rendered and clickable before
       * React attaches its handler — measured at 0 menus opened on an
       * immediate click versus 1 after hydration. Waits as long as the app
       * needs and no longer.
       */
      const menu = page.getByRole("menu").first();
      await expect(async () => {
        await trigger.click();
        await expect(menu).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 15_000 });
      // Every destination survives the collapse, including the one that was
      // hidden above 900px in the bar and would otherwise be unreachable.
      for (const label of ["Jobs", "Job Tracker", "Resume Builder", "Post a job"]) {
        await expect(menu.getByRole("menuitem", { name: label })).toBeVisible();
      }

      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu").first()).toBeHidden();
    });

    test(`at ${width}px the Farah panel stacks under the feed`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await login(page);

      const stacked = await page.evaluate(() => {
        const col = document.querySelector('[data-testid="content-column"]') as HTMLElement;
        const panel = document.querySelector('[data-testid="farah-panel"]') as HTMLElement;
        const p = panel.getBoundingClientRect();
        return {
          below: p.top >= col.getBoundingClientRect().bottom - 2,
          width: Math.round(p.width),
          clientW: document.documentElement.clientWidth,
          sticky: getComputedStyle(panel).position,
        };
      });

      expect(stacked.below, "the panel must sit under the feed, not beside it").toBe(true);
      expect(stacked.width).toBe(stacked.clientW);
      // sticky here would pin the panel over the cards it now sits beneath.
      expect(stacked.sticky).not.toBe("sticky");
    });
  }

  test("the SHELL breakpoint flips exactly at 760, not near it", async ({ page }) => {
    /*
     * 760 IS NO LONGER THE NAV'S BREAKPOINT, and this test used to assert that
     * it was. It governs the shell: below it the Farah panel stacks under the
     * feed and the mobile tab appears; at and above it the panel sits beside
     * the content.
     *
     * The horizontal nav moved to `xl` because it never actually fit at 760 —
     * it was flex-shrunk and painted over the right-hand group by up to 87px,
     * without the document ever overflowing. That measurement, and the nav's
     * own boundary, live in masthead-nav-fit.spec.ts. Asserting the nav here
     * would duplicate it and, worse, would have to be changed in two places
     * the next time the bar's contents change.
     */
    await page.setViewportSize({ width: 759, height: 844 });
    await login(page);

    const stackedBelow = await page.evaluate(() => {
      const col = document.querySelector('[data-testid="content-column"]')!.getBoundingClientRect();
      const panel = document.querySelector('[data-testid="farah-panel"]')!.getBoundingClientRect();
      return panel.top >= col.bottom - 2;
    });
    expect(stackedBelow, "at 759 the panel should stack under the feed").toBe(true);
    await expect(page.getByTestId("farah-mobile-tab")).toBeVisible();

    await page.setViewportSize({ width: 760, height: 844 });
    await page.waitForTimeout(150);

    const sideBySideAt760 = await page.evaluate(() => {
      const col = document.querySelector('[data-testid="content-column"]')!.getBoundingClientRect();
      const panel = document.querySelector('[data-testid="farah-panel"]')!.getBoundingClientRect();
      return panel.top < col.bottom;
    });
    expect(sideBySideAt760, "at 760 the panel should sit beside the feed").toBe(true);
    await expect(page.getByTestId("farah-mobile-tab")).toBeHidden();

    // …and the nav is still behind the disclosure here, which is the change.
    await expect(page.getByRole("button", { name: "Main menu" })).toBeVisible();
  });

  test("the desktop layout is untouched", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);
    const r = await page.evaluate(() => {
      const col = document.querySelector('[data-testid="content-column"]') as HTMLElement;
      const panel = document.querySelector('[data-testid="farah-panel"]') as HTMLElement;
      return {
        innerCol: Math.round(col.clientWidth - 80),
        panelW: Math.round(panel.getBoundingClientRect().width),
        sideBySide: panel.getBoundingClientRect().top < col.getBoundingClientRect().bottom,
        position: getComputedStyle(panel).position,
      };
    });
    /*
     * The numbers this shipped with before the mobile pass, with ONE pixel
     * moved deliberately.
     *
     * innerCol was 920 while the panel's own div carried `border-l`. Tailwind
     * sizes border-box, so that 1px hairline lived INSIDE the panel's
     * `w-[280px]`. The hairline now sits on the wrapper — it had to, to run the
     * full height of the colour field rather than stopping at the panel's 511px
     * of content — and the wrapper has no width of its own, so the border adds
     * to it instead of fitting within it. The field is 281px and the content
     * column is 919.
     *
     * Asserted as 919 rather than loosened to a range: the point of these
     * numbers is that an unintended shift fails, and this shift is intended and
     * understood. A tolerance here would hide the next one.
     *
     * panelW stays 280 — the panel itself is unchanged; only what surrounds it
     * moved.
     */
    expect(r.innerCol).toBe(919);
    expect(r.panelW).toBe(280);
    expect(r.sideBySide).toBe(true);
    expect(r.position).toBe("sticky");
  });
});
