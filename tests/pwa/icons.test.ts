/**
 * Every icon the app declares, in the manifest AND in the layout metadata.
 *
 * - each file exists and is exactly the size it is declared at;
 * - the manifest's icons and the Apple touch icon have FOUR OPAQUE CORNER PIXELS: iOS draws black behind a transparent Home Screen icon, and a launcher draws its own colour
 *   behind a transparent "any" icon. (The browser favicons may be transparent.)
 * - the share image and the favicon files are byte-identical to what shipped before the installable-app work (sha256), so they cannot be repainted by accident.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import manifest from "@/app/manifest";
import { metadata } from "@/app/layout";
import { PAPER_HEX } from "@/lib/pwa/colors";

const PUBLIC_DIR = path.resolve(__dirname, "../../public");
const file = (src: string) => path.join(PUBLIC_DIR, src.replace(/^\//, ""));

interface Declared {
  where: string;
  src: string;
  size: number;
  opaque: boolean;
}

const icons = metadata.icons as { icon: { url: string; sizes: string }[]; apple: { url: string; sizes: string }[] };
const declared: Declared[] = [
  ...(manifest().icons ?? []).map((i) => ({ where: "manifest", src: i.src, size: Number(String(i.sizes).split("x")[0]), opaque: true })),
  ...icons.apple.map((i) => ({ where: "apple-touch-icon", src: i.url, size: Number(i.sizes.split("x")[0]), opaque: true })),
  ...icons.icon.map((i) => ({ where: "favicon", src: i.url, size: Number(i.sizes.split("x")[0]), opaque: false })),
];

describe("every declared icon", () => {
  it.each(declared.map((d) => [`${d.where} ${d.src}`, d] as const))("%s exists at its declared size", async (_l, d) => {
    expect(existsSync(file(d.src)), `${d.src} is declared but missing`).toBe(true);
    const meta = await sharp(file(d.src)).metadata();
    expect({ w: meta.width, h: meta.height }).toEqual({ w: d.size, h: d.size });
  });

  const opaque = declared.filter((d) => d.opaque);
  it.each(opaque.map((d) => [`${d.where} ${d.src}`, d] as const))("%s has four opaque corner pixels, in paper colour", async (_l, d) => {
    const { data, info } = await sharp(file(d.src)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const o = (y * info.width + x) * 4;
      return { a: data[o + 3], hex: "#" + [0, 1, 2].map((k) => data[o + k].toString(16).padStart(2, "0")).join("") };
    };
    for (const [x, y] of [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]]) {
      expect(at(x, y), `corner ${x},${y}`).toEqual({ a: 255, hex: PAPER_HEX });
    }
  });

  it("covers the manifest's 'any' icons and the Apple touch icon (not only the maskable ones)", () => {
    const anyIcons = (manifest().icons ?? []).filter((i) => (i.purpose ?? "any") === "any");
    expect(anyIcons.length).toBeGreaterThanOrEqual(2);
    expect(declared.some((d) => d.where === "apple-touch-icon")).toBe(true);
  });
});

describe("the share image and the favicons are unchanged", () => {
  // sha256 of the files as shipped on main before this work; the 512 is the share image (src/lib/seo/site.ts) and a favicon entry.
  const PINNED: Record<string, string> = {
    "icons/talentrah-mark-16.png": "7bfb8e6bbf5b6e1cb7b4d50db26dfd350759f999598ab66b0b7dff758b88f4d6",
    "icons/talentrah-mark-32.png": "cea11def73165ecf6f02ad254bb673ff1717867db8bea9c81ea19aab8a482edb",
    "icons/talentrah-mark-48.png": "e5b935001c9219fdc3029904cd97c5648d96231ea7c20c5314788dba70a097f8",
    "icons/talentrah-mark-512.png": "8586c06f90c2c23df80dff88312837ea6b11654c3e97aa759bb4630b104dfb7e",
  };
  it.each(Object.entries(PINNED))("%s", (rel, sha) => {
    expect(createHash("sha256").update(readFileSync(path.join(PUBLIC_DIR, rel))).digest("hex")).toBe(sha);
  });
});
