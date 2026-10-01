import { PDFParse } from "pdf-parse";

/**
 * PDF text extraction shared by the e2e specs that assert on a real
 * `page.pdf()` — e2e/ats-safety.spec.ts and e2e/print-button-fonts.spec.ts.
 * It runs the PDF through the SAME `pdf-parse` package `/api/resume/parse`
 * uses on a user's uploaded resume — not a different, more forgiving
 * text-extraction path.
 *
 * WHY THIS DOESN'T IMPORT `src/lib/resume/extract-text.ts` DIRECTLY.
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

export function ensurePdfRuntimeGlobals() {
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

export async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  ensurePdfRuntimeGlobals();
  const parser = new PDFParse({ data: pdfBuffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}
