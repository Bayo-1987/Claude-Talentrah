import { test, expect } from "@playwright/test";
import { pdftoppmAvailable } from "./support/pdf-raster";
import { measureParagraphGaps } from "./support/pdf-gap";
import { DEMO_CONFIGS } from "@/components/resume-builder/skeletons/configs";
import { CATALOG_TEMPLATE_CONFIGS } from "@/components/resume-builder/skeletons/catalog-configs";
import { PRINT_FIXTURE_RESUME } from "@/lib/resume-builder/print-fixture";

/**
 * A resume's summary must not sit flush against the section heading under it.
 *
 * The sidebar-left and rail-right skeletons rendered the summary and then gave the first main section no top
 * spacing, so the first heading touched the last summary line: 6.5pt of white, the same as the gap between the
 * summary's own lines. This prints the shared fixture on EVERY template and skeleton demo with `page.pdf()`,
 * rasterises page 1 and measures, in pixels, the white between the summary's last line and the next ink under it
 * against the white between the summary's own lines. The heading has to be clearly further away: more than
 * the line gap plus 1pt.
 *
 * (Templates whose config hides the summary have nothing to measure and are skipped; the list is read from the
 * configs, so a template that stops showing a summary cannot hide a regression.)
 */
const SUMMARY = PRINT_FIXTURE_RESUME.summary!;
const BESPOKE = ["clean-professional", "clinical", "statute", "critical-path", "public-record", "portfolio-grid", "pipeline"];

const haveRaster = pdftoppmAvailable();
if (!haveRaster) {
  console.warn("\n!!! resume-print-summary-gap: pdftoppm (poppler) is NOT installed: these measurements are SKIPPED.\n");
}

const targets: Array<{ name: string; showsSummary: boolean }> = [
  ...Object.entries(DEMO_CONFIGS).map(([name, config]) => ({ name, showsSummary: config.content.showSummary })),
  ...Object.entries(CATALOG_TEMPLATE_CONFIGS).map(([name, config]) => ({ name, showsSummary: config.content.showSummary })),
  ...BESPOKE.map((name) => ({ name, showsSummary: true })),
];

test("there are templates to measure", () => {
  expect(targets.filter((t) => t.showsSummary).length).toBeGreaterThanOrEqual(20);
});

test("the summary is clearly separated from the heading under it, on every template", async ({ page }) => {
  test.skip(!haveRaster, "pdftoppm is not installed");
  test.setTimeout(240_000);

  const failures: string[] = [];
  const seen = new Set<string>();
  for (const { name, showsSummary } of targets) {
    if (!showsSummary || seen.has(name)) continue;
    seen.add(name);
    await page.goto(`/dev/resume-print-fixture/${name}`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({ format: "A4" });
    const { lines, lineGapPt, gapBelowPt } = await measureParagraphGaps(pdf, SUMMARY);
    const ok = lines >= 2 && gapBelowPt > lineGapPt + 1;
    console.log(`[summary-gap] ${name}: gap below ${gapBelowPt.toFixed(1)}pt, line gap ${lineGapPt.toFixed(1)}pt, ${lines} lines ${ok ? "" : "  <-- FLUSH"}`);
    if (!ok) failures.push(`${name}: ${gapBelowPt.toFixed(1)}pt below the summary vs ${lineGapPt.toFixed(1)}pt between its own lines`);
  }
  expect(failures, `summary flush against the heading under it:\n${failures.join("\n")}`).toEqual([]);
});
