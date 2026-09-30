/**
 * #585 — src/fonts is exactly what it claims to be: the committed files match their manifest, the CSS matches the files,
 * the metric-matched fallback blocks are the ones `next/font/google` emitted, the `--font-*` variables keep their names,
 * the three preloaded files are files the stylesheets use, and every family carries its licence.
 *
 * `GOLDEN_FALLBACKS` and `VARIABLES` are values read from the CSS a production build of `main` (before this change)
 * emitted for these seven families; they are pinned here by value so an edit to the CSS cannot drift from them.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRELOADED_FONT_URLS } from "@/fonts/preload";
import { selfHostedFont } from "@/fonts/self-hosted-font";
import { barlowCondensed, lora, poppins, typefaceVariable, workSans } from "@/components/resume-builder/skeletons/fonts";
import { resumeSourceSans } from "@/components/resume-builder/templates/fonts";

const FONTS = join(process.cwd(), "src", "fonts");
interface ManifestFile {
  path: string;
  family: string;
  style: string;
  subset: string;
  weights: string[];
  sha256: string;
  bytes: number;
  gstatic: string;
  preload: boolean;
}
interface Manifest {
  families: Array<{ slug: string; family: string; variable: string; licence: { file: string; sha256: string; copyright: string } }>;
  files: ManifestFile[];
}
const manifest: Manifest = JSON.parse(readFileSync(join(FONTS, "manifest.json"), "utf8"));
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const css = (slug: string) => readFileSync(join(FONTS, slug, `${slug}.css`), "utf8");

const GOLDEN_FALLBACKS: Record<string, { family: string; local: string; ascent: string; descent: string; gap: string; size: string }> = {
  newsreader: { family: "Newsreader Fallback", local: "Times New Roman", ascent: "69.68%", descent: "25.12%", gap: "0.0%", size: "105.48%" },
  "ibm-plex-sans": { family: "IBM Plex Sans Fallback", local: "Arial", ascent: "101.32%", descent: "27.18%", gap: "0.0%", size: "101.17%" },
  poppins: { family: "Poppins Fallback", local: "Arial", ascent: "93.62%", descent: "31.21%", gap: "8.92%", size: "112.16%" },
  "work-sans": { family: "Work Sans Fallback", local: "Arial", ascent: "83.09%", descent: "21.71%", gap: "0.0%", size: "111.93%" },
  lora: { family: "Lora Fallback", local: "Times New Roman", ascent: "87.33%", descent: "23.78%", gap: "0.0%", size: "115.2%" },
  "barlow-condensed": { family: "Barlow Condensed Fallback", local: "Arial", ascent: "130.73%", descent: "26.15%", gap: "0.0%", size: "76.49%" },
  "source-sans-3": { family: "Source Sans 3 Fallback", local: "Arial", ascent: "109.21%", descent: "42.66%", gap: "0.0%", size: "93.76%" },
};
const VARIABLES: Record<string, string> = {
  newsreader: "--font-newsreader",
  "ibm-plex-sans": "--font-ibm-plex-sans",
  poppins: "--font-poppins",
  "work-sans": "--font-worksans",
  lora: "--font-lora",
  "barlow-condensed": "--font-barlow-condensed",
  "source-sans-3": "--font-resume-source-sans",
};

describe("the committed files match the manifest", () => {
  const onDisk = (readdirSync(FONTS, { recursive: true }) as string[]).filter((n) => n.endsWith(".woff2")).sort();

  it("holds exactly the 60 files the manifest lists, no more and no fewer", () => {
    expect(manifest.files).toHaveLength(60);
    expect(onDisk).toEqual(manifest.files.map((f) => f.path).sort());
  });

  it("every file's sha256 and size equal its manifest entry", () => {
    const bad = manifest.files.filter((f) => {
      const b = readFileSync(join(FONTS, f.path));
      return sha256(b) !== f.sha256 || b.length !== f.bytes;
    });
    expect(bad.map((f) => f.path)).toEqual([]);
  });

  it("no two entries are the same file", () => {
    expect(new Set(manifest.files.map((f) => f.sha256)).size).toBe(60);
  });
});

describe("the CSS uses exactly the files in the manifest", () => {
  it.each(Object.keys(VARIABLES))("%s: every @font-face src is a manifest file of that family, and every file of it is used", (slug) => {
    const used = [...css(slug).matchAll(/url\(\.\/([^)]+\.woff2)\)/g)].map((m) => `${slug}/${m[1]}`);
    const own = manifest.files.filter((f) => f.path.startsWith(`${slug}/`)).map((f) => f.path);
    expect(new Set(used)).toEqual(new Set(own));
    expect(own.length).toBeGreaterThan(0);
  });

  it.each(Object.keys(VARIABLES))("%s: no remote URL, font-display is swap, every face's style and weight are the file's", (slug) => {
    const text = css(slug);
    expect(text).not.toMatch(/https?:|\/\//);
    const faces = [...text.matchAll(/@font-face \{\n  font-family: ([^\n]+);\n  font-style: (\w+);\n  font-weight: (\d+);\n(?:  font-stretch: [^\n]+;\n)?  font-display: swap;\n  src: url\(\.\/([^)]+)\) format\("woff2"\);/g)];
    expect(faces.length).toBeGreaterThan(0);
    for (const [, , style, weight, file] of faces) {
      const entry = manifest.files.find((f) => f.path === `${slug}/${file}`);
      expect(entry, file).toBeDefined();
      expect(entry!.style).toBe(style);
      expect(entry!.weights).toContain(weight);
    }
  });
});

describe("every descriptor next/font emitted is kept", () => {
  it("IBM Plex Sans's 24 faces carry font-stretch: 100% (Google sends it for that family); no other family has one", () => {
    // Found by diffing a build of this change against a build of main: the first version of the generator dropped it.
    expect(css("ibm-plex-sans").match(/^  font-stretch: 100%;$/gm)).toHaveLength(24);
    for (const slug of Object.keys(VARIABLES).filter((s) => s !== "ibm-plex-sans")) expect(css(slug)).not.toContain("font-stretch");
  });
});

describe("the fallback faces and the --font-* variables are the ones next/font emitted", () => {
  it.each(Object.entries(GOLDEN_FALLBACKS))("%s fallback @font-face", (slug, g) => {
    const m = css(slug).match(/@font-face \{\n  font-family: ["']([^"']+ Fallback)["'];\n  src: local\("([^"]+)"\);\n  ascent-override: ([^;]+);\n  descent-override: ([^;]+);\n  line-gap-override: ([^;]+);\n  size-adjust: ([^;]+);\n\}/);
    expect(m, `no fallback block in ${slug}.css`).not.toBeNull();
    expect({ family: m![1], local: m![2], ascent: m![3], descent: m![4], gap: m![5], size: m![6] }).toEqual(g);
  });

  it.each(Object.entries(VARIABLES))("%s defines %s as '\"Family\", \"Family Fallback\"' under its own class", (slug, variable) => {
    const family = manifest.families.find((f) => f.slug === slug)!.family;
    expect(css(slug)).toContain(`.tal-font-var-${slug} {\n  ${variable}: "${family}", "${family} Fallback";\n}`);
    expect(manifest.families.find((f) => f.slug === slug)!.variable).toBe(variable);
  });
});

describe("the exported font objects keep their shape", () => {
  it("each is { className, variable, style } and names a class its CSS defines", () => {
    const fonts: Record<string, ReturnType<typeof selfHostedFont>> = {
      poppins, "work-sans": workSans, lora, "barlow-condensed": barlowCondensed, "source-sans-3": resumeSourceSans,
    };
    for (const [slug, f] of Object.entries(fonts)) {
      expect(Object.keys(f).sort()).toEqual(["className", "style", "variable"]);
      expect(css(slug)).toContain(`.${f.className} {`);
      expect(css(slug)).toContain(`.${f.variable} {`);
      expect(f.style.fontFamily).toContain("Fallback");
    }
  });

  it("typefaceVariable still tells the six typefaces apart (display stays null)", () => {
    const vars = (["body", "geometric", "humanist", "modern-serif", "condensed"] as const).map(typefaceVariable);
    expect(new Set(vars).size).toBe(5);
    expect(typefaceVariable("display")).toBeNull();
  });
});

describe("the preloaded files", () => {
  it("are the manifest's three preload files, and each is a file its stylesheet uses", () => {
    expect(PRELOADED_FONT_URLS).toHaveLength(3);
    const preloaded = PRELOADED_FONT_URLS.map((u) => basename(u.split("?")[0])).sort();
    const flagged = manifest.files.filter((f) => f.preload).map((f) => basename(f.path)).sort();
    expect(preloaded).toEqual(flagged);
    for (const f of manifest.files.filter((x) => x.preload)) {
      const slug = f.path.split("/")[0];
      expect(css(slug), `${f.path} is preloaded but not referenced by ${slug}.css`).toContain(`url(./${basename(f.path)})`);
      expect(f.subset).toBe("latin");
    }
  });

  it("layout.tsx renders them and imports no other font source", () => {
    // code only: layout.tsx's own comment explains why a <link rel="preload"> is wrong, and must not trip the check
    const layout = readFileSync(join(process.cwd(), "src", "app", "layout.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(layout).toContain("PRELOADED_FONT_URLS");
    expect(layout).toMatch(/preload\(href, \{ as: "font", type: "font\/woff2"/);
    expect(layout, "a <link rel=preload> element is emitted twice; use preload()").not.toMatch(/<link[^>]*rel="preload"/);
    expect(layout).toContain("@/fonts/newsreader/newsreader.css");
    expect(layout).toContain("@/fonts/ibm-plex-sans/ibm-plex-sans.css");
  });
});

describe("licences", () => {
  it.each(manifest.families.map((f) => [f.slug, f] as const))("%s carries its OFL.txt, unmodified from the manifest's hash", (slug, fam) => {
    const p = join(FONTS, slug, "OFL.txt");
    expect(existsSync(p)).toBe(true);
    const text = readFileSync(p);
    expect(sha256(text)).toBe(fam.licence.sha256);
    const s = text.toString("utf8");
    expect(s.split("\n")[0].trim()).toBe(fam.licence.copyright);
    expect(s).toMatch(/^Copyright/);
    expect(s).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });

  it("the README names the source, the date and the manifest", () => {
    const readme = readFileSync(join(FONTS, "README.md"), "utf8");
    expect(readme).toContain("2026-09-30");
    expect(readme).toContain("manifest.json");
    expect(readme).toContain("sha256");
    expect(readme).toContain("fonts.googleapis.com/css2");
  });
});
