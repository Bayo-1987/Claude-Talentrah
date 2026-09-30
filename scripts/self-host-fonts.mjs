#!/usr/bin/env node
/**
 * Regenerates, or verifies, src/fonts — the seven Google font families this app serves, committed so that `next build`
 * never has to fetch one (#585).
 *
 *   node scripts/self-host-fonts.mjs --write    fetch from Google, rewrite src/fonts/** (woff2, per-family CSS, manifest.json)
 *   node scripts/self-host-fonts.mjs --check    fetch from Google and compare with manifest.json; writes nothing
 *   node scripts/self-host-fonts.mjs --verify   offline: committed files against manifest.json (sha256, size)
 *
 * WHAT IT REPRODUCES. The request `next/font/google` (Next 16.3.6) made for each family: the same css2 URL, the same
 * User-Agent, so Google answers with the same woff2 files — 60 of them, every unicode-range subset, not just latin. The
 * woff2 bytes are written unmodified. The CSS is next/font's own output for these families, written out: the
 * @font-face blocks in Google's order, the fallback block with next/font's precomputed metrics, and a `.className` and a
 * `.variable` rule. Class names are fixed strings (`tal-font-<slug>`, `tal-font-var-<slug>`) instead of CSS-module hashes.
 *
 * Reads public font files only. Holds no credential. Node 20+ (global fetch).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "fonts");
// next/font's own User-Agent (next/dist/compiled/@next/font/dist/google/fetch-resource.js)
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36";

/** `singleStyle`: next/font adds `font-style: normal` to `.className` when only one style was requested. */
const FAMILIES = [
  {
    slug: "newsreader", family: "Newsreader", variable: "--font-newsreader", singleStyle: false,
    css2: "https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,500;0,600;1,400;1,500;1,600&display=swap",
    fallback: { local: "Times New Roman", ascent: "69.68%", descent: "25.12%", gap: "0.0%", size: "105.48%" },
    preload: [["normal", "latin"], ["italic", "latin"]],
  },
  {
    slug: "ibm-plex-sans", family: "IBM Plex Sans", variable: "--font-ibm-plex-sans", singleStyle: true,
    css2: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap",
    fallback: { local: "Arial", ascent: "101.32%", descent: "27.18%", gap: "0.0%", size: "101.17%" },
    preload: [["normal", "latin"]],
  },
  {
    slug: "poppins", family: "Poppins", variable: "--font-poppins", singleStyle: true,
    css2: "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap",
    fallback: { local: "Arial", ascent: "93.62%", descent: "31.21%", gap: "8.92%", size: "112.16%" },
    preload: [],
  },
  {
    slug: "work-sans", family: "Work Sans", variable: "--font-worksans", singleStyle: true,
    css2: "https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600;700&display=swap",
    fallback: { local: "Arial", ascent: "83.09%", descent: "21.71%", gap: "0.0%", size: "111.93%" },
    preload: [],
  },
  {
    slug: "lora", family: "Lora", variable: "--font-lora", singleStyle: false,
    css2: "https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap",
    fallback: { local: "Times New Roman", ascent: "87.33%", descent: "23.78%", gap: "0.0%", size: "115.2%" },
    preload: [],
  },
  {
    slug: "barlow-condensed", family: "Barlow Condensed", variable: "--font-barlow-condensed", singleStyle: true,
    css2: "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&display=swap",
    fallback: { local: "Arial", ascent: "130.73%", descent: "26.15%", gap: "0.0%", size: "76.49%" },
    preload: [],
  },
  {
    slug: "source-sans-3", family: "Source Sans 3", variable: "--font-resume-source-sans", singleStyle: true,
    css2: "https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600;700&display=swap",
    fallback: { local: "Arial", ascent: "109.21%", descent: "42.66%", gap: "0.0%", size: "93.76%" },
    preload: [],
  },
];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const q = (s) => `"${s}"`;

async function fetchFamily(f) {
  const css = await (await fetch(f.css2, { headers: { "User-Agent": UA } })).text();
  const faces = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)].map((m) => ({
    subset: m[1],
    style: m[2].match(/font-style:\s*(\w+)/)[1],
    weight: m[2].match(/font-weight:\s*(\d+)/)[1],
    unicodeRange: m[2].match(/unicode-range:\s*([^;]+);/)[1].trim(),
    gstatic: m[2].match(/src:\s*url\((https:[^)]+\.woff2)\)/)[1],
    // every descriptor Google returned, in its order (IBM Plex Sans also carries `font-stretch: 100%`)
    declarations: [...m[2].matchAll(/([\w-]+):\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]),
  }));
  if (!faces.length) throw new Error(`no @font-face blocks for ${f.family}`);
  const bytes = new Map();
  for (const url of new Set(faces.map((x) => x.gstatic))) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    bytes.set(url, Buffer.from(await res.arrayBuffer()));
  }
  return { faces, bytes };
}

