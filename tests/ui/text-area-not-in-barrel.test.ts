/**
 * The text area is imported by its own path, never through the shared UI barrel.
 *
 * `src/components/ui/index.ts` is imported by pages that have no text area (the job feed's filter bar takes `FilterChip` from it). A
 * barrel that re-exports the text area made the component, its counter and its paste handling part of that page's client bundle:
 * measured on a production build, the /jobs client chunks grew by 8,853 bytes (3,232 gzip) with no use of the component on the page.
 * So the two forms that use it import `@/components/ui/text-area` directly, and this file holds the line:
 *
 *   1. the barrel does not re-export it;
 *   2. nothing imports one of its exports from the barrel;
 *   3. the static import graph of the /jobs route (page, its layouts, everything they pull in) never reaches the component.
 *
 * Pure source scan, no database.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const BARREL = join(SRC, "components/ui/index.ts");
const TEXT_AREA = join(SRC, "components/ui/text-area.tsx");

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[\s;{}(,])\/\/.*$/gm, "$1");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** The names text-area.tsx exports, read from the file, so a new export is covered without editing this test. */
function textAreaExports(): string[] {
  const text = stripComments(readFileSync(TEXT_AREA, "utf8"));
  return [...text.matchAll(/^export\s+(?:async\s+)?(?:function|const|interface|type|class)\s+(\w+)/gm)].map((m) => m[1]);
}

/** Resolve an import specifier the way the build does for this repo: `@/` is src/, `./` and `../` are relative, packages are ignored. */
function resolveSpecifier(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? join(dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function specifiersOf(file: string): string[] {
  const text = stripComments(readFileSync(file, "utf8"));
  const out: string[] = [];
  for (const m of text.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[\w*${}\s,]+?\s+from\s+)?["']([^"']+)["']/g)) out.push(m[1]);
  for (const m of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

/** Every file reachable from `entries` through static (and dynamic-literal) imports inside src/. */
function reachable(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = entries.filter((e) => existsSync(e));
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of specifiersOf(file)) {
      const next = resolveSpecifier(file, spec);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

describe("the text area is not part of the shared UI barrel", () => {
  it("reads the component's exports from the file (the scan itself is not empty)", () => {
    expect(textAreaExports()).toContain("TextArea");
  });

  it("src/components/ui/index.ts does not re-export ./text-area", () => {
    expect(stripComments(readFileSync(BARREL, "utf8"))).not.toMatch(/from\s+["']\.\/text-area["']/);
  });

  it("no file imports one of the text area's exports from the barrel", () => {
    const names = textAreaExports();
    const offenders: string[] = [];
    for (const path of walk(SRC)) {
      const text = stripComments(readFileSync(path, "utf8"));
      for (const m of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']@\/components\/ui["']/g)) {
        const imported = m[1].split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]);
        for (const n of names) if (imported.includes(n)) offenders.push(`${relative(ROOT, path)}: ${n}`);
      }
    }
    expect(offenders, "import it from @/components/ui/text-area").toEqual([]);
  });

  it("the /jobs route's OWN import graph (its page, its loading state, the root layout, everything they import) never reaches the text area", () => {
    const entries = [join(SRC, "app/(app)/jobs/(feed)/page.tsx"), join(SRC, "app/(app)/jobs/(feed)/loading.tsx"), join(SRC, "app/layout.tsx")];
    const graph = reachable(entries);
    expect(graph.size, "the graph walk found almost nothing, so it proves nothing").toBeGreaterThan(40);
    expect(graph.has(join(SRC, "components/jobs/filter-bar.tsx")), "the walk should reach the filter bar").toBe(true);
    expect(graph.has(TEXT_AREA), "the text area is reachable from /jobs: find the import chain and cut it").toBe(false);
  });

  /*
   * THE ONE DELIBERATE EXCEPTION. The signed-in layout ((app)/layout.tsx) mounts the Farah panel on every page, and the panel's message box is the shared TextArea in its compact mode (S3-54). So the text area
   * is on every signed-in page by design, and the cost S1 measured (about 3.2 KB gzip) is paid there once, for a control that is on every page. What this still guards: the ONLY way into the text area from the
   * layout is the panel's composer. A second route in (a page, a filter bar, anything else) fails here.
   */
  it("from the signed-in layout, the text area is reached only through the Farah panel's composer", () => {
    const COMPOSER = join(SRC, "components/app-shell/farah-composer.tsx");
    const layout = join(SRC, "app/(app)/layout.tsx");
    expect(reachable([layout]).has(TEXT_AREA), "the layout should reach the text area through the composer (the exception is real)").toBe(true);
    // Walk the layout's graph without ever entering the composer: the text area must not be reachable another way.
    const seen = new Set<string>();
    const queue = [layout];
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file) || file === COMPOSER) continue;
      seen.add(file);
      for (const spec of specifiersOf(file)) {
        const next = resolveSpecifier(file, spec);
        if (next && !seen.has(next)) queue.push(next);
      }
    }
    expect(seen.has(TEXT_AREA), "the text area is reachable from the signed-in layout by a route other than the panel's composer").toBe(false);
  });
});
