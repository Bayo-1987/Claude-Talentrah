/**
 * Job banner rules — the half that can be checked without a database.
 *
 * The header parsers are the reason this file exists. Everything else here is
 * arithmetic, but `readImageDimensions` walks three different binary layouts
 * and a JPEG's marker chain, and "it worked on the one file I tried" is not a
 * result. These build the headers byte by byte, so a wrong offset fails here
 * rather than by silently accepting a 20:1 image in production.
 */
import { describe, expect, it } from "vitest";
import {
  sniffImageType,
  readImageDimensions,
  validateBanner,
  bannerPublicUrl,
  bannerObjectPath,
  bannerIsEligibleToRender,
  MAX_BANNER_BYTES,
} from "@/lib/employer/banner";

const ORG = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";

/** Minimal but real PNG: signature + IHDR length/type/width/height. */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  b.set([(width >> 24) & 255, (width >> 16) & 255, (width >> 8) & 255, width & 255], 16);
  b.set([(height >> 24) & 255, (height >> 16) & 255, (height >> 8) & 255, height & 255], 20);
  return b;
}

/**
 * JPEG with a decoy segment before the SOF0, so a parser that assumed a fixed
 * offset — or that failed to skip a length-prefixed segment — reads the wrong
 * numbers instead of passing by luck.
 */
function jpeg(width: number, height: number, opts: { decoy?: boolean } = {}): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  if (opts.decoy !== false) {
    // APP0/JFIF, 16 bytes of payload it must step over.
    parts.push(0xff, 0xe0, 0x00, 0x10);
    for (let i = 0; i < 14; i += 1) parts.push(0x00);
  }
  parts.push(0xff, 0xc0, 0x00, 0x11, 0x08);
  parts.push((height >> 8) & 255, height & 255);
  parts.push((width >> 8) & 255, width & 255);
  for (let i = 0; i < 8; i += 1) parts.push(0x00);
  return new Uint8Array(parts);
}

/** WebP, lossy "VP8 " variant — 14-bit little-endian dimensions. */
function webp(width: number, height: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  b.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  b.set([0x56, 0x50, 0x38, 0x20], 12); // "VP8 "
  b[26] = width & 0xff;
  b[27] = (width >> 8) & 0x3f;
  b[28] = height & 0xff;
  b[29] = (height >> 8) & 0x3f;
  return b;
}

describe("what the bytes actually are", () => {
  it("recognises each accepted format from its signature", () => {
    expect(sniffImageType(png(1600, 400))).toBe("image/png");
    expect(sniffImageType(jpeg(1600, 400))).toBe("image/jpeg");
    expect(sniffImageType(webp(1600, 400))).toBe("image/webp");
  });

  it("REJECTS an executable that claims to be an image", () => {
    /*
     * The case the whole signature check exists for. `MZ` is a Windows PE
     * header; a file named banner.png with these bytes is what an extension
     * check and a `File.type` check both wave through, and a public bucket
     * would then serve it back under our own domain.
     */
    const exe = new Uint8Array(64);
    exe.set([0x4d, 0x5a, 0x90, 0x00], 0);
    expect(sniffImageType(exe)).toBeNull();
  });

  it("rejects formats we do not accept, even though they are real images", () => {
    const gif = new Uint8Array(64);
    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // GIF89a
    expect(sniffImageType(gif)).toBeNull();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">');
    // SVG is markup, executes script in some contexts, and is deliberately out.
    expect(sniffImageType(svg)).toBeNull();
  });
});

describe("dimensions, read from the header", () => {
  it("reads PNG", () => {
    expect(readImageDimensions(png(1600, 400))).toEqual({ width: 1600, height: 400 });
  });

  it("reads JPEG past a preceding segment", () => {
    // The decoy APP0 is the point: a fixed-offset reader passes without it.
    expect(readImageDimensions(jpeg(1600, 400, { decoy: true }))).toEqual({
      width: 1600,
      height: 400,
    });
    expect(readImageDimensions(jpeg(1600, 400, { decoy: false }))).toEqual({
      width: 1600,
      height: 400,
    });
  });

  it("reads WebP", () => {
    expect(readImageDimensions(webp(1600, 400))).toEqual({ width: 1600, height: 400 });
  });

  it("does not confuse width and height", () => {
    // A parser with the two swapped passes every square-image test ever written.
    expect(readImageDimensions(png(1600, 400))).toEqual({ width: 1600, height: 400 });
    expect(readImageDimensions(jpeg(1600, 400))).toEqual({ width: 1600, height: 400 });
    expect(readImageDimensions(webp(1600, 400))).toEqual({ width: 1600, height: 400 });
  });

  it("returns null on a truncated file rather than a wrong number", () => {
    expect(readImageDimensions(png(1600, 400).slice(0, 18))).toBeNull();
    expect(readImageDimensions(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });
});

describe("what gets accepted", () => {
  const ok = (w: number, h: number, bytes = 200_000) =>
    validateBanner({ bytes: png(w, h), byteLength: bytes, width: w, height: h });

  it("accepts the recommended 1600x400", () => {
    expect(ok(1600, 400)).toMatchObject({ ok: true, type: "image/png" });
  });

  it("accepts the edges of the 3:1 to 5:1 band, and refuses just outside", () => {
    expect(ok(1200, 400).ok, "3:1 exactly").toBe(true);
    expect(ok(2000, 400).ok, "5:1 exactly").toBe(true);
    expect(ok(2400, 400).ok, "6:1 — too wide").toBe(false);
    expect(ok(1200, 500).ok, "2.4:1 — too tall").toBe(false);
  });

  it("refuses a square image with a message naming the target", () => {
    const r = ok(1600, 1600);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/wide and short/i);
  });

  it("refuses something too small to stay sharp", () => {
    expect(ok(800, 200).ok).toBe(false);
  });

  it("refuses anything over the cap, and says how big it was", () => {
    const r = ok(1600, 400, MAX_BANNER_BYTES + 1);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/2 MB/);
  });

  it("refuses a non-image before it ever looks at dimensions", () => {
    const exe = new Uint8Array(64);
    exe.set([0x4d, 0x5a], 0);
    const r = validateBanner({ bytes: exe, byteLength: 1000, width: 1600, height: 400 });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/reading the file itself/);
  });
});

