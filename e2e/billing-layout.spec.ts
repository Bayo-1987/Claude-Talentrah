/**
 * The billing page (direction C) holds its layout at phone, tablet and desktop widths: no horizontal scroll, one h1, headings in order,
 * and every control at least 44px tall.
 *
 * The same checks were run locally against a static render of the real page markup at 375, 768 and 1280 (that run is in the PR notes).
 * NOT run locally as a Playwright test: it needs a signed-in session and a database, so its first run is this PR's CI.
 *
 * The page lays itself out from the width of its own column (container queries), not the screen, because the Farah rail takes 280px of
 * a tablet and the old viewport breakpoints overflowed the column that was left.
 */
import { test, expect } from "./fixtures/authed";

for (const width of [375, 768, 1280]) {
  test(`billing at ${width}px: no horizontal scroll, one h1, headings in order, controls at least 44px`, async ({ authedPage }) => {
    await authedPage.setViewportSize({ width, height: 900 });
    await authedPage.goto("/billing");
    await expect(authedPage.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible();

    const m = await authedPage.evaluate(() => {
      const page = document.querySelector("[data-billing-page]")!;
      const controls = [...page.querySelectorAll<HTMLElement>("button, a[href], summary")].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const levels = [...page.querySelectorAll("h1, h2, h3")].map((h) => Number(h.tagName[1]));
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        h1: levels.filter((l) => l === 1).length,
        skipped: levels.some((l, i) => i > 0 && l - levels[i - 1] > 1),
        controlCount: controls.length,
        short: controls.filter((e) => e.getBoundingClientRect().height < 43.5).map((e) => (e.textContent ?? "").trim().slice(0, 30)),
      };
    });
    expect(m.overflow, "horizontal scroll").toBeLessThanOrEqual(0);
    expect(m.h1).toBe(1);
    expect(m.skipped, "a heading level was skipped").toBe(false);
    expect(m.controlCount, "the check found no controls, so it proves nothing").toBeGreaterThan(3);
    expect(m.short, "controls under 44px tall").toEqual([]);
  });
}
