/**
 * oklch -> sRGB hex, the CSS Color 4 path (linear light via Ottosson's OKLab matrices), and a reader for a token in src/app/globals.css.
 * Shared by the tests that pin a hard-coded hex (the manifest colours, the offline page) to the design token it was converted from, so a
 * token that moves fails a test instead of leaving a stale hex behind. Independent of the code under test on purpose.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export function oklchToHex(l: number, c: number, hDeg: number): string {
  const a = c * Math.cos((hDeg * Math.PI) / 180);
  const b = c * Math.sin((hDeg * Math.PI) / 180);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const [L, M, S] = [l_ ** 3, m_ ** 3, s_ ** 3];
  const lin = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
  const enc = (x: number) => {
    const v = Math.max(0, Math.min(1, x));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  };
  return "#" + lin.map((x) => Math.round(enc(x) * 255).toString(16).padStart(2, "0")).join("");
}

/** The hex of a `--name: oklch(L% C H)` token declared in globals.css. Throws if the token is not an oklch() value any more. */
export function tokenHex(name: string): string {
  const css = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8");
  const hit = css.match(new RegExp(`--${name}:\\s*oklch\\(\\s*([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\)`));
  if (!hit) throw new Error(`--${name} is no longer an oklch() token in globals.css; update the hex that was converted from it`);
  return oklchToHex(Number(hit[1]) / 100, Number(hit[2]), Number(hit[3]));
}