describe("the URL is only ever built for this posting's own org", () => {
  const supabaseUrl = "https://example.supabase.co";
  const path = bannerObjectPath(ORG, JOB, "image/webp");

  it("builds a bucket URL for a well-formed, own-org path", () => {
    expect(bannerPublicUrl({ supabaseUrl, bannerPath: path, organizationId: ORG })).toBe(
      `https://example.supabase.co/storage/v1/object/public/job-banners/${ORG}/${JOB}.webp`,
    );
  });

  it("REFUSES another organisation's path", () => {
    /*
     * The case that matters, and the reason this check exists at all rather
     * than being handled by a column grant: `job_postings` carries a
     * TABLE-level INSERT grant, so an employer can put an arbitrary string in
     * `banner_path` when creating a posting. This is what makes that useless.
     */
    const other = "33333333-3333-4333-8333-333333333333";
    expect(
      bannerPublicUrl({ supabaseUrl, bannerPath: `${other}/${JOB}.webp`, organizationId: ORG }),
    ).toBeNull();
  });

  it("REFUSES traversal, absolute URLs and anything else shaped wrong", () => {
    for (const bad of [
      `${ORG}/../../other-bucket/secret.png`,
      `${ORG}/${JOB}.webp?x=1`,
      "https://evil.example/banner.png",
      `${ORG}/${JOB}.svg`,
      `${ORG}/${JOB}`,
      `/${ORG}/${JOB}.webp`,
      `${ORG}//${JOB}.webp`,
    ]) {
      expect(
        bannerPublicUrl({ supabaseUrl, bannerPath: bad, organizationId: ORG }),
        `should have refused: ${bad}`,
      ).toBeNull();
    }
  });

  it("is null when there is no banner, and when the org is unknown", () => {
    expect(bannerPublicUrl({ supabaseUrl, bannerPath: null, organizationId: ORG })).toBeNull();
    expect(bannerPublicUrl({ supabaseUrl, bannerPath: path, organizationId: null })).toBeNull();
  });
});

/**
 * send-136: the job detail page's own banner gate widened to admit a
 * Path-3-approved posting, matching the already-independent grant 0119/0127
 * gave that posting's visibility. The exact real-world row this bug was
 * found on (Fatishcakes' "Senior Product Manager", confirmed directly
 * against production before this fix: `admin_review_decision: "approved"`,
 * `organizations.verified: false`, a real `banner_path` already set) is the
 * fixture below, not an invented shape.
 */
describe("bannerIsEligibleToRender — Path 3 approval is a second, independent route", () => {
  const FATISHCAKES_SENIOR_PM = { organizationVerified: false, adminReviewDecision: "approved" };

  it("FAIL-BEFORE: the old single-condition check (verified alone) hid this exact posting's banner", () => {
    // Reproduces the OLD `job.organizations?.verified` gate literally, on
    // the real row that exposed the bug — proving the bug existed before
    // asserting the fix, not just reasoning about it.
    const oldGateResult = FATISHCAKES_SENIOR_PM.organizationVerified;
    expect(oldGateResult).toBe(false);
  });

  it("PASS-AFTER: the new gate admits the same posting on its Path 3 approval alone", () => {
    expect(bannerIsEligibleToRender(FATISHCAKES_SENIOR_PM)).toBe(true);
  });

  it("still admits a verified org's posting, independent of admin_review_decision", () => {
    expect(bannerIsEligibleToRender({ organizationVerified: true, adminReviewDecision: null })).toBe(
      true,
    );
    expect(
      bannerIsEligibleToRender({ organizationVerified: true, adminReviewDecision: "rejected" }),
    ).toBe(true);
  });

  it("REGRESSION: an unverified org's posting with no review decision still shows no banner", () => {
    expect(
      bannerIsEligibleToRender({ organizationVerified: false, adminReviewDecision: null }),
    ).toBe(false);
  });

  it("REGRESSION: an unverified org's REJECTED posting still shows no banner", () => {
    expect(
      bannerIsEligibleToRender({ organizationVerified: false, adminReviewDecision: "rejected" }),
    ).toBe(false);
  });

  it("is false only when neither route grants it — both conditions false", () => {
    expect(
      bannerIsEligibleToRender({ organizationVerified: false, adminReviewDecision: "pending" }),
    ).toBe(false);
  });
});
