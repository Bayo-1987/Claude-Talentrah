/**
 * Job-posting banners: what a valid one is, and where it lives.
 *
 * Pure functions with no database and no network, so every branch is testable
 * and the rules can be asserted rather than described.
 */

/** The one bucket banners live in. Public read; writes are org-scoped (0115). */
export const BANNER_BUCKET = "job-banners";

/**
 * 2 MB.
 *
 * EGRESS IS THE BINDING CONSTRAINT, NOT STORAGE, and that is what set this
 * number. The free plan allows 5 GB of egress a month against 1 GB of storage,
 * so at this cap the ceiling is roughly 2,500 job-detail views a month —
 * reached long before the disk fills. A well-encoded 1600×400 JPEG is
 * 150–400 KB, so this is a guard against a pathological upload rather than the
 * expected size.
 *
 * Worth stating plainly because it changes what the right fix is later: with
 * no server-side re-encoding, THE CAP IS THE WORST CASE. If egress starts to
 * bite, re-encode on upload (sharp) rather than lowering this — a lower cap
 * rejects legitimate artwork, re-encoding fixes the bytes actually served.
 * Supabase's image transformations would solve it outright but are Pro-only.
 */
export const MAX_BANNER_BYTES = 2 * 1024 * 1024;

export const ACCEPTED_BANNER_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type BannerMimeType = (typeof ACCEPTED_BANNER_TYPES)[number];

/**
 * 4:1, rendered 760×190 in the detail page's own max-w-[760px] column.
 *
 * Chosen against that real width rather than in the abstract: 3:1 is 253px
 * tall there and starts competing with the title block for the fold, 5:1 is
 * 152px and reads as a sliver that wastes the upload. 4:1 is also LinkedIn's
 * personal-cover ratio, so employers already have artwork cut to it.
 *
 * The ACCEPTED band is wider than the rendered ratio on purpose. Artwork cut
 * for LinkedIn's company page (~5.9:1) or a near-miss export should not be
 * refused over a few percent; anything inside the band is rendered into a
 * fixed 4:1 box with object-cover, so the page always gets a header strip
 * whatever came in. Outside it, the crop would lose so much that silently
 * doing it would be worse than saying no.
 */
export const BANNER_RATIO = 4;
export const MIN_BANNER_RATIO = 3;
export const MAX_BANNER_RATIO = 5;

/** 760 CSS px wants ~1520 device px on a 2× display; 1200 is the pragmatic floor. */
export const MIN_BANNER_WIDTH = 1200;
export const MIN_BANNER_HEIGHT = 300;
/** Bounds decode cost for something displayed 760px wide. */
export const MAX_BANNER_WIDTH = 3000;

/**
 * What the upload UI tells someone BEFORE they pick a file.
 *
 * Changed from "Wide and short, like a LinkedIn cover — 1600×400 is ideal"
 * when that stopped being a hard requirement: the upload component now
 * accepts any croppable image and lets the employer crop it to a 1600×400
 * strip themselves (src/lib/employer/banner-crop.ts), so a copy promising a
 * specific SOURCE shape would be actively wrong about what happens next.
 */
export const BANNER_GUIDANCE =
  "Upload any image — you'll crop it to a wide banner strip before it saves. PNG, JPEG or WebP, up to 2 MB.";

/**
 * FILE SIGNATURE, NOT THE CLAIMED CONTENT-TYPE.
 *
 * The browser's `File.type` and the filename extension are both supplied by
 * whoever is uploading, so neither says anything about what the bytes are. The
 * moment this product accepts an upload at all, "a renamed executable claiming
 * to be a PNG" stops being hypothetical, and a public bucket serving it back
 * under our own domain is the part that matters.
 *
 * Reads the magic bytes instead:
 *
 *   PNG   89 50 4E 47 0D 0A 1A 0A
 *   JPEG  FF D8 FF
 *   WebP  "RIFF" .... "WEBP"   (bytes 0-3 and 8-11)
 *
 * Returns the type the BYTES are, not the one that was claimed, so the caller
 * can reject a mismatch rather than trust either side.
 */
export function sniffImageType(bytes: Uint8Array): BannerMimeType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
      bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a &&
      bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export const EXTENSION_FOR: Record<BannerMimeType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * The object path a posting's banner must live at.
 *
 * `<organization_id>/<job_posting_id>.<ext>` is not a naming preference — it is
 * what makes 0115's storage policy expressible, because it puts the owning
 * organisation in the first folder segment where a policy can read it with
 * `storage.foldername(name)[1]`.
 */
export function bannerObjectPath(
  organizationId: string,
  jobId: string,
  type: BannerMimeType,
): string {
  return `${organizationId}/${jobId}.${EXTENSION_FOR[type]}`;
}

const PATH_SHAPE = /^([0-9a-fA-F-]{36})\/([0-9a-fA-F-]{36})\.(png|jpg|jpeg|webp)$/;

/**
 * The public URL for a stored banner — or null, which is the important half.
 *
 * THIS IS WHERE THE REAL GUARANTEE LIVES, and it is here rather than in a
 * grant because a grant could not provide it. `job_postings` carries a
 * TABLE-level INSERT grant for `authenticated` (0056 only ever revoked
 * UPDATE), and `postJobAction` inserts through the user's own client — so an
 * employer can put an arbitrary string in `banner_path` at creation time, and
 * a column-level revoke would be overridden by the table-level grant.
 *
 * So nothing downstream trusts the column. A path is rendered ONLY if:
 *
 *   - it is exactly `<uuid>/<uuid>.<ext>` — no traversal, no query string, no
 *     absolute URL, no second slash to climb out of the bucket with; and
 *   - its first segment is THIS POSTING'S OWN organisation.
 *
 * The second check is the one that matters: it makes "point at another org's
 * artwork" impossible regardless of who wrote the value, which is a stronger
 * property than the grant list would have given.
 */
