/**
 * The How it works step numbers must read as a sequence (S1-43): at least 3:1 against the background at 28px (large text, WCAG 1.4.3).
 * They were `text-line`, the same colour as the hairline rule above them (about 1.4:1), so the numerals were nearly invisible.
 *
 * The token values are read from src/app/globals.css, not copied, so a palette change is judged here. The app has ONE theme (there is
 * no dark-mode token set); the numerals sit on --paper or --paper-alt depending on where the section is placed, so both are checked.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(path.join(__dirname, "../../src/app/globals.css"), "utf8");
const token = (name: string) => {
  const m = new RegExp(`--${name}:\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)`).exec(css.slice(0, css.indexOf("@theme")));
  if (!m) throw new Error(`token --${name} not found as oklch(...) in globals.css`);
  return { l: Number(m[1]) / 100, c: Number(m[2]), h: Number(m[3]) };
};

/** oklch -> linear sRGB (Björn Ottosson's matrices) -> WCAG relative luminance. */
function luminance({ l, c, h }: { l: number; c: number; h: number }): number {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_].map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
const contrast = (fg: string, bg: string) => {
  const [hi, lo] = [luminance(token(fg)), luminance(token(bg))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("step-number contrast, from the real tokens", () => {
  it("the old colour (--line, the rule's colour) fails 3:1 on both backgrounds: the test can tell", () => {
    expect(contrast("line", "paper")).toBeLessThan(3);
    expect(contrast("line", "paper-alt")).toBeLessThan(3);
  });

  it("black on white is 21:1 (the calculation itself is right)", () => {
    expect(contrast("ink", "card")).toBeGreaterThan(14);
  });

  it("the numerals' colour (--rust, the brand accent also used for numbered steps elsewhere) is at least 3:1 on --paper and --paper-alt", () => {
    expect(contrast("rust", "paper")).toBeGreaterThanOrEqual(3);
    expect(contrast("rust", "paper-alt")).toBeGreaterThanOrEqual(3);
  });

  it("the component uses that colour, and no longer the rule's", () => {
    const src = readFileSync(path.join(__dirname, "../../src/components/marketing/how-it-works-section.tsx"), "utf8");
    const numeral = /<span className="([^"]*)">\{step\.number\}<\/span>/.exec(src);
    expect(numeral, "step number span not found").not.toBeNull();
    expect(numeral![1]).toContain("text-rust");
    expect(numeral![1]).not.toContain("text-line");
  });
});