function build(f, { faces, bytes }) {
  // one file per distinct woff2; a variable file serves several weights
  const files = new Map();
  for (const face of faces) {
    const buf = bytes.get(face.gstatic);
    const sha = sha256(buf);
    if (!files.has(sha)) files.set(sha, { sha, buf, gstatic: face.gstatic, style: face.style, subset: face.subset, weights: [] });
    files.get(sha).weights.push(face.weight);
  }
  for (const file of files.values()) {
    const w = [...new Set(file.weights)].sort();
    file.weights = w;
    file.name = `${f.slug}-${file.style}-${file.subset}-w${w.join("_")}-${file.sha.slice(0, 8)}.woff2`;
    file.preload = f.preload.some(([style, subset]) => style === file.style && subset === file.subset);
  }
  const byGstatic = new Map([...files.values()].map((x) => [x.gstatic, x]));
  const famCss = f.family.includes(" ") && /^\d/.test(f.family.split(" ").at(-1)) ? q(f.family) : `'${f.family}'`;
  const fbName = `${f.family} Fallback`;
  const fbCss = /\d/.test(fbName) ? q(fbName) : `'${fbName}'`;
  const blocks = faces.map((face) =>
    [
      "@font-face {",
      ...face.declarations.map(([prop, value]) => {
        if (prop === "font-family") return `  font-family: ${famCss};`;
        if (prop === "src") return `  src: url(./${byGstatic.get(face.gstatic).name}) format("woff2");`;
        return `  ${prop}: ${value};`;
      }),
      "}",
    ].join("\n"),
  );
  const fb = f.fallback;
  const css = [
    `/* ${f.family} — self-hosted copy of what next/font/google produced for this family (see ../README.md). Generated by scripts/self-host-fonts.mjs; do not edit. */`,
    ...blocks,
    [
      "@font-face {",
      `  font-family: ${fbCss};`,
      `  src: local(${q(fb.local)});`,
      `  ascent-override: ${fb.ascent};`,
      `  descent-override: ${fb.descent};`,
      `  line-gap-override: ${fb.gap};`,
      `  size-adjust: ${fb.size};`,
      "}",
    ].join("\n"),
    `.tal-font-${f.slug} {\n  font-family: ${famCss}, ${fbCss};${f.singleStyle ? "\n  font-style: normal;" : ""}\n}`,
    `.tal-font-var-${f.slug} {\n  ${f.variable}: ${q(f.family)}, ${q(fbName)};\n}`,
  ].join("\n\n") + "\n";
  return { files: [...files.values()], css };
}

function licenceEntry(f) {
  const p = join(OUT, f.slug, "OFL.txt");
  if (!existsSync(p)) throw new Error(`missing ${p}`);
  const text = readFileSync(p);
  return { file: `${f.slug}/OFL.txt`, sha256: sha256(text), copyright: text.toString("utf8").split("\n")[0].trim() };
}

async function main() {
  const mode = process.argv[2];
  if (mode === "--verify") {
    const m = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8"));
    let bad = 0;
    for (const x of m.files) {
      const p = join(OUT, x.path);
      const ok = existsSync(p) && sha256(readFileSync(p)) === x.sha256;
      if (!ok) { bad++; console.error(`MISMATCH ${x.path}`); }
    }
    const onDisk = readdirSync(OUT, { recursive: true }).filter((n) => String(n).endsWith(".woff2")).length;
    console.log(`${m.files.length} files in manifest, ${onDisk} woff2 on disk, ${bad} mismatched`);
    process.exit(bad || onDisk !== m.files.length ? 1 : 0);
  }
  if (mode !== "--write" && mode !== "--check") {
    console.error("usage: node scripts/self-host-fonts.mjs --write | --check | --verify");
    process.exit(2);
  }
  const manifest = { source: "fonts.googleapis.com css2 + fonts.gstatic.com, fetched with next/font's User-Agent", userAgent: UA, generatedBy: "scripts/self-host-fonts.mjs", families: [], files: [] };
  for (const f of FAMILIES) {
    const got = build(f, await fetchFamily(f));
    manifest.families.push({ slug: f.slug, family: f.family, css2: f.css2, variable: f.variable, licence: licenceEntry(f) });
    for (const file of got.files) {
      manifest.files.push({
        path: `${f.slug}/${file.name}`, family: f.family, style: file.style, subset: file.subset, weights: file.weights,
        sha256: file.sha, bytes: file.buf.length, gstatic: file.gstatic, preload: file.preload,
      });
      if (mode === "--write") {
        mkdirSync(join(OUT, f.slug), { recursive: true });
        writeFileSync(join(OUT, f.slug, file.name), file.buf);
      }
    }
    if (mode === "--write") writeFileSync(join(OUT, f.slug, `${f.slug}.css`), got.css);
  }
  manifest.files.sort((a, b) => a.path.localeCompare(b.path));
  if (mode === "--write") {
    writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    console.log(`wrote ${manifest.files.length} files`);
  } else {
    const committed = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8"));
    const a = JSON.stringify(committed.files.map((x) => [x.path, x.sha256]));
    const b = JSON.stringify(manifest.files.map((x) => [x.path, x.sha256]));
    console.log(a === b ? `remote matches manifest (${manifest.files.length} files)` : "REMOTE DIFFERS from manifest.json");
    process.exit(a === b ? 0 : 1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
