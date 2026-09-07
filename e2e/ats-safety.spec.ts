import { test, expect } from "@playwright/test";
import { PDFParse } from "pdf-parse";
// Imported from the leaf modules, deliberately NOT from
// "@/components/resume-builder/skeletons" (the barrel): that barrel also
// exports the skeleton COMPONENTS, which import fonts.ts, which calls
// `next/font/google` — a function that only exists inside Next's own build
// (see e2e/ats-safety.spec.ts's other comment on why this file can't import
// extract-text.ts directly, same underlying cause). This spec never renders
// a component itself — it only needs the plain-data config shapes to compute
// an expected marker order — so importing the data modules directly avoids
// dragging that in.
import { DEMO_CONFIGS } from "@/components/resume-builder/skeletons/configs";
import { CATALOG_TEMPLATE_CONFIGS } from "@/components/resume-builder/skeletons/catalog-configs";
import type { SectionKey, TemplateConfig } from "@/components/resume-builder/skeletons/types";

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
 * WHY THIS FILE DOESN'T IMPORT `src/lib/resume/extract-text.ts` DIRECTLY.
 * That file starts with `import "server-only"`, which unconditionally
 * throws when required outside Next's own server bundle (see
 * `node_modules/server-only/index.js` — Next's build resolves the
 * `"react-server"` export condition to a no-op instead; plain Node, which is
 * what a Playwright test runs in, does not). `ensurePdfRuntimeGlobals` below
 * is a deliberate, minimal duplicate of `pdf-runtime-polyfill.ts` for that
 * reason — small enough that keeping it in sync by inspection is more
 * reliable than a shared import that would need its own carve-out.
 */
class InertDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  constructor(init?: number[]) {
    if (Array.isArray(init) && init.length >= 6) [this.a, this.b, this.c, this.d, this.e, this.f] = init;
  }
  multiplySelf() {
    return this;
  }
  preMultiplySelf() {
    return this;
  }
  invertSelf() {
    return this;
  }
  translate() {
    return this;
  }
  scale() {
    return this;
  }
}

function ensurePdfRuntimeGlobals() {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g.DOMMatrix) g.DOMMatrix = InertDOMMatrix;
  if (!g.ImageData) {
    g.ImageData = class {
      constructor(
        public width = 0,
        public height = 0,
      ) {}
    };
  }
  if (!g.Path2D) {
    g.Path2D = class {
      addPath() {}
      moveTo() {}
      lineTo() {}
      closePath() {}
    };
  }
}

async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  ensurePdfRuntimeGlobals();
  const parser = new PDFParse({ data: pdfBuffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

/**
 * Which marker(s) `ATS_TEST_RESUME` (src/lib/resume-builder/ats-test-fixture.ts)
 * carries for each section, IN THE ORDER THEY APPEAR WITHIN THAT SECTION —
 * e.g. an experience entry's title renders before its body text.
 */
const SECTION_MARKERS: Partial<Record<SectionKey, string[]>> = {
  experience: ["ZQEXPERIENCE", "ZQEXPERIENCEBODY"],
  education: ["ZQEDUCATION"],
  skills: ["ZQSKILLS"],
  projects: ["ZQPROJECTS"],
  certifications: ["ZQCERTIFICATIONS"],
  links: ["ZQLINKS"],
  languages: ["ZQLANGUAGES"],
  awards: ["ZQAWARDS"],
};

/** The order a human reading THIS config's rendered page would encounter each marker — header name, then summary, then `content.sectionOrder` flattened through `SECTION_MARKERS`. Only correct for configs where `showLinksInHeader` is off, which is true of every skeleton this file asserts a strict order for (see the per-config comment below). */
function expectedMarkerOrder(config: TemplateConfig): string[] {
  const markers: string[] = ["ZQNAME"];
  if (config.content.showSummary) markers.push("ZQSUMMARY");
  for (const key of config.content.sectionOrder) {
    markers.push(...(SECTION_MARKERS[key] ?? []));
  }
  return markers;
}

function actualMarkerOrder(text: string, candidates: string[]): string[] {
  const present = candidates.filter((m) => text.includes(m));
  return [...present].sort((a, b) => text.indexOf(a) - text.indexOf(b));
}

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

  for (const [configKey, claimedAtsSafe] of Object.entries(SKELETON_CLAIMS)) {
    test(`${configKey} (claimed ats_safe=${claimedAtsSafe})`, async ({ page }) => {
      const config = DEMO_CONFIGS[configKey];
      expect(config, `no demo config registered for "${configKey}"`).toBeDefined();

      await page.goto(`/dev/template-skeletons/${configKey}`);
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
