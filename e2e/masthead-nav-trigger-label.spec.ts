import { test, expect, type Page } from "@playwright/test";

/**
 * The labelled, two-action nav trigger on the seeker masthead.
 *
 * Below 2xl the whole nav lives behind one control, and that control used to
 * be a bare 40x40 hamburger with no text — operable by every rule, and still
 * routinely not recognised as the way to the rest of the app. It is now a
 * bordered box holding TWO buttons: the icon (the original toggle, unchanged,
 * still named "Main menu" because six other specs address it by that name) and
 * a label that idles through the real nav destinations and, when clicked,
 * always opens the panel with the item it was showing marked.
 *
 * Widths: 900 is above the 700px label-collapse breakpoint (see
 * LABEL_BREAKPOINT_CLASS in masthead.tsx for why 700 and not the ~613 where
 * the box merely stops overlapping) and below the 1536 at which the whole
 * disclosure gives way to the inline bar. Same viewport e2e/masthead-nav-focus
 * .spec.ts uses, for the same reason.
 *
 * Nothing here asserts the 2.6s cadence itself. Timing assertions against a
 * real browser on a shared CI runner are how a suite acquires a flake; what
 * matters to a reader is that the word changes on its own, so these poll for
 * the change with a lot of headroom rather than measuring the interval.
 */

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

/** The label button — deliberately NOT matched by the "Main menu" lookup. */
const LABEL_BUTTON = /^Open menu — suggestion: /;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
}

