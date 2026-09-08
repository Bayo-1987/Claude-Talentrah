/**
 * The client-only half of job-posting banners: whether a picked image can
 * ever be cropped to a usable banner, and how the chosen crop region is
 * rendered to the fixed output `banner.ts`'s server-side `validateBanner`
 * always accepts.
 *
 * ── WHY THIS IS A SEPARATE FILE FROM banner.ts ────────────────────────────
 *
 * `banner.ts` is the RULE — read there for what a valid stored banner is,
 * and it has zero changes here. Everything in THIS file only decides what
 * happens client-side, in the browser, before a byte is ever uploaded: can
 * this source image produce a decent crop at all, and how do we turn the
 * region the employer chose into the fixed-size file `banner.ts` validates.
 * None of it runs on the server, and none of it is trusted by the server —
 * the upload route re-derives everything it cares about from the bytes it
 * actually receives, exactly as before.
 *
 * ── WHY THE OUTPUT SIZE IS FIXED REGARDLESS OF WHAT WAS CROPPED ───────────
 *
 * `renderCroppedBanner` always draws onto a CROP_OUTPUT_WIDTH ×
 * CROP_OUTPUT_HEIGHT canvas, whatever region was selected. That is what keeps
 * `banner.ts`'s existing 3:1–5:1 band and size floor/ceiling meaningful
 * without touching them: every file this produces is exactly 1600×400 (ratio
 * exactly 4), which was already comfortably inside the accepted band before
 * this existed and still is. The crop step's own job is choosing WHICH part
 * of the source becomes that fixed rectangle, not what shape the rectangle
 * is.
 */
import { BANNER_RATIO, MAX_BANNER_BYTES, MIN_BANNER_WIDTH, type BannerMimeType } from "./banner";

/**
 * The widest BANNER_RATIO:1 region obtainable from a `sourceWidth × sourceHeight`
 * image without upscaling the source.
 *
 * A crop region of width `Cw` and height `Ch = Cw / BANNER_RATIO` fits inside
 * the source only if `Cw <= sourceWidth` AND `Ch <= sourceHeight` (i.e.
 * `Cw <= BANNER_RATIO * sourceHeight`). Maximizing `Cw` under both bounds at
 * once is exactly `min(sourceWidth, BANNER_RATIO * sourceHeight)` — the
 * larger the source is in EITHER dimension beyond what the other allows, the
 * less it helps, because the crop is capped by whichever dimension runs out
 * first.
 */
export function maxCroppableWidth(sourceWidth: number, sourceHeight: number): number {
  return Math.min(sourceWidth, BANNER_RATIO * sourceHeight);
}

/**
 * Whether a source image can EVER produce a sharp BANNER_RATIO crop — the
 * pre-flight check that replaces the old hard ratio rejection.
 *
 * Deliberately checks the ACHIEVABLE crop width, not the source's own
 * width/height independently, which is what makes this accept a square (or
 * any shape) rather than reject everything that isn't already close to 4:1.
 * A 1200×1200 image passes (min(1200, 4800) = 1200 ≥ 1200) even though it
 * fails the OLD ratio check outright — that square-image rejection is
 * exactly the bug this exists to fix. A 1000×5000 image — tall enough that
 * height is never the constraint — still fails (min(1000, 20000) = 1000 <
 * 1200): no matter how much height is available, the crop can never be wider
 * than the source's own native width, so an image that narrow can never
 * produce a sharp 1200px-plus-wide 4:1 slice.
 *
 * WORTH BEING HONEST ABOUT: with today's exact constants (MIN_BANNER_WIDTH =
 * 1200, MIN_BANNER_HEIGHT = 300, and 4 × 300 = 1200), this reduces
 * numerically to `sourceWidth >= 1200 && sourceHeight >= 300` — the very
 * check this function exists to replace. That is a coincidence of these two
 * particular numbers matching up, not a property of the formula, and it is
 * why this is still written from the geometry (`BANNER_RATIO` × height),
 * not as two independent thresholds: if `MIN_BANNER_HEIGHT` is ever changed
 * without also changing `MIN_BANNER_WIDTH` in lockstep, an independent-AND
 * check would silently stop matching what is actually croppable, while this
 * one keeps deriving the real answer from the ratio and the one width floor.
 */
export function isCroppable(sourceWidth: number, sourceHeight: number): boolean {
  return maxCroppableWidth(sourceWidth, sourceHeight) >= MIN_BANNER_WIDTH;
}

