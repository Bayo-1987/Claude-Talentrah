import { test, expect } from "@playwright/test";
import { PDFParse } from "pdf-parse";

/**
 * send-370 — the resume summary field is now edited through a rich editor
 * (`MinimalRichEditor`) that can produce `<strong>`/`<em>` around a word
 * instead of plain text, and rendered via `renderMarkdownParagraphs`
 * (render-markdown.tsx). `ats-safety.spec.ts` already proves READING ORDER
 * survives print-to-PDF for the templates this app claims `ats_safe` for;
 * this is the narrower, separate question that PR raised — whether wrapping
 * one word in a real `<strong>`/`<em>` tag changes how that word's OWN text
 * extracts, e.g. an ATS parser seeing "ZQBOLDBackend" (no space) or
 * "ZQBOLD" split across two disconnected runs instead of one substring a
 * keyword-matcher can find.
 *
 * Deliberately not extending the shared ATS_TEST_RESUME fixture (18+ other
 * cases in ats-safety.spec.ts assert an exact reading order against it) —
 * this renders a minimal, isolated page with the exact markup
 * renderMarkdownParagraphs/MinimalRichEditor actually produce, real
 * `page.pdf()`, same `pdf-parse` package `/api/resume/parse` uses on a
 * user's upload. See ats-safety.spec.ts's own header for why this file
 * can't import extract-text.ts directly (its `server-only` import) and
 * duplicates this same small polyfill instead.
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

test.describe("bold/italic marks survive print-to-PDF text extraction", () => {
  test("a bolded word and an italicized word each extract as one intact substring", async ({ page }) => {
    // Exactly the markup renderMarkdownParagraphs produces for
    // "**ZQBOLDWORD** is followed by *ZQITALICWORD* in one sentence." — a
    // <p> containing a <strong>, plain text, and an <em>, no other markup.
    await page.setContent(`
      <html>
        <body style="font-family: sans-serif; font-size: 14px;">
          <p><strong>ZQBOLDWORD</strong> is followed by <em>ZQITALICWORD</em> in one sentence.</p>
        </body>
      </html>
    `);

    const pdfBuffer = await page.pdf({ printBackground: true });
    expect(pdfBuffer.length, "generated PDF was empty").toBeGreaterThan(0);

    const text = await extractPdfText(pdfBuffer);

    expect(text, "bolded word did not extract as one intact substring").toContain("ZQBOLDWORD");
    expect(text, "italicized word did not extract as one intact substring").toContain("ZQITALICWORD");
    // The word immediately after the bold run must not have glued onto it
    // with no space — the real failure mode this test exists to catch.
    expect(text).not.toContain("ZQBOLDWORDis");
    expect(text).toContain("ZQBOLDWORD is followed by ZQITALICWORD in one sentence.");
  });

  test(
    "send-370 Part B: a bolded/italicized experience bullet inside <ul><li> extracts intact, in order, across multiple bullets",
    async ({ page }) => {
      // Exactly the markup section-blocks.tsx's renderExperience (and the
      // six standalone templates) produce for a role with bullets: a real
      // <ul> whose <li> children each go through renderInlineMarkdown —
      // the one thing NOT already covered by ats-safety.spec.ts's own
      // marker-order assertions, which never exercise a bolded/italicized
      // bullet specifically.
      await page.setContent(`
        <html>
          <body style="font-family: sans-serif; font-size: 14px;">
            <ul style="list-style: disc; padding-left: 18px;">
              <li>Led the <strong>ZQENGINEERING</strong> team</li>
              <li>Shipped <em>ZQTHREEFEATURES</em> on time</li>
            </ul>
          </body>
        </html>
      `);

      const pdfBuffer = await page.pdf({ printBackground: true });
      expect(pdfBuffer.length, "generated PDF was empty").toBeGreaterThan(0);

      const text = await extractPdfText(pdfBuffer);

      expect(text, "bolded word inside a bullet did not extract intact").toContain("ZQENGINEERING");
      expect(text, "italicized word inside a bullet did not extract intact").toContain("ZQTHREEFEATURES");
      // Reading order across bullets must survive too — the first bullet's
      // text must extract before the second's, not interleaved or reversed.
      expect(text.indexOf("ZQENGINEERING")).toBeLessThan(text.indexOf("ZQTHREEFEATURES"));
      expect(text).toContain("Led the ZQENGINEERING team");
      expect(text).toContain("Shipped ZQTHREEFEATURES on time");
    },
  );
});