test.describe("the masthead nav trigger's label", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
  });

  test("cycles through the nav destinations on its own", async ({ page }) => {
    await login(page);

    const label = page.getByTestId("masthead-nav-trigger-label");
    await expect(label).toBeVisible();

    const first = (await label.textContent())?.trim();
    expect(first, "the label must render one of the real nav items").toBeTruthy();

    /*
     * One dwell is 2.6s; this waits up to 20s for the word to change. The
     * margin is the point — a `waitForTimeout(3000)` then a single read would
     * be asserting the cadence, and would fail on a loaded runner for a
     * reason that has nothing to do with the behaviour under test.
     */
    await expect
      .poll(async () => (await label.textContent())?.trim(), {
        timeout: 20_000,
        message: "the label never changed — the idle cycle is not running",
      })
      .not.toBe(first);
  });

  test("both buttons in the box keep a real hit target", async ({ page }) => {
    await login(page);

    /*
     * Pinned here as well as incidentally in e2e/mobile-shell.spec.ts, because
     * this is the thing the prototype's own construction gets wrong and the
     * failure is invisible: `height: 40px` on the bordered box plus
     * `height: 100%` on the buttons sizes border-box, so the 1.5px border
     * comes out of the 40 and both buttons land at 37px tall. Nothing looks
     * broken — the box is still 40 outside — and CLAUDE.md's >=40x40 rule is
     * still violated. mobile-shell only measures the icon; this measures both.
     */
    for (const button of [
      page.getByRole("button", { name: "Main menu" }),
      page.getByRole("button", { name: LABEL_BUTTON }),
    ]) {
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(40);
      expect(box!.height).toBeGreaterThanOrEqual(40);
    }
  });

  test("clicking the label opens the panel with the item it was showing marked", async ({
    page,
  }) => {
    await login(page);

    const labelButton = page.getByRole("button", { name: LABEL_BUTTON });
    const menu = page.getByRole("menu").first();

    // Retried for the same hydration race every other masthead spec retries
    // for: the trigger is server-rendered and clickable before React attaches.
    await expect(async () => {
      await labelButton.click();
      await expect(menu).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });

    /*
     * Read the label AFTER opening, not before. Cycling pauses while the panel
     * is open and any in-flight fade is cancelled on open (see masthead.tsx),
     * so the word is frozen here — which is exactly the invariant being
     * asserted: the marked row is the one the trigger still names.
     *
     * The mark is a data attribute, not a computed colour. A getComputedStyle
     * colour check would be asserting oklch round-tripping through the
     * browser, which is brittle and tests the wrong thing.
     */
    const shown = (await page
      .getByTestId("masthead-nav-trigger-label")
      .textContent())?.trim();

    const marked = menu.locator('[data-nav-highlight="true"]');
    await expect(marked).toHaveCount(1);
    await expect(marked).toHaveText(shown!);
  });

  test("clicking the icon still toggles the panel, and marks nothing", async ({
    page,
  }) => {
    await login(page);

    // The accessible name six other specs depend on. If this lookup ever
    // matches two elements, the label button's own name has drifted into
    // containing "Main menu" — Playwright matches names by substring.
    const icon = page.getByRole("button", { name: "Main menu" });
    await expect(icon).toHaveCount(1);

    const menu = page.getByRole("menu").first();
    await expect(async () => {
      await icon.click();
      await expect(menu).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });

    await expect(menu.locator("[data-nav-highlight]")).toHaveCount(0);

    // Still a toggle, which the label button deliberately is not.
    await icon.click();
    await expect(menu).toBeHidden();
  });

  test("the icon clears a highlight the label set", async ({ page }) => {
    await login(page);

    const menu = page.getByRole("menu").first();
    await expect(async () => {
      await page.getByRole("button", { name: LABEL_BUTTON }).click();
      await expect(menu).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await expect(menu.locator('[data-nav-highlight="true"]')).toHaveCount(1);

    const icon = page.getByRole("button", { name: "Main menu" });
    await icon.click(); // closes
    await expect(menu).toBeHidden();
    await icon.click(); // reopens, as the plain toggle
    await expect(menu).toBeVisible();
    await expect(menu.locator("[data-nav-highlight]")).toHaveCount(0);
  });

  test("under prefers-reduced-motion the label is a static 'Menu' and never cycles", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page);

    const label = page.getByTestId("masthead-nav-trigger-label");
    await expect(label).toHaveText("Menu");

    /*
     * Deliberately NOT NAV_LINKS[0] ("Jobs"). Freezing on the first item is
     * what the prototype did and it makes the trigger read as a link to one
     * page rather than the opener of a menu of nine — the cycling was the only
     * thing saying "this is a sample", and reduced motion removes exactly it.
     *
     * Held across three dwell intervals: a single read would pass even if the
     * timer were still running and merely hadn't fired yet.
     */
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(2800);
      await expect(label).toHaveText("Menu");
    }

    // And the label still opens the panel — reduced motion removes the
    // animation, not the affordance. With no cycling there is no item the
    // reader was shown, so nothing is marked.
    //
    // Matched by the EXACT name "Open menu", not LABEL_BUTTON: under reduced
    // motion REDUCED_MOTION_LABEL ("Menu") isn't a real nav destination, so
    // the "— suggestion: X" suffix is dropped entirely rather than rendered
    // as nonsense ("suggestion: Menu") — see navTriggerLabel in masthead.tsx.
    const menu = page.getByRole("menu").first();
    await page
      .getByRole("button", { name: "Open menu", exact: true })
      .click();
    await expect(menu).toBeVisible();
    await expect(menu.locator("[data-nav-highlight]")).toHaveCount(0);
  });

  test("the label's accessible name is always framed as a suggestion, never as the current section", async ({
    page,
  }) => {
    /*
     * Regression test for the 2026-09-19 UX audit (send-402, §4.4): the
     * trigger's accessible name used to read "Open menu, currently showing
     * X", and X cycles through NAV_LINKS on a timer that has nothing to do
     * with `pathname` — so on /jobs a reader would be told the menu was
     * "currently showing" Get Verified, Refer a Friend, Auto-Apply, etc.,
     * none of which is true. That wording is what made a rotating suggestion
     * read as a broken current-page indicator.
     *
     * This asserts the invariant the fix establishes: whatever destination
     * the idle cycle is showing, on whatever page, the accessible name is
     * always phrased as a suggestion ("— suggestion: X") and never claims to
     * be showing the reader's current location. Confirmed to fail against
     * the pre-fix wording before landing (matches "currently showing" and
     * fails the "never uses that phrasing" assertion below).
     */
    await login(page);
    // /jobs is the one page where NAV_LINKS[0] ("Jobs") would coincide with
    // reality — deliberately staying here rather than navigating elsewhere,
    // because that is the strictest case: even a value that HAPPENS to match
    // the real section must not be announced as "current".
    await expect(page).toHaveURL(/\/jobs$/);

    const labelButton = page.getByRole("button", { name: /^Open menu/ });

    const seen = new Set<string>();
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline && seen.size < 3) {
      const name = await labelButton.getAttribute("aria-label");
      if (name) seen.add(name);
      await page.waitForTimeout(400);
    }

    expect(seen.size, "the cycle must have produced at least one value").toBeGreaterThan(0);
    for (const name of seen) {
      expect(name, `"${name}" must not claim to represent the current page`).not.toMatch(
        /currently showing/i,
      );
      expect(name, `"${name}" must be framed as a suggestion`).toMatch(
        /^Open menu — suggestion: /,
      );
    }
  });
});
