/**
 * The server-only half of job-posting banners (send-408): resizing and
 * recompressing an already-`validateBanner`-accepted upload before it
 * reaches storage.
 *
 * SEPARATE FILE FROM `banner.ts`, DELIBERATELY. `banner.ts` is imported by
 * client components too (`new-job-banner-picker.tsx`, `job-banner-upload.tsx`,
 * for `BANNER_GUIDANCE`), and `sharp` is a native Node addon — importing it
 * from `banner.ts` broke `next build` outright the first time this was
 * tried (`detect-libc`'s `require('fs')` reaching a browser bundle via
 * `sharp`). Only `api/employer/job-banner/route.ts`, a server-only route,
 * imports this file.
 */
import sharp from "sharp";
import { SERVER_ENCODE_MAX_WIDTH, type BannerMimeType } from "./banner";

/**
 * WHY A DECODER IS ACCEPTABLE HERE BUT NOT IN `banner.ts`'s
 * `readImageDimensions`. That function's own comment explains why it reads
 * raw header bytes instead of decoding: it runs on bytes nobody has vetted
 * yet, so a decoder there would be attack surface spent before any check has
 * run. This function runs strictly AFTER `validateBanner` has already
 * accepted the type, dimensions, ratio and size — decoding here is the point
 * (a resize/recompress cannot happen without one), not a shortcut around the
 * earlier check.
 *
 * ONLY DOWNSCALES (`withoutEnlargement: true`) and never changes the output
 * format from the one `validateBanner` already sniffed and accepted — a
 * format switch is `banner-crop.ts`'s own PNG/JPEG-threshold decision for
 * the crop UI specifically, not something this backstop path re-derives.
 * Height is left to fall out of the resize proportionally: forcing it to a
 * fixed value here would silently distort any upload that arrived at a
 * valid-but-not-exactly-4:1 ratio (`banner.ts`'s own accepted band is
 * 3:1–5:1, wider than the crop UI's fixed 4:1 output on purpose), which the
 * fixed-4:1-box `object-cover` at render time is what already handles.
 *
 * Throws on a genuinely undecodable file (bytes that pass the header sniff
 * `validateBanner` uses but are still malformed enough that `sharp` itself
 * refuses them) — the caller treats that as a 400, not a 500, since it is
 * caller input rather than a server fault.
 */
export async function reencodeBannerForStorage(args: {
  bytes: Uint8Array;
  type: BannerMimeType;
}): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const { bytes, type } = args;
  const resized = sharp(Buffer.from(bytes)).resize({
    width: SERVER_ENCODE_MAX_WIDTH,
    withoutEnlargement: true,
  });

  const encoded =
    type === "image/png"
      ? resized.png({ compressionLevel: 9 })
      : type === "image/jpeg"
        ? resized.jpeg({ quality: 82 })
        : resized.webp({ quality: 82 });

  const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
  return { bytes: new Uint8Array(data), width: info.width, height: info.height };
}
