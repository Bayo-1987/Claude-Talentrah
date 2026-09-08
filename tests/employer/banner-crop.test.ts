/**
 * banner-crop.ts — the client-side crop-tool logic that replaced the old
 * hard 3:1–5:1 rejection at pick time.
 *
 * WHAT THIS FILE DOES AND DOES NOT COVER. `isCroppable`/`maxCroppableWidth`/
 * `maxZoomForCrop`/`chooseOutputBlob` are pure arithmetic and are exercised
 * directly here. `renderCroppedBanner` — the actual canvas draw + encode —
 * is NOT unit-tested: it needs `HTMLImageElement`, `HTMLCanvasElement` and
 * `canvas.toBlob`, real browser APIs this project has no jsdom or `canvas`
 * package to fake (confirmed: every other component test here renders via
 * `renderToStaticMarkup` under vitest's `node` environment for exactly this
 * reason — see tests/ui/google-one-tap.test.tsx's own header). Every DECISION
 * that function makes is pulled into the pure functions tested below; the
 * canvas glue itself is exercised by the real browser, not this suite.
 *
 * THE ROUND-TRIP TEST below is what actually proves client and server agree:
 * it constructs a real PNG at exactly CROP_OUTPUT_WIDTH×CROP_OUTPUT_HEIGHT
 * (what renderCroppedBanner ALWAYS produces, whatever region was cropped —
 * the output size is fixed, not derived from the crop) and feeds it through
 * banner.ts's own real, unmodified `validateBanner`. It passes not because
 * of anything this file does cleverly, but because the fixed output ratio
 * (exactly BANNER_RATIO) was always inside the accepted band — which is the
 * actual invariant this test exists to pin down.
 */
import { describe, expect, it } from "vitest";
import {
  isCroppable,
  maxCroppableWidth,
  maxZoomForCrop,
  chooseOutputBlob,
  CROP_OUTPUT_WIDTH,
  CROP_OUTPUT_HEIGHT,
  PNG_SIZE_FALLBACK_THRESHOLD_BYTES,
} from "@/lib/employer/banner-crop";
import { validateBanner, MIN_BANNER_WIDTH, BANNER_RATIO, MAX_BANNER_BYTES } from "@/lib/employer/banner";

/** Same minimal-but-real PNG builder as tests/employer/banner.test.ts. */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  b.set([(width >> 24) & 255, (width >> 16) & 255, (width >> 8) & 255, width & 255], 16);
  b.set([(height >> 24) & 255, (height >> 16) & 255, (height >> 8) & 255, height & 255], 20);
  return b;
}

describe("maxCroppableWidth — the geometry behind the pre-flight check", () => {
  it("is bounded by width when the image is wide enough that height is never the constraint", () => {
    // min(4000, 4*2000=8000) = 4000
    expect(maxCroppableWidth(4000, 2000)).toBe(4000);
  });

  it("is bounded by 4*height when the image is too tall/narrow for its own width to matter", () => {
    // min(1000, 4*5000=20000) = 1000
    expect(maxCroppableWidth(1000, 5000)).toBe(1000);
  });

  it("is the same value from either side exactly at the crossover, where width and 4*height are equal", () => {
    // width=4800, height=1200: BANNER_RATIO*height = 4*1200 = 4800 = width.
    // Neither term is "the" constraint here — both give the same answer.
    expect(maxCroppableWidth(4800, 1200)).toBe(4800);
  });
});

describe("isCroppable — replaces the old hard ratio rejection", () => {
  it("ACCEPTS the founder's own reported case: a 1200x1200 square, refused outright by the old ratio check", () => {
    // min(1200, 4*1200=4800) = 1200 >= MIN_BANNER_WIDTH (1200) — accepted.
    // The old code refused this at "1.0:1" with no way to recover it; this
    // is the exact bug report this feature exists to fix.
    expect(maxCroppableWidth(1200, 1200)).toBe(1200);
    expect(isCroppable(1200, 1200)).toBe(true);
  });

  it("REJECTS a genuinely too-small case, with the arithmetic named", () => {
    // 900x900: min(900, 3600) = 900 < 1200 — even the widest possible 4:1
    // slice of this source would be softer than the accepted floor.
    expect(maxCroppableWidth(900, 900)).toBe(900);
    expect(isCroppable(900, 900)).toBe(false);
  });

  it("REJECTS a too-extreme (tall, narrow) case that a naive width-only check might miss the REASON for", () => {
    // 1000x5000: no matter how much height is available, the crop can never
    // be wider than the source's own native width. min(1000, 20000) = 1000
    // < 1200 — rejected, and for the right reason (native width, not shape).
    expect(maxCroppableWidth(1000, 5000)).toBe(1000);
    expect(isCroppable(1000, 5000)).toBe(false);
  });

  it("accepts exactly at the boundary and rejects one pixel below it", () => {
    expect(isCroppable(MIN_BANNER_WIDTH, MIN_BANNER_WIDTH / BANNER_RATIO)).toBe(true);
    expect(isCroppable(MIN_BANNER_WIDTH - 1, MIN_BANNER_WIDTH / BANNER_RATIO)).toBe(false);
  });
});

