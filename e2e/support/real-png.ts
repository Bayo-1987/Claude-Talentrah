import { deflateSync } from "node:zlib";

/**
 * A genuinely decodable PNG — not the header-only fake in
 * tests/employer/banner.test.ts's own `png()` helper, which is enough to
 * feed `validateBanner` (it only reads the IHDR header) but NOT enough for
 * a real browser's `createImageBitmap`/`<img>` decode, which is what
 * e2e/employer-new-job-banner.spec.ts needs: BannerCropPicker's own `onPick`
 * calls `createImageBitmap` before a crop dialog ever opens, and
 * react-easy-crop's `<Cropper>` decodes the image again to actually draw it.
 * Solid RGB fill, uncompressed-but-valid deflate stream, real CRC32s.
 */
export function makeRealPng(width: number, height: number, rgb: [number, number, number] = [200, 60, 40]): Buffer {
  const [r, g, b] = rgb;
  const bytesPerPixel = 3;
  const stride = 1 + width * bytesPerPixel; // filter-type byte + one row of RGB
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter type "None"
    for (let x = 0; x < width; x++) {
      const p = rowStart + 1 + x * bytesPerPixel;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }
  const idatData = deflateSync(raw);

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: truecolor (RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdrData),
    chunk("IDAT", idatData),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

let crcTable: Uint32Array | null = null;
function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32(buf: Buffer): number {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