/**
 * The largest zoom the crop UI should allow for a given source image.
 *
 * At zoom 1 with `cover` fit, the crop frame already shows the widest
 * possible BANNER_RATIO region — `maxCroppableWidth` above. Zooming in
 * samples a proportionally SMALLER native region to fill the same on-screen
 * frame, so the region's native pixel width falls as zoom rises. Capping
 * zoom at `maxCroppableWidth / MIN_BANNER_WIDTH` is what stops the employer
 * from zooming in far enough that the exported crop's native resolution
 * drops below the same sharpness floor `isCroppable` and `banner.ts` already
 * treat as the accepted minimum elsewhere in this system — not a new,
 * separately-invented number.
 *
 * Never below 1: a source that only just clears `isCroppable` should not
 * zoom in at all, since it has no margin above the floor to spend.
 */
export function maxZoomForCrop(sourceWidth: number, sourceHeight: number): number {
  return Math.max(1, maxCroppableWidth(sourceWidth, sourceHeight) / MIN_BANNER_WIDTH);
}

/** 1600×400 — BANNER_GUIDANCE's own "ideal" number, and exactly BANNER_RATIO. */
export const CROP_OUTPUT_WIDTH = 1600;
export const CROP_OUTPUT_HEIGHT = CROP_OUTPUT_WIDTH / BANNER_RATIO;

/**
 * PNG stays crisp for the text/logo graphics most banners actually are, so
 * it is the default output. The risk PNG carries is the opposite one: it is
 * LOSSLESS, so a photographic banner (gradients, noise, a real photo) can
 * re-encode far larger than the same image as JPEG — potentially past the 2
 * MB cap where a JPEG at high quality would not come close.
 *
 * 75% of MAX_BANNER_BYTES (1.5 MB): high enough that a real logo/text banner
 * — typically tens to a few hundred KB as PNG — is never pushed to JPEG
 * unnecessarily, low enough to leave real headroom before the hard 2 MB
 * cap rather than deciding the format right at the wire.
 */
export const PNG_SIZE_FALLBACK_THRESHOLD_BYTES = Math.floor(MAX_BANNER_BYTES * 0.75);

/** Quality for the JPEG fallback — high enough that the format switch itself isn't visible. */
export const JPEG_FALLBACK_QUALITY = 0.9;

/**
 * PNG unless it came in over the threshold, in which case the JPEG
 * alternative — pure decision, no encoding, so it is testable with any two
 * Blobs regardless of what bytes they actually hold.
 */
export function chooseOutputBlob(
  pngBlob: Blob,
  jpegBlob: Blob,
): { blob: Blob; type: BannerMimeType } {
  if (pngBlob.size <= PNG_SIZE_FALLBACK_THRESHOLD_BYTES) {
    return { blob: pngBlob, type: "image/png" };
  }
  return { blob: jpegBlob, type: "image/jpeg" };
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the image for cropping."));
    img.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the cropped image."))),
      type,
      quality,
    );
  });
}

/**
 * Draws the chosen source region onto a fixed CROP_OUTPUT_WIDTH ×
 * CROP_OUTPUT_HEIGHT canvas and encodes it, trying PNG first and falling
 * back to JPEG only if PNG comes in over budget (see
 * PNG_SIZE_FALLBACK_THRESHOLD_BYTES).
 *
 * `cropPixels` is react-easy-crop's own `onCropComplete` pixel area — the
 * source region in the image's NATIVE pixel coordinates, already bounded to
 * the image by the cropper's `restrictPosition` and this file's own
 * `maxZoomForCrop`, so this never reads outside the source's own bounds.
 *
 * NOT UNIT-TESTED. `HTMLImageElement`/`HTMLCanvasElement`/`canvas.toBlob` are
 * real browser APIs this project has no jsdom or `canvas` package to fake —
 * see the header on `readImageDimensions` in banner.ts for the same
 * reasoning applied to a different function. Every DECISION this function
 * makes (the output size, the PNG/JPEG threshold) is pulled out into the
 * pure, tested functions above; what is left here is thin drawing glue,
 * exercised by the actual browser rather than by this suite.
 */
export async function renderCroppedBanner(
  imageSrc: string,
  cropPixels: { x: number; y: number; width: number; height: number },
): Promise<{ blob: Blob; type: BannerMimeType }> {
  const image = await loadImageElement(imageSrc);

  const canvas = document.createElement("canvas");
  canvas.width = CROP_OUTPUT_WIDTH;
  canvas.height = CROP_OUTPUT_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not prepare the crop.");

  ctx.drawImage(
    image,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    CROP_OUTPUT_WIDTH,
    CROP_OUTPUT_HEIGHT,
  );

  const pngBlob = await canvasToBlob(canvas, "image/png");
  if (pngBlob.size <= PNG_SIZE_FALLBACK_THRESHOLD_BYTES) {
    return { blob: pngBlob, type: "image/png" };
  }
  const jpegBlob = await canvasToBlob(canvas, "image/jpeg", JPEG_FALLBACK_QUALITY);
  return chooseOutputBlob(pngBlob, jpegBlob);
}
