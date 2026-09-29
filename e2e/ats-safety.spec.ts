import { test, expect } from "@playwright/test";
import { extractPdfText } from "./support/pdf-text";
import { SECTION_MARKERS, expectedMarkerOrder, actualMarkerOrder } from "./support/ats-markers";
// Imported from the leaf modules, deliberately NOT from
// "@/components/resume-builder/skeletons" (the barrel): that barrel also
// exports the skeleton COMPONENTS, which import fonts.ts, which calls
// `next/font/google` — a function that only exists inside Next's own build
// (see e2e/support/pdf-text.ts on why e2e can't import extract-text.ts
// directly, same underlying cause). This spec never renders
// a component itself — it only needs the plain-data config shapes to compute
// an expected marker order — so importing the data modules directly avoids
// dragging that in.
import { DEMO_CONFIGS } from "@/components/resume-builder/skeletons/configs";
import { CATALOG_TEMPLATE_CONFIGS } from "@/components/resume-builder/skeletons/catalog-configs";

/**
 * The real verification behind Template library PR 2 of 3's `ats_safe`
 * claim (see `src/components/resume-builder/templates/index.tsx`'s
 * `TEMPLATE_ATS_SAFETY` map and `supabase/migrations/0103_...sql`).
 *
 * "ATS-safe" means a resume's text extracts from a generated PDF in the
 * same order a human reads the page — no sidebar, no banded header, no CSS
 * grid interleaving unrelated sections. That is a claim about a REAL
 * RENDERED DOCUMENT, so it is checked against one: this spec drives a real
 * browser to `/dev/template-skeletons/<key>` (src/app/dev/template-skeletons,
 * QA-only, same convention as `/dev/design-check`), asks it for a real PDF
 * via `page.pdf()`, and runs that PDF through the SAME `pdf-parse` package
 * `/api/resume/parse` uses on a user's uploaded resume — not a different,
 * more forgiving text-extraction path.
 *
 * The PDF text extraction itself lives in ./support/pdf-text.ts (shared with
 * e2e/print-button-fonts.spec.ts) — see that file for why it duplicates
 * `pdf-runtime-polyfill.ts` instead of importing `extract-text.ts`.
 */


/**
 * Every skeleton, and whether ITS demo config is marked `ats_safe`
 * (skeletons/configs.ts) — must agree with
 * `templates/index.tsx`'s per-slug values once a config is a real catalog
 * row; here it is checked against the skeleton's OWN claim, which is the
 * more fundamental one PR3's rows inherit.
 */
const SKELETON_CLAIMS: Record<string, boolean> = {
  "clean-professional-demo": true, // single-column
  "timeline-demo": true,
  "compact-dense-demo": true,
  "sidebar-left-demo": false,
  "rail-right-demo": false,
  "product-tech-preview": false, // header-band
  "grid-modules-demo": false,
};

test.describe("ats_safe is a real, PDF-verified claim per skeleton", () => {
  test("every DEMO_CONFIGS key has a claim to check, and vice versa", () => {
    expect(Object.keys(DEMO_CONFIGS).sort()).toEqual(Object.keys(SKELETON_CLAIMS).sort());
  });

  // Post-merge follow-up (PR #386): SKELETON_CLAIMS is hand-maintained and
  // separate from each config's own `atsSafe` field, so the two can silently
  // disagree — the key-set check above never notices, since it only checks
  // that the same KEYS exist, not that the VALUES agree. That's exactly what
  // happened to timeline-demo: its config still said `atsSafe: true` while
  // SKELETON_CLAIMS said `false`, and the whole suite stayed green because
  // `claimedAtsSafe` only picks which assertion branch runs below — it never
  // reads `config.atsSafe` to cross-check itself.
  test("SKELETON_CLAIMS agrees with each config's own atsSafe field", () => {
    const mismatched = Object.entries(SKELETON_CLAIMS)
      .filter(([configKey, claimed]) => DEMO_CONFIGS[configKey]?.atsSafe !== claimed)
      .map(
        ([configKey, claimed]) =>
          `${configKey}: SKELETON_CLAIMS says ${claimed}, config.atsSafe says ${DEMO_CONFIGS[configKey]?.atsSafe}`,
      );
    expect(mismatched).toEqual([]);
  });

  for (const [configKey, claimedAtsSafe] of Object.entries(SKELETON_CLAIMS)) {
    test(`${configKey} (claimed ats_safe=${claimedAtsSafe})`, async ({ page }) => {
      const config = DEMO_CONFIGS[configKey];
      expect(config, `no demo config registered for "${configKey}"`).toBeDefined();

      await page.goto(`/dev/template-skeletons/${configKey}`);
      /*
       * WAIT FOR THE NETWORK TO SETTLE, THEN FOR FONTS, BEFORE PRINTING.
       * `page.goto()`'s default `load` wait does not cover requests this page
       * kicked off afterwards (font files among them), and every
       * `font-display: "swap"` font is designed not to block `load`, so a
       * `page.pdf()` straight after `goto` can capture the page on fallback
       * fonts. Waiting makes this harness print the page in its final fonts,
       * which is what a user who clicks Download PDF at their own pace gets.
       * Plain test hygiene; it is not what any past failure turned on.
       *
       * HISTORY, CORRECTED (send-473). This comment used to say `blueprint`'s
       * PDF "started missing entire trailing sections" because of a font-swap
       * race. That was wrong. CI runs with these waits in place, and with the
       * fonts fully loaded at print time, failed identically; a Linux
       * diagnostic then showed the PDF was one page with ALL its text present.
       * What failed was extraction: `blueprint`'s projects/certifications
       * list items had no font class and inherited the app's font, and
       * pdf.js word-split a marker inside them (`ZQCERT IFICAT IONS`).
       * The fix was to make every resume document declare its own font
       * (skeletons/token-classes.ts `fontScopeClassName`).
       *
       * That the print can fire with faces still loading is real and is what
       * PrintButton now guards (send-473, src/lib/resume-builder/
       * wait-for-fonts.ts; e2e/print-button-fonts.spec.ts drives the real
       * button on a throttled font load). It is fidelity protection: no loss
       * of content from it has been demonstrated.
       */
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      // Real browser print, same mechanism print-button.tsx uses
      // (window.print()) modulo the save-dialog — page.pdf() IS Chromium's
      // print-to-PDF pipeline, not a separate renderer.
      const pdfBuffer = await page.pdf({ printBackground: true });
      expect(pdfBuffer.length, "generated PDF was empty").toBeGreaterThan(0);

      const text = await extractPdfText(pdfBuffer);

      if (claimedAtsSafe) {
        // The actual proof: reading order out of the PDF must match reading
        // order on the page, exactly, for every marker this config's
        // sections actually surface.
        const expected = expectedMarkerOrder(config);
        const actual = actualMarkerOrder(text, expected);
        expect(
          actual,
          `${configKey} is marked ats_safe but its extracted PDF text order was ` +
            `[${actual.join(", ")}], expected [${expected.join(", ")}]`,
        ).toEqual(expected);
      } else {
        // Not claiming safety here — nothing to assert order-wise. Logged so
        // a human reading test output can see the real, current scramble
        // (or lack of one) for a skeleton the catalog is telling users NOT
        // to rely on for ATS parsing.
        const allMarkers = Object.values(SECTION_MARKERS).flat().concat(["ZQNAME", "ZQSUMMARY"]);
        const actual = actualMarkerOrder(text, allMarkers);
        console.log(`[ats-safety] ${configKey} (not ATS-safe) extracted order: ${actual.join(" -> ")}`);
      }
    });
  }
});

