/**
 * A "use client" file must not pull `zod` into the browser (PERF-WEIGHT-1).
 *
 * The public job page shipped zod with every language pack (about 94 KB gzipped, 391 KB raw) because `report-job-menu.tsx` imported a constant list, REPORT_REASONS, from `lib/reports/schemas.ts`, which
 * imports zod for its server-side validation. The validation never runs in the browser; the bundler still included the library. This scans every "use client" file and follows its real imports: a module
 * marked "use server" is a stub on the client (the action is called over the network, its code is not shipped) so the walk stops there, and `import type` is erased. A client file that reaches `from "zod"`
 * is reported, unless it is on the list below.
 *
 * THE LIST ONLY SHRINKS. The remaining entries are forms that already did this before the check existed (their pages pay the same ~94 KB); each is a separate small change (move what the client needs, a constant or a
 * type, to a module without zod). A new client file, or a seventh, fails here. When an entry is fixed, delete it: the "stale entry" test fails until you do.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "../..");
const SRC = path.join(ROOT, "src");

/** client file (relative to the repo root) -> the zod module it reaches. Shrink only. */
export const ALLOWED: Record<string, string> = {
  "src/app/(app)/feedback/feedback-form.tsx": "src/lib/feedback/schemas.ts",
  "src/app/(app)/settings/settings-form.tsx": "src/lib/auth/schemas.ts",
  "src/app/contact/contact-form.tsx": "src/lib/contact/schemas.ts",
  "src/components/auth/signup-form.tsx": "src/lib/auth/schemas.ts",
};

function walk(dir: string, out: Map<string, string>): Map<string, string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.set(path.relative(ROOT, full), readFileSync(full, "utf8"));
  }
  return out;
}

const directive = (source: string, which: "use client" | "use server") =>
  new RegExp(`^(?:\\s*/\\*[\\s\\S]*?\\*/|\\s*//[^\\n]*)*\\s*["']${which}["']`).test(source);
const IMPORT = /(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/g;

export function zodReach(files: Map<string, string>): Map<string, string> {
  const resolve = (spec: string, from: string): string | null => {
    const base = spec.startsWith("@/") ? path.join("src", spec.slice(2)) : spec.startsWith(".") ? path.normalize(path.join(path.dirname(from), spec)) : null;
    if (!base) return null;
    return [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")].find((c) => files.has(c)) ?? null;
  };
  const memo = new Map<string, string | null>();
  const reaches = (file: string, seen: string[]): string | null => {
    if (memo.has(file)) return memo.get(file)!;
    if (seen.includes(file)) return null;
    const source = files.get(file)!;
    let found: string | null = null;
    if (/from\s+["']zod["']/.test(source)) found = file;
    else if (!directive(source, "use server")) {
      for (const m of source.matchAll(IMPORT)) {
        if (m[1]) continue; // import type: erased
        const target = resolve(m[2], file);
        if (!target) continue;
        found = reaches(target, [...seen, file]);
        if (found) break;
      }
    }
    memo.set(file, found);
    return found;
  };
  const out = new Map<string, string>();
  for (const [file, source] of files) {
    if (!directive(source, "use client")) continue;
    const hit = reaches(file, []);
    if (hit) out.set(file, hit);
  }
  return out;
}

describe("client components stay zod-free", () => {
  const reach = zodReach(walk(SRC, new Map()));

  it("no client file reaches zod except the ones on the shrink-only list", () => {
    const fresh = [...reach].filter(([file]) => !(file in ALLOWED)).map(([file, via]) => `${file} -> ${via}`);
    expect(fresh, `These "use client" files pull zod into the browser (about 94 KB gzipped). Move what the client needs (a constant, a type) into a module that does not import zod:\n${fresh.join("\n")}`).toEqual([]);
  });

  it("the public job page's report menu is clean (the case that started this)", () => {
    expect(reach.has("src/components/jobs/report-job-menu.tsx")).toBe(false);
  });

  it("the list has no stale entry: a fixed file must be deleted from ALLOWED", () => {
    const stale = Object.keys(ALLOWED).filter((file) => !reach.has(file));
    expect(stale, `Fixed: delete from ALLOWED -> ${stale.join(", ")}`).toEqual([]);
  });

  describe("the detector (so a silent scan cannot pass for the wrong reason)", () => {
    const fixture = (extra: Record<string, string>) =>
      new Map<string, string>(Object.entries({ "src/lib/a/schemas.ts": 'import { z } from "zod";\nexport const R = [1];\nexport const s = z.string();', ...extra }));
    it("a client file importing a module that imports zod is reported", () => {
      const r = zodReach(fixture({ "src/components/x.tsx": '"use client";\nimport { R } from "@/lib/a/schemas";' }));
      expect([...r.keys()]).toEqual(["src/components/x.tsx"]);
    });
    it("a transitive import is followed", () => {
      const r = zodReach(fixture({ "src/lib/a/mid.ts": 'export { R } from "./schemas";', "src/components/x.tsx": '"use client";\nimport { R } from "@/lib/a/mid";' }));
      expect([...r.keys()]).toEqual(["src/components/x.tsx"]);
    });
    it("a type-only import is erased and a use-server module is a stub: neither is reported", () => {
      const r = zodReach(
        fixture({
          "src/lib/a/actions.ts": '"use server";\nimport { s } from "./schemas";\nexport async function go() { return s; }',
          "src/components/x.tsx": '"use client";\nimport type { R } from "@/lib/a/schemas";\nimport { go } from "@/lib/a/actions";',
        }),
      );
      expect([...r.keys()]).toEqual([]);
    });
    it("a server-only file importing zod is not a client file and is not reported", () => {
      expect([...zodReach(fixture({ "src/lib/a/server.ts": 'import { s } from "./schemas";' })).keys()]).toEqual([]);
    });
  });
});
