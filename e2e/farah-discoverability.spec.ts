import { test, expect, type Page } from "@playwright/test";
import { ROUTE_LOADING_TESTID } from "@/components/ui/skeleton";

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
  // A new browser sees the first-visit pill ("Ask Farah · AI assistant"); these specs measure the round launcher, so mark it seen first (the pill itself is covered in farah-launcher.spec.ts).
  await page.addInitScript(() => {
    try {
      localStorage.setItem("talentrah.farahLauncher", '{"v":1,"opened":true}');
    } catch {
      // storage blocked: the pill shows, and the width assertions below will say so
    }
  });
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
  // jobs/(feed)/loading.tsx means waitForURL can resolve before the real
  // feed content (and its final page height/scroll geometry) replaces the
  // skeleton — wait for it to clear before any geometry-based assertion.
  await expect(page.getByTestId(ROUTE_LOADING_TESTID)).toHaveCount(0, { timeout: 15000 });
}

test.describe("reaching Farah on a phone", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");

  /*
   * LAUNCHER PLAN PR-2. Below 760px the full-width bottom bar is gone: a fixed 56px round launcher (the Reviewer-approved exception, decision Q6, written into CLAUDE.md)
   * opens the SAME mounted panel as a bottom sheet. The browser behaviour of the launcher and the sheet themselves (open and close, focus, the page behind, the first-visit
   * pill, the soft keyboard, not covering Apply, reduced motion) is e2e/farah-launcher.spec.ts, which needs no sign-in; what stays here is what only the signed-in app can show:
   * that the real shell mounts it, that the real panel is the sheet, and that the page does not end under it.
   */
  for (const width of PHONE_WIDTHS) {
    test(`at ${width}px the launcher is a fixed 56px round button and there is no bottom bar`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await login(page);

      await expect(page.getByTestId("farah-mobile-tab")).toHaveCount(0);
      await expect(page.getByTestId("farah-tab-spacer")).toHaveCount(0);

      const launcher = page.getByTestId("farah-launcher");
      await expect(launcher).toBeVisible();

      const m = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="farah-launcher"]') as HTMLElement;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          position: cs.position,
          zIndex: cs.zIndex,
          radius: cs.borderTopLeftRadius,
          width: Math.round(r.width),
          height: Math.round(r.height),
          rightGap: Math.round(document.documentElement.clientWidth - r.right),
          bottomGap: Math.round(window.innerHeight - r.bottom),
        };
      });

      expect(m.position, "a sticky button would scroll away with its parent").toBe("fixed");
      expect(m.width).toBe(56);
      expect(m.height).toBe(56);
      expect(m.rightGap).toBe(16);
      expect(m.bottomGap, "above the bottom edge (and above the install strip if it is showing)").toBeGreaterThanOrEqual(16);
      expect(m.radius, "the one round shape in the app, a written exception").not.toBe("0px");
      // Above the job cards' menus (z-[15]), below the masthead band (z-20) so a masthead dropdown that grows long on a short viewport still wins.
      expect(Number(m.zIndex)).toBeGreaterThan(15);
      expect(Number(m.zIndex)).toBeLessThan(20);
    });

    test(`at ${width}px the page does not end under the launcher`, async ({ page }) => {
      /*
       * The reserve, asserted at the one place it can fail. Scroll and re-measure rather than scroll once: the panel's own history fetch resolves after mount and can grow the
       * document after a scroll that already happened, so `toPass` re-scrolls on every retry and converges once the document stops growing. Below 760 the panel is the sheet and
       * is not in the page, so the last thing on the page is the content column's last child; the launcher's spacer comes after it.
       */
      await page.setViewportSize({ width, height: 844 });
      await login(page);

      await expect(async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const r = await page.evaluate(() => {
          const spacer = document.querySelector('[data-testid="farah-launcher-spacer"]')!.getBoundingClientRect();
          const launcher = document.querySelector('[data-testid="farah-launcher"]')!.getBoundingClientRect();
          const column = document.querySelector('[data-testid="content-column"]')!.getBoundingClientRect();
          return { columnBottom: column.bottom, spacerTop: spacer.top, launcherTop: launcher.top };
        });
        expect(r.columnBottom, "the content column ends where the reserve starts").toBeLessThanOrEqual(r.spacerTop + 1);
        expect(r.columnBottom, "the launcher is over the reserve, not over the last of the page").toBeLessThanOrEqual(r.launcherTop + 1);
      }).toPass({ timeout: 10_000 });
    });

    test(`at ${width}px the panel is the closed sheet, and tapping the launcher opens it`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await login(page);

      const sheet = page.getByTestId("farah-sheet");
      await expect(sheet).toHaveAttribute("data-sheet", "closed");
      await expect(sheet).toHaveCSS("visibility", "hidden");

      await page.getByTestId("farah-launcher").click();

      await expect(sheet).toHaveAttribute("data-sheet", "open");
      await expect(sheet).toHaveAttribute("role", "dialog");
      await expect(page.getByTestId("farah-panel")).toBeVisible();
      // Measured once the slide has finished, not mid-transition.
      await expect.poll(async () => { const b = await sheet.boundingBox(); return Math.round(b!.y + b!.height); }, { message: "the sheet stands on the bottom edge" }).toBe(844);
      const box = await sheet.boundingBox();
      expect(box!.height).toBeLessThanOrEqual(844 * 0.85 + 2);
    });
  }
});

