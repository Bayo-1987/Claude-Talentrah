import { test, expect } from "@playwright/test";

/**
 * Standalone links are at least 24px tall, on every public page that carries them (QA-1, found by the QA session; the owner's rule: 44px for primary controls,
 * 24px for secondary links, WCAG 2.2 AA 2.5.8). Before the fix: the footer's links measured 22px on every marketing page, the homepage's links under the demo box 20px,
 * "Forgot password?" on /login 19px, the job titles on /jobs 16px at 1440 and the scholarship titles on /scholarships 17px.
 *
 * MEASURED, not read from classes (an element sized by its glyph is not the same as an element sized by its box): `getBoundingClientRect()` for every visible `<a>`.
 * What is NOT counted: a link that sits inside a sentence of running text (a computed `display: inline` anchor whose parent holds other text), which is the WCAG
 * inline exception; the skip link (1px until focused); anything not rendered. A link that is the only content of its parent (a list item, a heading, a flex item)
 * is standalone and counted.
 *
 * Signed out, public pages only, no writes. The same spec ran against production first (read-only) to list what was short: that is the QA session's proof, kept here as
 * a standing check in the normal e2e config so CI runs it.
 */
const MIN = 24;
const PAGES = ["/", "/jobs", "/login", "/signup", "/scholarships", "/mentorship", "/how-we-review-resumes", "/blog"];

for (const width of [360, 1440]) {
  for (const path of PAGES) {
    test(`standalone links are at least ${MIN}px tall: ${path} @${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto(path, { waitUntil: "load" });
      expect(response?.status(), `${path} did not load`).toBeLessThan(400);
      const short = await page.evaluate((min) => {
        return [...document.querySelectorAll("a")]
          .filter((a) => {
            const r = a.getBoundingClientRect();
            if (!(r.width > 1 && r.height > 0 && r.height < min)) return false;
            const inlineInProse =
              getComputedStyle(a).display === "inline" && a.parentElement !== null && (a.parentElement.textContent ?? "").trim() !== (a.textContent ?? "").trim();
            return !inlineInProse;
          })
          .map((a) => `${((a as HTMLElement).innerText || a.getAttribute("aria-label") || "").trim().slice(0, 30)} ${Math.round(a.getBoundingClientRect().height)}px`);
      }, MIN);
      expect(short, `links under ${MIN}px on ${path} at ${width}px wide`).toEqual([]);
    });
  }
}
