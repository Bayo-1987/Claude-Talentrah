/**
 * WCAG contrast from the project's own oklch tokens (src/app/globals.css), so a palette change is judged against the real values, not a copy.
 * oklch -> linear sRGB (Björn Ottosson's matrices) -> relative luminance -> (L1 + 0.05) / (L2 + 0.05).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(path.join(__dirname, "../../src/app/globals.css"), "utf8");
const tokenBlock = css.slice(0, css.indexOf("@theme"));

export interface Oklch { l: number; c: number; h: number }

export function token(name: string): Oklch {
  const m = new RegExp(`--${name}:\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)`).exec(tokenBlock);
  if (!m) throw new Error(`token --${name} not found as oklch(...) in globals.css`);
  return { l: Number(m[1]) / 100, c: Number(m[2]), h: Number(m[3]) };
}

export function luminance({ l, c, h }: Oklch): number {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_].map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

export function contrastOf(fg: Oklch, bg: Oklch): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Contrast between two named tokens. */
export const contrast = (fg: string, bg: string) => contrastOf(token(fg), token(bg));