export function bannerPublicUrl(args: {
  supabaseUrl: string;
  bannerPath: string | null;
  organizationId: string | null;
}): string | null {
  const { supabaseUrl, bannerPath, organizationId } = args;
  if (!bannerPath || !organizationId) return null;

  const match = PATH_SHAPE.exec(bannerPath);
  if (!match) return null;
  if (match[1].toLowerCase() !== organizationId.toLowerCase()) return null;

  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${BANNER_BUCKET}/${bannerPath}`;
}

export type BannerRejection =
  | { ok: false; reason: string };
export type BannerAcceptance = {
  ok: true;
  type: BannerMimeType;
  width: number;
  height: number;
};

/**
 * Everything checkable about a candidate banner, in one place.
 *
 * Takes already-read bytes and already-measured dimensions rather than a File,
 * so the rule is testable without a browser, a network or a decoder.
 */
export function validateBanner(args: {
  bytes: Uint8Array;
  byteLength: number;
  width: number;
  height: number;
}): BannerAcceptance | BannerRejection {
  const { bytes, byteLength, width, height } = args;

  if (byteLength > MAX_BANNER_BYTES) {
    return {
      ok: false,
      reason: `That image is ${(byteLength / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB — export it a bit smaller and try again.`,
    };
  }

  const type = sniffImageType(bytes);
  if (!type) {
    return {
      ok: false,
      reason: "That file isn't a PNG, JPEG or WebP image. Checked by reading the file itself, not its name.",
    };
  }

  if (width < MIN_BANNER_WIDTH || height < MIN_BANNER_HEIGHT) {
    return {
      ok: false,
      reason: `That image is ${width}×${height}. It needs to be at least ${MIN_BANNER_WIDTH}×${MIN_BANNER_HEIGHT} so it stays sharp — 1600×400 is ideal.`,
    };
  }
  if (width > MAX_BANNER_WIDTH) {
    return {
      ok: false,
      reason: `That image is ${width}px wide. Keep it under ${MAX_BANNER_WIDTH}px — it's only ever shown 760px across.`,
    };
  }

  const ratio = width / height;
  if (ratio < MIN_BANNER_RATIO || ratio > MAX_BANNER_RATIO) {
    return {
      ok: false,
      reason: `That image is ${ratio.toFixed(1)}:1. A banner needs to be wide and short — between 3:1 and 5:1, with 4:1 (like 1600×400) ideal.`,
    };
  }

  return { ok: true, type, width, height };
}

/**
 * Width and height, read from the file's own header.
 *
 * WHY NOT TRUST THE CLIENT'S MEASUREMENT. The browser can measure an image
 * cheaply and does, so the upload form can reject a bad ratio before spending
 * anyone's bandwidth. But that measurement arrives as two numbers in a form
 * body, which is to say it arrives from whoever is uploading. The ratio rule
 * is only a rule if the server can check it itself.
 *
 * WHY NOT A LIBRARY. Reading four integers out of three well-specified headers
 * does not justify a dependency, and a decoder is a much larger attack surface
 * than a header reader — this runs on bytes an anonymous-ish caller chose.
 * Nothing here decodes pixels; it reads lengths and stops.
 *
 * Returns null when the header is not one of the three shapes, which the
 * caller treats as "not an image we accept" rather than as an error — the
 * signature check has already run by then, so null here means a truncated or
 * malformed file of an otherwise-valid type.
 */
export function readImageDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  const type = sniffImageType(bytes);
  if (!type) return null;

  const be16 = (i: number) => (bytes[i] << 8) | bytes[i + 1];
  const be32 = (i: number) =>
    ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;

  if (type === "image/png") {
    // IHDR is always the first chunk: 8-byte signature, 4-byte length,
    // 4-byte "IHDR", then width and height as big-endian uint32.
    if (bytes.length < 24) return null;
    return { width: be32(16), height: be32(20) };
  }

  if (type === "image/jpeg") {
    /*
     * JPEG carries its dimensions in a Start Of Frame marker, and there is no
     * fixed offset — the frame sits after a variable run of other segments, so
     * this walks the marker chain. SOF0/1/2/3, 5/6/7, 9/10/11, 13/14/15 all
     * carry the same shape; DHT (C4), DAC (CC) and RSTn (D0-D7) share the
     * numeric range and must be skipped rather than read.
     */
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const isSOF =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSOF) {
        // segment: FF, marker, 2-byte length, 1-byte precision, then height, width
        return { height: be16(i + 5), width: be16(i + 7) };
      }
      const length = be16(i + 2);
      if (length < 2) return null; // malformed; refuse rather than loop forever
      i += 2 + length;
    }
    return null;
  }

  // WebP. Three container variants, and they do not share an offset.
  if (bytes.length < 30) return null;
  const fourcc = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (fourcc === "VP8 ") {
    // Lossy: 14 bytes of frame header, then 14-bit width and height.
    return {
      width: ((bytes[27] << 8) | bytes[26]) & 0x3fff,
      height: ((bytes[29] << 8) | bytes[28]) & 0x3fff,
    };
  }
  if (fourcc === "VP8L") {
    // Lossless: 1 signature byte, then 14 bits width-1 and 14 bits height-1.
    const b = (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>> 0;
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  if (fourcc === "VP8X") {
    // Extended: 24-bit canvas width-1 and height-1, little-endian.
    return {
      width: (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1,
      height: (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1,
    };
  }
  return null;
}
