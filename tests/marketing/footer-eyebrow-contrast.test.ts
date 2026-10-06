/**
 * The footer's small muted text (the column headings, the copyright line, the tagline) on the ink footer: 4.5:1 or better, from the token's own value
 * (S1-26 item 3). It was an inline oklch(60% 0.02 60), which is 4.36:1 on --ink: under the WCAG AA line for text this small. It is a token now
 * (`--footer-eyebrow`), so the colour is named once, tested from the value, and a palette change is judged against the real ink.
 *
 * Runs without a database or a browser: the contrast comes from tests/support/contrast.ts (oklch to luminance), and the footer is server-rendered.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { luminance, token } from "../support/contrast";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

const read = (rel: string) => readFileSync(path.join(__dirname, "../..", rel), "utf8");
const ratio = (a: ReturnType<typeof token>, b: ReturnType<typeof token>) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("the footer's muted text token", () => {
  it("exists and is at least 4.5:1 on the footer's ink background", () => {
    const eyebrow = token("footer-eyebrow");
    expect(ratio(eyebrow, token("ink"))).toBeGreaterThanOrEqual(4.5);
  });

  it("the old inline colour really was below the line (so this test means something)", () => {
    expect(ratio({ l: 0.6, c: 0.02, h: 60 }, token("ink"))).toBeLessThan(4.5);
  });

  it("is mapped into the theme, so `text-footer-eyebrow` exists", () => {
    expect(read("src/app/globals.css")).toMatch(/--color-footer-eyebrow:\s*var\(--footer-eyebrow\)/);
  });
});

describe("the footer uses the token everywhere it used the old colour", () => {
  const source = read("src/components/marketing/marketing-footer.tsx");
  const html = renderToStaticMarkup(MarketingFooter());

  it("has no inline copy of the old colour left", () => {
    expect(source).not.toContain("oklch(60%_0.02_60)");
  });

  it("renders the column headings, the copyright line and the tagline with the token's class", () => {
    expect((html.match(/text-footer-eyebrow/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});
