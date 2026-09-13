import { test, expect } from "@playwright/test";
import { PDFParse } from "pdf-parse";

/**
 * TEMPORARY, send-197 follow-up. See src/app/dev/kerning-check/page.tsx for
 * full context — this is the e2e half of that diagnostic rig.
 *
 * Generates ONE real PDF from the standalone /dev/kerning-check page (zero
 * shared production code touched) and:
 *   1. Confirms whether Barlow Condensed's "Staff Engineer — Certification
 *      Lead" corrupts on real CI the same way DM Sans's "ZQEDUCATION" does
 *      — this investigation has only ever seen that as an extracted STRING
 *      from a console.log, never as real PDF-byte structural data.
 *   2. Tests whether font-kerning:none or font-feature-settings with
 *      kern/calt/liga all disabled changes anything for either font — the
 *      font's own GPOS/GSUB tables (checked directly via fontTools) show no
 *      rule touching the corrupted glyph pairs in either font, so this
 *      predicts CSS should NOT move the gap, but that's a prediction to
 *      verify against a real Chromium PDF, not something to trust from
 *      font-table inspection alone.
 *
 * Always attaches the PDF and a per-row diagnostic — not gated behind any
 * pass/fail condition, since the whole point is to look at the real output
 * regardless of which way it comes back. Delete this file (and the page it
 * drives) once the investigation concludes.
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

const ROWS = [
  { key: "dm-base", label: "DM Sans, plain", anchor: "ZQDM1" },
  { key: "dm-kerning-none", label: "DM Sans, font-kerning:none", anchor: "ZQDM2" },
  { key: "dm-features-off", label: "DM Sans, kern/calt/liga off", anchor: "ZQDM3" },
  { key: "bc-base", label: "Barlow Condensed, plain", anchor: "ZQBC1" },
  { key: "bc-kerning-none", label: "Barlow Condensed, font-kerning:none", anchor: "ZQBC2" },
  { key: "bc-features-off", label: "Barlow Condensed, kern/calt/liga off", anchor: "ZQBC3" },
] as const;

test("kerning/PDF-extraction diagnostic across DM Sans and Barlow Condensed", async ({ page }, testInfo) => {
  await page.goto("/dev/kerning-check");

  const pdfBuffer = await page.pdf({ printBackground: true });
  expect(pdfBuffer.length, "generated PDF was empty").toBeGreaterThan(0);

  await testInfo.attach("kerning-check.pdf", { body: pdfBuffer, contentType: "application/pdf" });

  ensurePdfRuntimeGlobals();
  const parser = new PDFParse({ data: pdfBuffer });
  let fullText: string;
  try {
    const result = await parser.getText();
    fullText = result.text;
  } finally {
    await parser.destroy();
  }

  const report = ROWS.map(({ key, label, anchor }) => {
    const idx = fullText.indexOf(anchor);
    const window = idx === -1 ? null : fullText.slice(idx, idx + 70);
    return { key, label, window };
  });

  await testInfo.attach("kerning-check-diagnostic.json", {
    body: JSON.stringify({ fullText, report }, null, 2),
    contentType: "application/json",
  });

  for (const r of report) {
    console.log(`[kerning-check] ${r.key} (${r.label}): ${JSON.stringify(r.window)}`);
  }

  // No pass/fail assertion on WHETHER text is corrupted — this test exists
  // to produce the attachment and console output above, not to gate CI.
  // Only assert every row's anchor actually made it into the PDF at all,
  // so a silent render failure (e.g. the page 404ing) doesn't look like a
  // clean diagnostic run.
  for (const { anchor, label } of ROWS) {
    expect(fullText, `${label}: anchor marker missing entirely from the PDF`).toContain(anchor);
  }
});