/**
 * Template library PR 3 of 3 — the real per-slug ATS-safety check the PR
 * description promises: "at least one representative new template per
 * skeleton actually used across the 54, PLUS any template flagged as
 * content-restructured enough to need its own check."
 *
 * NO CONFIG IN `catalog-configs.ts` WAS FLAGGED — every one of the 58
 * PR3-touched slugs (54 new + 4 fixed) inherits its skeleton's own baseline
 * unmodified (see that file's header): `single-column`/`timeline`/
 * `compact-dense` render `content.sectionOrder` as one linear DOM sequence
 * regardless of what that order is, and `sidebar-left`/`rail-right`/
 * `header-band`/`grid-modules` are false unconditionally regardless of which
 * sections land in the split/rail/band/grid. So one slug per skeleton here
 * is a real check of the MECHANISM those 58 configs all share, not a sample
 * that could miss a genuinely different one — there isn't one.
 *
 * Picked one representative per skeleton (`blueprint`, `faculty-profile`,
 * `value-chain`, `signal`, `gantt`, `specification`, `schematic`), plus all
 * four fixed PR2 fallback slugs (`structured-admin`, `product-tech`,
 * `field-notes`, `ledger`) since those are the other named PR3 deliverable.
 * Every one of these 11 slugs' `sectionOrder` only uses sections
 * `ATS_TEST_RESUME`/`SECTION_MARKERS` (above) actually carry a marker for
 * (experience/education/skills/projects/certifications/links/languages/
 * awards) — deliberate, so the strict order assertion below is meaningful
 * for the `atsSafe: true` ones rather than silently skipping sections.
 *
 * This reaches `/dev/template-skeletons/<slug>` directly — the SAME route
 * `DEMO_CONFIGS` uses above, just keyed by a real catalog slug instead of a
 * demo key (see that page's own header) — so still no Supabase/DB
 * dependency at all.
 */
const CATALOG_SLUGS_TO_VERIFY = [
  "structured-admin",
  "product-tech",
  "field-notes",
  "ledger",
  "blueprint",
  "faculty-profile",
  "value-chain",
  "signal",
  "gantt",
  "specification",
  "schematic",
] as const;

test.describe("ats_safe is a real, PDF-verified claim per PR3 catalog slug", () => {
  test("every slug above is a real, current catalog-configs.ts entry", () => {
    for (const slug of CATALOG_SLUGS_TO_VERIFY) {
      expect(CATALOG_TEMPLATE_CONFIGS[slug], `no config registered for "${slug}"`).toBeDefined();
    }
  });

  for (const slug of CATALOG_SLUGS_TO_VERIFY) {
    const config = CATALOG_TEMPLATE_CONFIGS[slug];
    test(`${slug} (skeleton: ${config.skeleton}, claimed ats_safe=${config.atsSafe})`, async ({ page }) => {
      await page.goto(`/dev/template-skeletons/${slug}`);
      // See the "per skeleton" describe block above for why these waits
      // exist — same fix, same root cause, same two call sites in this file.
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      const pdfBuffer = await page.pdf({ printBackground: true });
      expect(pdfBuffer.length, "generated PDF was empty").toBeGreaterThan(0);

      const text = await extractPdfText(pdfBuffer);

      if (config.atsSafe) {
        const expected = expectedMarkerOrder(config);
        const actual = actualMarkerOrder(text, expected);
        expect(
          actual,
          `${slug} is marked ats_safe but its extracted PDF text order was ` +
            `[${actual.join(", ")}], expected [${expected.join(", ")}]`,
        ).toEqual(expected);
      } else {
        const allMarkers = Object.values(SECTION_MARKERS).flat().concat(["ZQNAME", "ZQSUMMARY"]);
        const actual = actualMarkerOrder(text, allMarkers);
        console.log(`[ats-safety] ${slug} (not ATS-safe) extracted order: ${actual.join(" -> ")}`);
      }
    });
  }
});
