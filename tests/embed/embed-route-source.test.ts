/**
 * Source-level pins for the employer job-list widget (plan v2.1): the embed route is a public, cookie-free, session-free page, and it must not be able to drag the app shell onto
 * someone else's website.
 *
 * Follows every import reachable from src/app/embed/** (the `@/` alias and relative paths, transitively) and fails if any of them is on the forbidden list: the request-state
 * readers (`next/headers`), the Supabase session and browser clients (`@/lib/supabase/server`, `@/lib/supabase/client`, `@supabase/ssr`), the auth helpers, and the app shell, the
 * Farah panel and Farah's credit surfaces. The only data path is the service-role client calling the one database function (`@/lib/supabase/service-role`).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
const SRC = join(ROOT, "src");

/** Module specifiers a source text imports (static, dynamic or re-export). */
export function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  const re = /(?:\bimport\s+(?:type\s+)?(?:[^;"']*?\sfrom\s*)?|\bexport\s+(?:type\s+)?[^;"']*?\sfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push(m[1]);
  return out;
}

const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];
function resolveLocal(spec: string, fromFile: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(fromFile), spec) : null;
  if (!base) return null;
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext;
  return null;
}

/** Every file and every external specifier reachable from the entry files. */
export function closure(entries: string[]): { files: string[]; specifiers: string[] } {
  const seen = new Set<string>();
  const specs = new Set<string>();
  const queue = [...entries];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of importSpecifiers(readFileSync(f, "utf8"))) {
      specs.add(spec);
      const local = resolveLocal(spec, f);
      if (local) queue.push(local);
    }
  }
  return { files: [...seen], specifiers: [...specs] };
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

/** A forbidden specifier is matched by prefix, on the specifier as written (alias or package) and on every local file path reached. */
export const FORBIDDEN_SPECIFIERS = [
  "next/headers",
  "@supabase/ssr",
  "@/lib/supabase/server",
  "@/lib/supabase/client",
  "@/lib/supabase/middleware",
  "@/lib/auth",
  "@/components/app-shell",
];
export const FORBIDDEN_PATH_PARTS = ["/src/components/app-shell/", "/src/lib/farah/", "/src/lib/credits/", "/src/lib/supabase/server", "/src/lib/supabase/client", "/src/lib/supabase/middleware", "/src/lib/auth/", "farah-panel", "farah-quick-actions"];

export function violations(entries: string[]): string[] {
  const { files, specifiers } = closure(entries);
  const bad = specifiers.filter((s) => FORBIDDEN_SPECIFIERS.some((f) => s === f || s.startsWith(`${f}/`)));
  const badFiles = files.filter((f) => FORBIDDEN_PATH_PARTS.some((p) => f.includes(p))).map((f) => f.replace(ROOT, ""));
  return [...bad, ...badFiles];
}

describe("the detector itself (so the pin is not vacuous)", () => {
  it("reads static, type-only, dynamic and re-export specifiers", () => {
    const src = `import a from "x"; import type { B } from "@/y"; export { c } from "./z"; const d = await import("w"); import "side";`;
    expect(importSpecifiers(src).sort()).toEqual(["./z", "@/y", "side", "w", "x"]);
  });
  it("resolves and follows a local import and flags a forbidden one", () => {
    const entry = join(ROOT, "src/app/embed/jobs/[orgId]/route.ts");
    expect(closure([entry]).files.length).toBeGreaterThan(2);
    expect(violations([join(SRC, "components/app-shell/farah-panel.tsx")]).length).toBeGreaterThan(0);
    expect(violations([join(SRC, "lib/supabase/server.ts")]).length).toBeGreaterThan(0);
  });
});

describe("src/app/embed", () => {
  const entries = existsSync(join(SRC, "app/embed")) ? walk(join(SRC, "app/embed")) : [];

  it("exists and has a route", () => {
    expect(entries.some((f) => /route\.ts$/.test(f))).toBe(true);
  });

  it("reaches nothing that reads cookies, headers or a session, and nothing from the app shell, Farah or credits", () => {
    expect(violations(entries)).toEqual([]);
  });

  it("the route reads no request state at all: no cookies(), headers(), request URL or query", () => {
    const route = readFileSync(entries.find((f) => /route\.ts$/.test(f))!, "utf8");
    for (const bad of ["cookies(", "headers(", "searchParams", "nextUrl", "request.url", "req.url", "new URL("]) expect(route, bad).not.toContain(bad);
  });

  it("reads its data through the service-role client and one named function", () => {
    const { specifiers } = closure(entries);
    expect(specifiers).toContain("@/lib/supabase/service-role");
    expect(readFileSync(join(SRC, "lib/embed/widget-data.ts"), "utf8")).toContain('"org_job_widget"');
  });
});
