/**
 * P1 — the demo's free claim matches reality, in ONE place, and nothing else makes a competing one.
 *
 * Reality: one free preview per visitor (a cookie; no per-IP rule), no account needed. The homepage said
 * "free, no account needed" in the hero lede and "one free run" in the caption — the same fact in two
 * sentences, neither scoped. Now the caption carries the claim, scoped, and the lede makes none.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { DEMO_CAPTION_SIGNED_OUT } from "@/lib/demo/copy";
import { HeroSection } from "@/components/marketing/hero-section";

const ROOT = path.resolve(__dirname, "../..");
const flat = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&#x27;|&#39;|&apos;/g, "'").replace(/\s+/g, " ");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("the homepage demo caption", () => {
  it("is exactly the scoped claim", () => {
    expect(DEMO_CAPTION_SIGNED_OUT).toBe("Try it free — no account needed. One free preview per visitor.");
  });

  it("is what a signed-out visitor sees under the input", () => {
    expect(flat(renderToStaticMarkup(<HeroSection />))).toContain(DEMO_CAPTION_SIGNED_OUT);
  });

  it("the hero lede no longer makes its own unscoped 'free, no account needed' promise", () => {
    const html = flat(renderToStaticMarkup(<HeroSection />));
    expect(html).not.toContain("a tailored resume — free, no account needed");
    expect(html).toContain("Paste a job description and Farah returns your match score, what's missing, and a tailored resume.");
  });
});

describe("no other public copy promises 'no account needed'", () => {
  it("only the demo caption (src/lib/demo/copy.ts) says it", () => {
    const offenders: string[] = [];
    for (const dir of ["src/app", "src/components", "src/lib"]) {
      for (const file of sourceFiles(path.join(ROOT, dir))) {
        if (file.endsWith(path.join("src", "lib", "demo", "copy.ts"))) continue;
        const text = readFileSync(file, "utf8").replace(/\s+/g, " ");
        if (/no account (is )?needed/i.test(text)) offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
