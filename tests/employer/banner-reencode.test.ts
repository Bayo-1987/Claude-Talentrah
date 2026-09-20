/**
 * send-408 — server-side re-encoding for job banners.
 *
 * Before this, the upload route (`api/employer/job-banner/route.ts`) stored
 * whatever bytes `validateBanner` accepted, as-is. `validateBanner` only
 * bounds SIZE (<=2MB) and PIXEL DIMENSIONS (1200-3000px wide, 3:1-5:1 ratio),
 * not compression — an uncompressed-but-otherwise-valid upload sailed
 * straight through to a public bucket, uncompressed. This exercises
 * `reencodeBannerForStorage`, the function that closes that gap.
 *
 * Real `sharp`-generated fixtures, not hand-rolled header bytes. The other
 * fixtures in banner.test.ts are minimal-but-real headers because
 * `readImageDimensions` deliberately doesn't decode (its own comment says
 * why); this function's whole job IS decoding, so a fixture that isn't a
 * real, fully-decodable image would test nothing.
 */
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { MAX_BANNER_BYTES, SERVER_ENCODE_MAX_WIDTH } from "@/lib/employer/banner";
import { reencodeBannerForStorage } from "@/lib/employer/banner-reencode";

/** A real, fully-decodable PNG of the given size and ratio, as raw bytes. */
async function realPng(width: number, height: number): Promise<Uint8Array> {
  const buf = await sharp({
    create: {
      width,
      height,
      channels: 3,
      // A gradient, not a flat fill — a flat color compresses to almost
      // nothing regardless of encoder quality, which would prove nothing
      // about whether re-encoding actually ran.
      background: { r: 120, g: 160, b: 200 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
            `<stop offset="0%" stop-color="#1a2b3c"/><stop offset="100%" stop-color="#f0e0c0"/></linearGradient></defs>` +
            `<rect width="100%" height="100%" fill="url(#g)"/></svg>`,
        ),
      },
    ])
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

describe("reencodeBannerForStorage", () => {
  it("downsizes an oversized upload to SERVER_ENCODE_MAX_WIDTH, preserving its own ratio", async () => {
    // 2400x600 = 4:1, inside banner.ts's accepted 3:1-5:1 band and under
    // MAX_BANNER_WIDTH (3000) — a real, validateBanner-accepted upload wider
    // than the resize target.
    const bytes = await realPng(2400, 600);
    const result = await reencodeBannerForStorage({ bytes, type: "image/png" });
    expect(result.width).toBe(SERVER_ENCODE_MAX_WIDTH);
    expect(result.height).toBe(SERVER_ENCODE_MAX_WIDTH / 4);
  });

  it("does NOT upscale an upload already narrower than SERVER_ENCODE_MAX_WIDTH", async () => {
    // 1200x300 is banner.ts's own accepted floor (MIN_BANNER_WIDTH/HEIGHT) —
    // the case `withoutEnlargement` exists for.
    const bytes = await realPng(1200, 300);
    const result = await reencodeBannerForStorage({ bytes, type: "image/png" });
    expect(result.width).toBe(1200);
    expect(result.height).toBe(300);
  });

  it("does not force a fixed height, so a non-4:1 accepted ratio is not distorted", async () => {
    // 1500x500 = 3:1, the OTHER edge of banner.ts's accepted band. Forcing a
    // fixed CROP_OUTPUT_HEIGHT-style output here would squash it — this
    // function must leave the aspect ratio exactly as it came in.
    const bytes = await realPng(1500, 500);
    const result = await reencodeBannerForStorage({ bytes, type: "image/png" });
    expect(result.width).toBe(1500);
    expect(result.height).toBe(500);
  });

  it("shrinks the bytes of an uncompressed-shaped upload — the actual gap this closes", async () => {
    const bytes = await realPng(2400, 600);
    const result = await reencodeBannerForStorage({ bytes, type: "image/png" });
    // Resizing 2400->1600 alone drops pixel count to ~44% before recompression
    // even touches it, so a real reduction is expected, not just plausible.
    expect(result.bytes.length).toBeLessThan(bytes.length);
    expect(result.bytes.length).toBeLessThan(MAX_BANNER_BYTES);
  });

  it("re-encodes JPEG and WebP too, not just PNG", async () => {
    const png = await realPng(2000, 500);
    for (const type of ["image/jpeg", "image/webp"] as const) {
      const converted = await sharp(Buffer.from(png))
        [type === "image/jpeg" ? "jpeg" : "webp"]()
        .toBuffer();
      const result = await reencodeBannerForStorage({
        bytes: new Uint8Array(converted),
        type,
      });
      expect(result.width).toBe(SERVER_ENCODE_MAX_WIDTH);
      expect(result.height).toBe(SERVER_ENCODE_MAX_WIDTH / 4);
    }
  });

  it("REGRESSION: throws on bytes sharp cannot actually decode, rather than returning garbage", async () => {
    // Passes banner.ts's own magic-byte sniff (PNG signature) but has no
    // valid IHDR/IDAT to decode — the case the route's try/catch exists for.
    const fakePng = new Uint8Array(64);
    fakePng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    await expect(reencodeBannerForStorage({ bytes: fakePng, type: "image/png" })).rejects.toThrow();
  });
});
