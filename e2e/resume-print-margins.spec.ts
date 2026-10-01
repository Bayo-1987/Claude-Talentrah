import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { pdftoppmAvailable, rasterisePdf, whiteSpaceAtBottomPt, whiteSpaceAtTopPt } from "./support/pdf-raster";
import { extractPdfText } from "./support/pdf-text";
import { countPdfStructureRoles } from "./support/pdf-structure";
import {
  PRINT_FIXTURE_BULLET_COUNT,
  PRINT_FIXTURE_CERTIFICATION_COUNT,
  PRINT_FIXTURE_PROJECT_COUNT,
  PRINT_FIXTURE_ROLE_COUNT,
} from "@/lib/resume-builder/print-fixture";

/**
 * Real top and bottom space on EVERY printed page of a resume.
 *
 * `src/app/globals.css` keeps `@page { margin: 0 }` so Chromium draws no
 * header/footer (date, page <title>, URL, page number) on a PDF a candidate
 * hands to an employer. The cost: with no page margin the print engine breaks
 * a page wherever the content runs out, so page 2 started ~3pt from the top
 * edge and page 1 ended ~14pt from the bottom. `ResumePrintSurface` puts the
 * space back INSIDE the page, as `box-decoration-break: clone` padding that is
 * repeated on every fragment of the resume, so each page gets it.
 *
 * This prints the shared multi-page fixture (18 certifications, bulleted
 * roles) with `page.pdf()` — Chromium's own print-to-PDF pipeline, the one
 * `window.print()` feeds — rasterises each page with poppler's `pdftoppm`, and
 * measures the blank band above the first ink and below the last ink in points
 * (see ./support/pdf-raster.ts). The route is /dev/resume-print-fixture/<template>,
 * served by the BUILT app in CI (a layout measurement taken under `next dev`
 * could be a dev-mode artefact).
 *
 * The 36pt floor is half an inch, the narrowest margin any resume guide
 * recommends; the surface pads 36pt and the measured band also includes the
 * line-height leading above the first glyph, so a correct build measures a
 * little over it.
 */
const MIN_MARGIN_PT = 36;

// One per skeleton (DEMO_CONFIGS keys) plus bespoke components (registry slugs).
const TEMPLATES = [
  "clean-professional-demo",
  "timeline-demo",
  "compact-dense-demo",
  "sidebar-left-demo",
  "rail-right-demo",
  "product-tech-preview",
  "grid-modules-demo",
  "clinical",
  "statute",
];

const FORMATS = ["A4", "Letter"] as const;

const haveRaster = pdftoppmAvailable();
if (!haveRaster) {
  // Loud on purpose: a skipped measurement is not a pass. CI installs
  // poppler-utils (ci.yml, e2e job) so this must never happen there.
  console.warn(
    "\n!!! resume-print-margins: pdftoppm (poppler) is NOT installed — the page-margin measurements are SKIPPED. " +
      "Install poppler (brew install poppler / apt-get install poppler-utils) to run them.\n",
  );
}

/** Optional: write each PDF here so a human can look at it (used for the before/after images in PR notes). */
const ARTIFACT_DIR = process.env.PRINT_MARGINS_ARTIFACT_DIR;

for (const format of FORMATS) {
  for (const template of TEMPLATES) {
    if (format === "Letter" && template !== "clean-professional-demo") continue;

    test(`${template} (${format}): at least ${MIN_MARGIN_PT}pt of white at the top and bottom of every page`, async ({ page }) => {
      test.skip(!haveRaster, "pdftoppm is not installed");

      await page.goto(`/dev/resume-print-fixture/${template}`);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      const pdf = await page.pdf({ format });

      if (ARTIFACT_DIR) {
        mkdirSync(ARTIFACT_DIR, { recursive: true });
        writeFileSync(path.join(ARTIFACT_DIR, `${template}-${format}.pdf`), pdf);
      }

      const pages = rasterisePdf(pdf);
      expect(pages.length, "the fixture should print to more than one page, otherwise no page break is being measured").toBeGreaterThanOrEqual(2);

      const top = pages.map(whiteSpaceAtTopPt).map((n) => Math.round(n * 10) / 10);
      const bottom = pages.map(whiteSpaceAtBottomPt).map((n) => Math.round(n * 10) / 10);
      console.log(`[print-margins] ${template} ${format}: top pt per page [${top.join(", ")}], bottom pt per page [${bottom.join(", ")}]`);

      // Page 2's top and page 1's bottom are the two the founder measured;
      // asserting EVERY page covers 3+ page resumes and the first page too.
      for (let i = 0; i < pages.length; i++) {
        expect.soft(top[i], `page ${i + 1} has only ${top[i]}pt of white at the top`).toBeGreaterThanOrEqual(MIN_MARGIN_PT);
        expect.soft(bottom[i], `page ${i + 1} has only ${bottom[i]}pt of white at the bottom`).toBeGreaterThanOrEqual(MIN_MARGIN_PT);
      }
    });
  }
}

/**
 * Bullets reach the PDF as list items — from a stored resume, and from the raw
 * shape a sloppy tailoring response comes back in (`?source=tailored`: half the
 * roles have their four achievements glued into one "•"-separated string, the
 * rest typed as dash lines in `description`, then `normaliseTailoredResume`).
 * Chromium tags a bulleted item `LI > (Lbl, LBody)`, so a `Lbl` count equal to
 * the number of achievements means every one printed as its own list item with
 * a real marker: none merged into a paragraph, none a dash typed into text.
 */
for (const source of ["stored", "tailored"] as const) {
  test(`the margin frame does not cost the PDF its content or its list items (${source} bullets)`, async ({ page }) => {
    await page.goto(`/dev/resume-print-fixture/clean-professional-demo${source === "tailored" ? "?source=tailored" : ""}`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    // tagged: true so the PDF carries its structure tree (Playwright's default is untagged).
    const pdf = await page.pdf({ format: "A4", tagged: true });
    const text = await extractPdfText(pdf);

    // Every certification and every bullet is in the PDF, in a PDF whose text
    // is not scrambled by the repeated frame.
    for (let n = 1; n <= PRINT_FIXTURE_CERTIFICATION_COUNT; n++) {
      expect(text, `certification ${n} is missing from the PDF text`).toContain(`ZQCERT${String(n).padStart(2, "0")}`);
    }
    for (let role = 1; role <= PRINT_FIXTURE_ROLE_COUNT; role++) {
      for (let n = 1; n <= 4; n++) expect(text, `bullet ZQB${role}${n} is missing from the PDF text`).toContain(`ZQB${role}${n}`);
    }
    // No typed marker survived into the text of any bullet (same-line only: pdf-parse separates pages with "-- 2 of 2 --").
    expect(text, "a typed bullet marker is printed inside a bullet's text").not.toMatch(/[•-][ \t]*ZQB\d\d/);

    // Text extraction cannot see the markers (Chromium draws a disc as a
    // shape), so they are counted in the structure tree. Certifications and
    // projects are list items too but carry no marker, so only achievements add `Lbl`.
    const roles = await countPdfStructureRoles(pdf);
    expect(roles.Lbl ?? 0, "each bullet should print as its own list item with a marker").toBe(PRINT_FIXTURE_BULLET_COUNT);
    expect(roles.LI ?? 0, "list items: every bullet, certification and project").toBe(
      PRINT_FIXTURE_BULLET_COUNT + PRINT_FIXTURE_CERTIFICATION_COUNT + PRINT_FIXTURE_PROJECT_COUNT,
    );
  });
}
