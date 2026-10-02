import { ensurePdfRuntimeGlobals } from "./pdf-text";
import { RASTER_DPI, rasterisePdf } from "./pdf-raster";

const PT_PER_PX = 72 / RASTER_DPI;

interface TextBox {
  str: string;
  x0: number;
  x1: number;
  /** Points from the page's TOP edge. */
  top: number;
  bottom: number;
}

/** Every text run on page 1 with its box in points from the top-left, read with the pdfjs that pdf-parse pins. */
async function firstPageText(pdf: Buffer): Promise<TextBox[]> {
  ensurePdfRuntimeGlobals();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf) }).promise;
  try {
    const page = await doc.getPage(1);
    const height = page.getViewport({ scale: 1 }).height;
    const content = await page.getTextContent();
    return content.items.flatMap((item) => {
      if (!("str" in item) || item.str.trim() === "") return [];
      const [, , , , x, y] = item.transform as number[];
      return [{ str: item.str, x0: x, x1: x + item.width, top: height - y - item.height, bottom: height - y }];
    });
  } finally {
    await doc.destroy();
  }
}

export interface ParagraphGaps {
  /** Lines the paragraph wrapped onto on page 1. */
  lines: number;
  /** The widest white gap between two of the paragraph's own lines, in points. */
  lineGapPt: number;
  /** The white gap between the paragraph's last line and the next ink below it (a heading or its rule), in points. */
  gapBelowPt: number;
}

/**
 * Measures, in pixels, how much white sits between a paragraph's last line and the next thing under it,
 * next to how much sits between the paragraph's own lines. A heading that is "flush" under a paragraph has
 * the same gap below as between lines.
 *
 * The paragraph is found by its text (every run that is a piece of `paragraph`). Only its own horizontal span
 * is scanned, so a sidebar or rail beside it never counts as "ink below".
 */
export async function measureParagraphGaps(pdf: Buffer, paragraph: string): Promise<ParagraphGaps> {
  // The paragraph's lines: start at the run that opens it, then take the runs directly under it in the same
  // column (same left edge, next line down) that are also pieces of the paragraph. A stray word elsewhere on the
  // page that merely appears in the paragraph ("Operations" in a job title) is not contiguous with it.
  const all = (await firstPageText(pdf)).sort((a, b) => a.top - b.top);
  const opening = all.find((b) => paragraph.startsWith(b.str.trim()) && b.str.trim().length > 8);
  if (!opening) throw new Error(`no text of the paragraph "${paragraph.slice(0, 30)}..." on page 1`);
  const runs = [opening];
  for (const b of all) {
    const prev = runs[runs.length - 1];
    if (b.top <= prev.top + 1) continue;
    if (b.top - prev.top > 30) break;
    if (Math.abs(b.x0 - opening.x0) < 2 && paragraph.includes(b.str.trim())) runs.push(b);
  }
  const x0 = Math.min(...runs.map((b) => b.x0));
  const x1 = Math.max(...runs.map((b) => b.x1));
  const top = Math.min(...runs.map((b) => b.top));
  const bottom = Math.max(...runs.map((b) => b.bottom));
  const lines = new Set(runs.map((b) => Math.round(b.top))).size;

  const [page] = rasterisePdf(pdf);
  const ink = (y: number): boolean => {
    for (let px = Math.floor(x0 / PT_PER_PX); px < Math.min(page.width, Math.ceil(x1 / PT_PER_PX) + 1); px++) {
      const i = (y * page.width + px) * 3;
      if (page.pixels[i] < 200 || page.pixels[i + 1] < 200 || page.pixels[i + 2] < 200) return true;
    }
    return false;
  };

  // Ink-row clusters from just above the paragraph to well below it.
  const clusters: Array<[number, number]> = [];
  const end = Math.min(page.height, Math.ceil((bottom + 80) / PT_PER_PX));
  for (let y = Math.floor((top - 2) / PT_PER_PX); y < end; ) {
    if (ink(y)) {
      const start = y;
      while (y < page.height && ink(y)) y++;
      clusters.push([start, y - 1]);
    } else y++;
  }
  const gaps = clusters.slice(1).map(([start], i) => (start - clusters[i][1] - 1) * PT_PER_PX);
  const lineGaps = gaps.slice(0, lines - 1);
  return {
    lines,
    lineGapPt: lineGaps.length ? Math.max(...lineGaps) : 0,
    gapBelowPt: gaps.length >= lines ? gaps[lines - 1] : -1,
  };
}
