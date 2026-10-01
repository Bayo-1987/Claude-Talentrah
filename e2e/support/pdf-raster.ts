import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Rasterises a PDF with poppler's `pdftoppm` and measures the blank band at
 * the top and bottom of each page, in points — what a reader sees as the page
 * margin. e2e/resume-print-margins.spec.ts uses it to assert real top/bottom
 * space on every printed page.
 *
 * Measuring pixels rather than reading text positions out of the PDF is the
 * point: it answers "how much paper is white above the first ink?", which is
 * exactly the claim, including for anything that is not text (rules, borders).
 *
 * CI (ubuntu) gets pdftoppm from the `poppler-utils` apt package, installed in
 * the e2e job of .github/workflows/ci.yml.
 */

export const RASTER_DPI = 144;
const PT_PER_PX = 72 / RASTER_DPI;

export function pdftoppmAvailable(): boolean {
  const result = spawnSync("pdftoppm", ["-v"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

interface RasterPage {
  width: number;
  height: number;
  /** RGB, 3 bytes per pixel, row-major. */
  pixels: Buffer;
}

/** Parses the binary PPM (P6) that `pdftoppm` writes when no format flag is given. */
function parsePpm(data: Buffer): RasterPage {
  let offset = 0;
  const token = (): string => {
    while (offset < data.length && /\s/.test(String.fromCharCode(data[offset]))) offset++;
    // Comment lines start with '#'.
    while (data[offset] === 0x23) {
      while (offset < data.length && data[offset] !== 0x0a) offset++;
      while (offset < data.length && /\s/.test(String.fromCharCode(data[offset]))) offset++;
    }
    const start = offset;
    while (offset < data.length && !/\s/.test(String.fromCharCode(data[offset]))) offset++;
    return data.toString("latin1", start, offset);
  };
  const magic = token();
  if (magic !== "P6") throw new Error(`expected a P6 PPM from pdftoppm, got "${magic}"`);
  const width = Number(token());
  const height = Number(token());
  const maxval = Number(token());
  if (maxval !== 255) throw new Error(`expected an 8-bit PPM, got maxval ${maxval}`);
  offset += 1; // the single whitespace byte after the header
  return { width, height, pixels: data.subarray(offset, offset + width * height * 3) };
}

export function rasterisePdf(pdf: Buffer): RasterPage[] {
  const dir = mkdtempSync(path.join(tmpdir(), "talentrah-pdf-"));
  try {
    writeFileSync(path.join(dir, "in.pdf"), pdf);
    const result = spawnSync("pdftoppm", ["-r", String(RASTER_DPI), path.join(dir, "in.pdf"), path.join(dir, "page")], {
      encoding: "utf8",
    });
    if (result.status !== 0) throw new Error(`pdftoppm failed: ${result.stderr || result.error}`);
    return readdirSync(dir)
      .filter((f) => f.startsWith("page-") && f.endsWith(".ppm"))
      .sort()
      .map((f) => parsePpm(readFileSync(path.join(dir, f))));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A row counts as blank if every pixel in it is near-white. 250 tolerates anti-aliasing noise without admitting real ink. */
function rowIsBlank(page: RasterPage, y: number): boolean {
  const start = y * page.width * 3;
  const end = start + page.width * 3;
  for (let i = start; i < end; i++) if (page.pixels[i] < 250) return false;
  return true;
}

/** Height in points of the white band above the first inked row of a page. */
export function whiteSpaceAtTopPt(page: RasterPage): number {
  let y = 0;
  while (y < page.height && rowIsBlank(page, y)) y++;
  return y * PT_PER_PX;
}

/** Height in points of the white band below the last inked row of a page. */
export function whiteSpaceAtBottomPt(page: RasterPage): number {
  let y = 0;
  while (y < page.height && rowIsBlank(page, page.height - 1 - y)) y++;
  return y * PT_PER_PX;
}