test.describe("reaching Farah between 760 and 1535px", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");

  /*
   * THE GAP THIS DESCRIBE BLOCK CLOSES. Below 760 the mobile tab covers it;
   * at and above 2xl (1536) the inline masthead item does. Between those two
   * — which includes every common laptop resolution (1280/1366/1440/1512) —
   * there was no persistent Farah affordance at all once FarahFirstVisitHint's
   * one-time nudge is dismissed. The fix is a new "Ask Farah" entry in the
   * masthead's hamburger disclosure (masthead.tsx), grouped with "Post a job"
   * — this asserts it is actually there and actually works, at real widths
   * across the band rather than just one.
   */
  const BAND_WIDTHS = [760, 1024, 1280, 1366, 1440, 1512, 1535];

  for (const width of BAND_WIDTHS) {
    test(`at ${width}px the hamburger menu carries a reachable "Ask Farah" entry`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await login(page);

      // Precondition: the inline masthead item (2xl-gated) must NOT be
      // rendering here — otherwise this test would pass for the wrong
      // reason, proving the old affordance rather than the new one.
      await expect(
        page.getByTestId("masthead").getByRole("button", { name: "Ask Farah" }),
      ).toHaveCount(0);

      const trigger = page.getByRole("button", { name: "Main menu" });
      await expect(trigger).toBeVisible();

      const menu = page.getByRole("menu").first();
      await expect(async () => {
        await trigger.click();
        await expect(menu).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 15_000 });

      const item = menu.getByRole("menuitem", { name: "Ask Farah" });
      await expect(item).toBeVisible();

      // Every interactive element needs a real hit target (CLAUDE.md) —
      // pinned the same way the phone tab's own button is pinned above.
      const box = await item.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);

      await item.click();

      // Same contract as every other menuitem in this disclosure: activating
      // it closes the menu. No special-casing in masthead.tsx for this one —
      // confirmed here rather than assumed.
      await expect(menu).toBeHidden();

      // The panel is a sticky column at these widths (farah-panel.tsx), so a
      // fresh page load often already has it in view — this asserts the
      // click didn't error and the panel ends up on screen, not that it
      // necessarily moved.
      const inView = await page.evaluate(() => {
        const p = document.querySelector('[data-testid="farah-panel"]')!.getBoundingClientRect();
        return p.top < window.innerHeight && p.bottom > 0;
      });
      expect(inView, "the panel is not on screen after activating the dropdown entry").toBe(true);
    });
  }
});

test.describe("reaching Farah on a desktop", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");

  test("at 2xl the masthead carries the item and the launcher is gone", async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 900 });
    await login(page);

    await expect(page.getByTestId("farah-launcher")).toBeHidden();
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