describe("maxZoomForCrop — bounds zoom so the output is never upscaled below the accepted floor", () => {
  it("is exactly 1 (no zoom-in allowed) for a source with no margin above the floor", () => {
    // A 1200x1200 square: maxCroppableWidth is exactly MIN_BANNER_WIDTH, so
    // any further zoom would push the native crop resolution BELOW the
    // floor the rest of this system already treats as the minimum.
    expect(maxZoomForCrop(1200, 1200)).toBe(1);
  });

  it("allows real zoom range for a high-resolution source", () => {
    // 4800x1200: maxCroppableWidth = min(4800, 4800) = 4800.
    // maxZoom = 4800 / 1200 = 4.
    expect(maxZoomForCrop(4800, 1200)).toBe(4);
  });

  it("never goes below 1 even if somehow called on an uncroppable source", () => {
    expect(maxZoomForCrop(500, 500)).toBe(1);
  });
});

describe("chooseOutputBlob — PNG unless it is over budget", () => {
  it("prefers PNG when it fits under the threshold", () => {
    const pngBlob = new Blob([new Uint8Array(1000)]);
    const jpegBlob = new Blob([new Uint8Array(500)]);
    const result = chooseOutputBlob(pngBlob, jpegBlob);
    expect(result.type).toBe("image/png");
    expect(result.blob).toBe(pngBlob);
  });

  it("falls back to JPEG when PNG exceeds the threshold", () => {
    const oversizedPngBlob = new Blob([new Uint8Array(PNG_SIZE_FALLBACK_THRESHOLD_BYTES + 1)]);
    const jpegBlob = new Blob([new Uint8Array(200_000)]);
    const result = chooseOutputBlob(oversizedPngBlob, jpegBlob);
    expect(result.type).toBe("image/jpeg");
    expect(result.blob).toBe(jpegBlob);
  });

  it("accepts PNG exactly AT the threshold — the boundary is inclusive", () => {
    const pngBlob = new Blob([new Uint8Array(PNG_SIZE_FALLBACK_THRESHOLD_BYTES)]);
    const jpegBlob = new Blob([new Uint8Array(1)]);
    expect(chooseOutputBlob(pngBlob, jpegBlob).type).toBe("image/png");
  });

  it("the threshold itself leaves real headroom under the hard server cap", () => {
    expect(PNG_SIZE_FALLBACK_THRESHOLD_BYTES).toBeLessThan(MAX_BANNER_BYTES);
    expect(PNG_SIZE_FALLBACK_THRESHOLD_BYTES).toBeGreaterThan(MAX_BANNER_BYTES / 2);
  });
});

describe("the crop tool's fixed output always agrees with the server's unmodified validateBanner", () => {
  it("CROP_OUTPUT_WIDTH x CROP_OUTPUT_HEIGHT is exactly BANNER_RATIO, comfortably inside the 3:1-5:1 band", () => {
    expect(CROP_OUTPUT_WIDTH / CROP_OUTPUT_HEIGHT).toBe(BANNER_RATIO);
  });

  it(
    "ROUND TRIP: a real PNG at the crop tool's fixed output size passes the server's real, unmodified validateBanner — proving the client step and the untouched server check actually agree",
    () => {
      // This is exactly what renderCroppedBanner always produces, regardless
      // of what region of the source was cropped — the canvas target size is
      // fixed, never derived from the crop area. So this one shape stands in
      // for every possible crop.
      const bytes = png(CROP_OUTPUT_WIDTH, CROP_OUTPUT_HEIGHT);
      const verdict = validateBanner({
        bytes,
        byteLength: bytes.length,
        width: CROP_OUTPUT_WIDTH,
        height: CROP_OUTPUT_HEIGHT,
      });
      expect(verdict.ok).toBe(true);
      if (verdict.ok) {
        expect(verdict.type).toBe("image/png");
        expect(verdict.width).toBe(CROP_OUTPUT_WIDTH);
        expect(verdict.height).toBe(CROP_OUTPUT_HEIGHT);
      }
    },
  );
});
