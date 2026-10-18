/**
 * The installable-app manifest and its icons (design note sections 1 and 6, tests 1 and 2).
 *
 * Everything here reads the real files: the manifest the route would serve, the PNGs on disk, and the paper token in globals.css. Nothing is
 * mocked.
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import manifest from "@/app/manifest";
import { PAPER_HEX } from "@/lib/pwa/colors";
import { SITE_DESCRIPTION } from "@/lib/seo/site";
import { tokenHex } from "../support/oklch";

const ROOT = path.resolve(__dirname, "../..");
const PUBLIC_DIR = path.join(ROOT, "public");

const m = manifest();
const icons = m.icons ?? [];

function onDisk(src: string): string {
  return path.join(PUBLIC_DIR, src.replace(/^\//, ""));
}

describe("manifest fields", () => {
  it("names the app and says what it is, from the site constant", () => {
    expect(m.name).toBe("Talentrah");
    expect(m.short_name).toBe("Talentrah");
    expect(m.description).toBe(SITE_DESCRIPTION);
    expect(m.lang).toBe("en");
  });

  it("has an explicit identity and scope, so identity never depends on start_url", () => {
    expect(m.id).toBe("/");
    expect(m.scope).toBe("/");
  });

  it("opens on /dashboard, which sends each kind of person to the right home and a signed-out visitor to login", () => {
    expect(m.start_url).toBe("/dashboard");
  });

  it("runs standalone", () => {
    expect(m.display).toBe("standalone");
  });

  it("uses hex colours (a manifest cannot hold oklch) and the paper colour for both", () => {
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/);
    expect(m.theme_color).toBe(PAPER_HEX);
    expect(m.background_color).toBe(PAPER_HEX);
  });

  it("carries none of the things v1 leaves out", () => {
    const loose = m as unknown as Record<string, unknown>;
    for (const key of ["screenshots", "shortcuts", "share_target", "related_applications"]) expect(loose[key], key).toBeUndefined();
  });
});

describe("PAPER_HEX is the --paper token, converted", () => {
  it("equals the oklch value in globals.css run through the CSS Color 4 conversion", () => {
    expect(PAPER_HEX).toBe(tokenHex("paper"));
  });
});

describe("manifest icons", () => {
  const stated = (sizes: string) => {
    const [w, h] = sizes.split("x").map(Number);
    return { w, h };
  };

  it("lists 192 and 512 for purpose any and a 512 for purpose maskable", () => {
    const any = icons.filter((i) => (i.purpose ?? "any") === "any").map((i) => i.sizes);
    const maskable = icons.filter((i) => i.purpose === "maskable").map((i) => i.sizes);
    expect(any).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(maskable).toContain("512x512");
  });

  it("never lists one image for both purposes, and never uses the combined 'any maskable' value", () => {
    for (const i of icons) expect(i.purpose, i.src).not.toMatch(/\s/);
    const bySrc = new Map<string, Set<string>>();
    for (const i of icons) bySrc.set(i.src, (bySrc.get(i.src) ?? new Set()).add(i.purpose ?? "any"));
    for (const [src, purposes] of bySrc) expect(purposes.size, `${src} serves two purposes`).toBe(1);
  });

  it.each(icons.map((i) => [i.src, i] as const))("%s exists on disk at exactly the pixel size the manifest states, as a PNG", async (src, icon) => {
    expect(existsSync(onDisk(src)), `${src} is listed but missing`).toBe(true);
    expect(icon.type).toBe("image/png");
    const meta = await sharp(onDisk(src)).metadata();
    const { w, h } = stated(icon.sizes as string);
    expect({ w: meta.width, h: meta.height }, src).toEqual({ w, h });
    expect(meta.format).toBe("png");
  });
});

describe("maskable icons", () => {
  const maskable = icons.filter((i) => i.purpose === "maskable");

  it("exist", () => {
    expect(maskable.length).toBeGreaterThan(0);
  });

  it.each(maskable.map((i) => [i.src] as const))("%s has no transparent pixel anywhere, corners included, and its background is paper", async (src) => {
    const { data, info } = await sharp(onDisk(src)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let transparent = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) transparent++;
    expect(transparent, "pixels with alpha below 255").toBe(0);
    const px = (x: number, y: number) => "#" + [0, 1, 2].map((k) => data[(y * info.width + x) * 4 + k].toString(16).padStart(2, "0")).join("");
    for (const [x, y] of [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]]) expect(px(x, y)).toBe(PAPER_HEX);
  });

  it.each(maskable.map((i) => [i.src] as const))("%s keeps every drawn pixel inside the central safe zone (a circle of radius 40% of the side)", async (src) => {
    const { data, info } = await sharp(onDisk(src)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const paper = [0, 1, 2].map((k) => parseInt(PAPER_HEX.slice(1 + 2 * k, 3 + 2 * k), 16));
    const cx = info.width / 2;
    const cy = info.height / 2;
    const limit = 0.4 * info.width;
    let outside = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const o = (y * info.width + x) * 3;
        const isPaper = [0, 1, 2].every((k) => Math.abs(data[o + k] - paper[k]) <= 8);
        if (!isPaper && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > limit) outside++;
      }
    }
    expect(outside, "drawn pixels outside the safe zone").toBe(0);
  });
});
