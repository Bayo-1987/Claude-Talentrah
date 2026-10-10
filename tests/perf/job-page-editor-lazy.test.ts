/**
 * The public job page must not download the rich-text editor unless it renders one (PERF-WEIGHT-1).
 *
 * TipTap and ProseMirror are about 116 KB gzipped. The bundler gives every client component on a route one shared chunk set, so a STATIC import anywhere in the job page's client graph shipped the editor to every
 * visitor of every job page, including the many postings with no free-text screening question (measured on a local build: 308 KB of client JS on /jobs/[id] before, 195 KB after; the zod change of part 1 is a separate chunk and takes it from 308 to 221 KB on its own). `screening-gate-apply.tsx` now loads
 * it with `next/dynamic`, which is fetched only when a question renders it.
 *
 * Two checks: the file itself (named, so a failure says what to do), and the whole static import graph of the job page, which catches the same mistake made one file away. The walk follows `import` and `export ... from`
 * (not `import()` calls, which are exactly the lazy edges we want) and ignores `import type`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const IMPORT = /(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/g;

/** The first static import chain from `entry` that reaches a module whose specifier matches `target`, or null. */
export function staticChainTo(entry: string, target: RegExp, load: (rel: string) => string | null): string[] | null {
  const seen = new Set<string>();
  const resolve = (spec: string, from: string): string | null => {
    const base = spec.startsWith("@/") ? path.join("src", spec.slice(2)) : spec.startsWith(".") ? path.normalize(path.join(path.dirname(from), spec)) : null;
    if (!base) return null;
    return [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")].find((c) => load(c) !== null) ?? null;
  };
  const walk = (file: string, chain: string[]): string[] | null => {
    if (seen.has(file)) return null;
    seen.add(file);
    const source = load(file)!;
    for (const m of source.matchAll(IMPORT)) {
      if (m[1]) continue;
      if (target.test(m[2])) return [...chain, file, m[2]];
      const next = resolve(m[2], file);
      if (!next) continue;
      const found = walk(next, [...chain, file]);
      if (found) return found;
    }
    return null;
  };
  return walk(entry, []);
}

const loadReal = (rel: string): string | null => {
  try {
    return read(rel);
  } catch {
    return null;
  }
};

describe("the job page loads the editor on demand", () => {
  it("screening-gate-apply.tsx imports the editor with next/dynamic, not statically", () => {
    const source = read("src/components/jobs/screening-gate-apply.tsx");
    expect(source).not.toMatch(/import\s*\{[^}]*MinimalRichEditor[^}]*\}\s*from\s*["']@\/components\/rich-text\/minimal-rich-editor["']/);
    expect(source).toContain('from "next/dynamic"');
    expect(source).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\(\s*["']@\/components\/rich-text\/minimal-rich-editor["']\s*\)/);
    expect(source).toContain("ssr: false");
  });

  it("nothing on the job page's static import graph reaches TipTap or the editor modules", () => {
    const chain = staticChainTo("src/app/(app)/jobs/[id]/page.tsx", /^@tiptap\/|rich-text\/minimal-rich-editor|employer\/rich-markdown-editor/, loadReal);
    expect(chain, `The job page statically reaches the rich-text editor (about 116 KB gzipped for everyone): ${chain?.join(" > ")}. Load it with next/dynamic where it is used.`).toBeNull();
  });

  describe("the detector", () => {
    const files = new Map<string, string>([
      ["src/page.tsx", 'import { A } from "@/components/a";'],
      ["src/components/a.tsx", '"use client";\nimport { E } from "@/components/e";'],
      ["src/components/e.tsx", 'import { EditorContent } from "@tiptap/react";'],
      ["src/components/lazy.tsx", 'import dynamic from "next/dynamic";\nconst E = dynamic(() => import("@tiptap/react"));'],
      ["src/page2.tsx", 'import { L } from "@/components/lazy";'],
      ["src/page3.tsx", 'import type { E } from "@tiptap/react";'],
    ]);
    const load = (rel: string) => files.get(rel) ?? null;
    it("finds a static chain through a client component", () => {
      expect(staticChainTo("src/page.tsx", /^@tiptap\//, load)).toEqual(["src/page.tsx", "src/components/a.tsx", "src/components/e.tsx", "@tiptap/react"]);
    });
    it("does not count a dynamic import() or an import type", () => {
      expect(staticChainTo("src/page2.tsx", /^@tiptap\//, load)).toBeNull();
      expect(staticChainTo("src/page3.tsx", /^@tiptap\//, load)).toBeNull();
    });
  });
});
