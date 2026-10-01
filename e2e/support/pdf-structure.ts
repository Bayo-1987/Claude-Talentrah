import { ensurePdfRuntimeGlobals } from "./pdf-text";

/**
 * Counts the structure roles (`L`, `LI`, `Lbl`, `H2`, ...) in a PDF's tag
 * tree. A bulleted list printed from real `<ul><li>` markup is tagged by
 * Chromium as `L > LI > (Lbl, LBody)`, where `Lbl` is the bullet marker — so
 * `Lbl` is a per-list-item count that cannot be faked by a "•" or "-"
 * typed into a paragraph, which is exactly the distinction the bullets test
 * needs. (Text extraction cannot see it: Chromium draws a `disc` marker as a
 * vector shape, not a character.)
 *
 * The PDF must be made with `page.pdf({ tagged: true })`; Playwright's default
 * is an untagged PDF with no structure tree at all.
 *
 * Uses the pdfjs-dist that `pdf-parse` itself pins (see pdf-text.ts for why
 * e2e specs build their own PDF reader at all).
 */
export async function countPdfStructureRoles(pdfBuffer: Buffer): Promise<Record<string, number>> {
  ensurePdfRuntimeGlobals();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
  const counts: Record<string, number> = {};
  const walk = (node: { role?: string; children?: unknown[] } | null | undefined) => {
    if (!node) return;
    if (node.role) counts[node.role] = (counts[node.role] ?? 0) + 1;
    for (const child of node.children ?? []) {
      if (child && typeof child === "object") walk(child as { role?: string; children?: unknown[] });
    }
  };
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      walk(await page.getStructTree());
    }
  } finally {
    await doc.destroy();
  }
  return counts;
}
