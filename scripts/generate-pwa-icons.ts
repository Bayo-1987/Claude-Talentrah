/**
 * One-off generator for the installable-app icons. NOT part of the build: the PNGs it writes are committed, and `npm run build` never
 * runs this. Re-run it only if public/talentrah-mark.svg or the paper colour changes:
 *
 *   npx tsx scripts/generate-pwa-icons.ts
 *
 * `sharp` is already a direct dependency (next/image uses it); this adds nothing.
 *
 * Five files, ALL OPAQUE (paper #f9f8f5 behind the mark), none of them the share image:
 *   talentrah-mark-any-192.png / -any-512.png   manifest purpose "any"  the mark drawn as the favicon/share artwork is, on paper. A transparent "any" icon gets whatever colour
 *                                               the launcher puts behind it.
 *   talentrah-mark-apple-180.png                the Apple touch icon (layout.tsx): iOS draws BLACK behind transparent pixels, so it is opaque too. iOS rounds the corners itself.
 *   talentrah-mark-maskable-512.png / -192.png  manifest purpose "maskable"  the mark inside the safe zone
 * talentrah-mark-512.png (the share image and a favicon entry) and the 16, 32, 48 and 180 favicon-era files are NOT touched: tests/pwa/icons.test.ts pins their sha256.
 *
 * WHY A SEPARATE MASKABLE FILE. A platform may crop a maskable icon to a circle or a squircle and fills nothing itself, so the image has to
 * carry its own opaque background and keep everything that matters inside the central safe zone (a circle of radius 40% of the side). The
 * "any" icon is shown uncropped on a launcher's own background, so it keeps its transparency. One image must never serve both purposes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { PAPER_HEX } from "../src/lib/pwa/colors";

const ROOT = path.resolve(__dirname, "..");
const SVG = readFileSync(path.join(ROOT, "public/talentrah-mark.svg"), "utf8");
const SHAPES = SVG.match(/<rect[^>]*\/>/g);
if (!SHAPES || SHAPES.length !== 3) throw new Error("public/talentrah-mark.svg no longer holds the three rects this script expects");
const BODY = SHAPES.join("");

// The mark's own bounding box inside its 100 x 100 viewBox (x 14..80, y 8..86): the centre, and the radius of the smallest circle around it.
const CX = 47;
const CY = 47;
const RADIUS = Math.hypot(33, 39); // ~51.1 viewBox units, the farthest corner from the centre
// The farthest corner may sit at most 36% of the side from the centre: inside the 40% safe-zone circle with a margin for rounding.
const SAFE_FRACTION = 0.36;

function anySvg(size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">${BODY}</svg>`;
}

function maskableSvg(size: number): string {
  const scale = (size * SAFE_FRACTION) / RADIUS;
  const tx = size / 2 - CX * scale;
  const ty = size / 2 - CY * scale;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
    `<rect width="${size}" height="${size}" fill="${PAPER_HEX}"/>` +
    `<g transform="translate(${tx} ${ty}) scale(${scale})">${BODY}</g></svg>`
  );
}

async function write(file: string, size: number, svg: string, opaque: boolean) {
  // Rasterised at 4x and scaled down, so edges are antialiased rather than drawn at 1x.
  let img = sharp(Buffer.from(svg), { density: 288 }).resize(size, size);
  // An opaque icon is flattened onto paper so no pixel anywhere (corners included) carries alpha.
  if (opaque) img = img.flatten({ background: PAPER_HEX });
  const buf = await img.png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(path.join(ROOT, "public/icons", file), buf);
  console.log(`wrote public/icons/${file} (${buf.length} bytes)`);
}

function anyOpaqueSvg(size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}"><rect width="100" height="100" fill="${PAPER_HEX}"/>${BODY}</svg>`;
}

async function main() {
  await write("talentrah-mark-any-192.png", 192, anyOpaqueSvg(192), true);
  await write("talentrah-mark-any-512.png", 512, anyOpaqueSvg(512), true);
  await write("talentrah-mark-apple-180.png", 180, anyOpaqueSvg(180), true);
  await write("talentrah-mark-maskable-512.png", 512, maskableSvg(512), true);
  await write("talentrah-mark-maskable-192.png", 192, maskableSvg(192), true);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
