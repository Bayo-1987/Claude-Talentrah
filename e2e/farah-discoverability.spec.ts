import { test, expect, type Page } from "@playwright/test";

/**
 * Reaching Farah from either end of the shell.
 *
 * The panel is a sticky right-hand column above 760px and stacks UNDER the
 * feed below it — where "under" on a job feed means several screens down, past
 * every card. So the panel is discoverable at desktop widths and effectively
 * invisible on a phone, and the two ends of this spec test two different
 * affordances for that reason rather than for symmetry.
 *
 * THE BREAKPOINTS ARE MEASURED, and the nav item's is not the one originally
 * specified. The masthead row has no horizontal slack at 760: on main, before
 * the item existed, its scrollWidth at a 760px viewport was exactly 760.
 * Adding a labelled item took the document to 809 and, at 900 and 1024, let the
 * nav overlap "Post a job" while the document did NOT overflow — which is why
 * this spec asserts the GAP between those two elements and not just
 * scrollWidth.
 *
 * THIS TEST THEN CAUGHT THE SECOND VERSION TOO, which is the reason it is
 * written as a sweep rather than a single width. Gated to xl, the item cleared
 * "Post a job" by 18px locally and by EXACTLY 0 on CI's Linux runner — same
 * code, same viewport, different font metrics rendering the row ~18px wider.
 * It is gated to 2xl for that reason: tens of pixels of margin is not margin
 * when the platform can move it, and production serves every platform.
 *
 * So the sweep runs past the gate — 1536 and 1728 are here so the widths where
 * the item IS rendered are actually asserted, not just the ones where it is
 * hidden and the gap check silently skips.
 */

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

if (process.env.CI && !DEMO_PASSWORD) {
  throw new Error("farah-discoverability spec cannot run in CI: DEMO_PASSWORD is not set");
}

const PHONE_WIDTHS = [360, 390, 412];

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password").fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
}

test.describe("reaching Farah on a phone", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");

  for (const width of PHONE_WIDTHS) {
    test(`at ${width}px the tab is a fixed, full-width, square bar`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await login(page);

      const tab = page.getByTestId("farah-mobile-tab");
      await expect(tab).toBeVisible();

      const m = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="farah-mobile-tab"]') as HTMLElement;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          position: cs.position,
          zIndex: cs.zIndex,
          radius: cs.borderTopLeftRadius,
          width: Math.round(r.width),
          bottom: Math.round(r.bottom),
          clientW: document.documentElement.clientWidth,
          viewportH: window.innerHeight,
        };
      });

      expect(m.position, "a sticky bar would scroll away with its parent").toBe("fixed");
      expect(m.width, "the bar spans the viewport").toBe(m.clientW);
      expect(m.bottom, "the bar sits on the bottom edge").toBe(m.viewportH);
      // Square corners — the design system has no radius outside avatars,
      // notification dots and toggles. A rounded pill here would be the FAB
      // this deliberately is not.
      expect(m.radius).toBe("0px");
      /*
       * Above the job cards' menus (z-[15]) so a menu cannot render over the
       * bar, below the masthead band (z-20) so a masthead dropdown that grows
       * long on a short viewport still wins.
       */
      expect(Number(m.zIndex)).toBeGreaterThan(15);
      expect(Number(m.zIndex)).toBeLessThan(20);

      const box = await tab.getByRole("button", { name: "Ask Farah" }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    });

    test(`at ${width}px the bar does not cover the last thing on the page`, async ({ page }) => {
      /*
       * The reserve, asserted at the one place it can fail. A fixed bar with no
       * matching space at the end of the document hides whatever is last —
       * and below 760 that is the Farah PANEL, not the last job card, because
       * the columns stack. The first version of this reserved 56px against a
       * bar that is 58.5px tall including its rule, and the panel's bottom
       * edge measured 2px BEHIND the bar.
       */
      await page.setViewportSize({ width, height: 844 });
      await login(page);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(800);

      const r = await page.evaluate(() => {
        const panel = document
          .querySelector('[data-testid="farah-panel"]')!
          .getBoundingClientRect();
        const tab = document
          .querySelector('[data-testid="farah-mobile-tab"]')!
          .getBoundingClientRect();
        return { panelBottom: panel.bottom, tabTop: tab.top };
      });

      expect(
        r.panelBottom,
        "the bar is covering the panel it exists to reveal",
      ).toBeLessThanOrEqual(r.tabTop);
    });

    test(`at ${width}px tapping the tab brings the panel into view`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await login(page);

      const offScreen = await page.evaluate(() => {
        const p = document.querySelector('[data-testid="farah-panel"]')!.getBoundingClientRect();
        return p.top > window.innerHeight;
      });
      expect(offScreen, "precondition: the panel starts off screen on a phone").toBe(true);

      await page.getByTestId("farah-mobile-tab").getByRole("button", { name: "Ask Farah" }).click();

      // Smooth scroll over a long feed takes a while; assert the end state
      // rather than a fixed wait.
      await expect(async () => {
        const inView = await page.evaluate(() => {
          const p = document
            .querySelector('[data-testid="farah-panel"]')!
            .getBoundingClientRect();
          return p.top < window.innerHeight && p.bottom > 0;
        });
        expect(inView).toBe(true);
      }).toPass({ timeout: 20_000 });
    });
  }
});

test.describe("reaching Farah on a desktop", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");

  test("at 2xl the masthead carries the item and the bar is gone", async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 900 });
    await login(page);

    await expect(page.getByTestId("farah-mobile-tab")).toBeHidden();
    /*
     * SCOPED TO THE MASTHEAD, and it has to be: every job card carries its own
     * "Ask Farah ▾" menu, so the unscoped role+name locator resolved to 154
     * elements on a loaded feed. The shared label is correct for users — the
     * two do the same kind of thing in different contexts — but it means no
     * assertion about the masthead item can be written without saying where it
     * is.
     */
    const ask = page.getByTestId("masthead").getByRole("button", { name: "Ask Farah" });
    await expect(ask).toBeVisible();

    const box = await ask.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(40);
    expect(box!.width).toBeGreaterThanOrEqual(40);
  });

  test("the masthead still fits, and the item does not collide with Post a job", async ({
    page,
  }) => {
    /*
     * THE REGRESSION THIS EXISTS FOR. Adding the item overflowed the document
     * at 760 (809 vs 760) and overlapped "Post a job" at 900 and 1024 while
     * the document did not overflow at all. Both failure modes are checked, at
     * every width the shell renders a nav in.
     */
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);

    for (const width of [760, 800, 860, 900, 1024, 1280, 1536, 1728]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(200);

      const r = await page.evaluate(() => {
        const doc = document.documentElement;
        const ask = [...document.querySelectorAll("nav button")].find((b) =>
          b.textContent?.includes("Ask Farah"),
        ) as HTMLElement | undefined;
        const post = [...document.querySelectorAll("a")].find(
          (a) => a.textContent?.trim() === "Post a job",
        ) as HTMLElement | undefined;
        const askR = ask?.getBoundingClientRect();
        const postR = post?.getBoundingClientRect();
        return {
          clientW: doc.clientWidth,
          scrollW: doc.scrollWidth,
          // Both must be actually laid out before a gap between them means
          // anything — a display:none element reports a zero-width rect.
          gap:
            askR?.width && postR?.width ? postR.left - askR.right : null,
        };
      });

      expect(r.scrollW, `the masthead overflows at ${width}px`).toBeLessThanOrEqual(r.clientW);
      if (r.gap !== null) {
        expect(r.gap, `"Ask Farah" overlaps "Post a job" at ${width}px`).toBeGreaterThan(0);
      }
    }
  });
});
