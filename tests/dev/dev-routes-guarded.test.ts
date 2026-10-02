/**
 * Every route under /dev/ is a QA fixture and must 404 on the live site, including one added later.
 *
 * Found by the file-input work (S3): /dev/design-check, /dev/resume-editor-fixture and /dev/banner-crop-fixture answered
 * 200 on talentrah.com, each guarded (if at all) page by page. One guard on the /dev layout covers every page beneath it,
 * so a fixture added tomorrow is closed by default; this test fails if that stops being true.
 */
import "react/jsx-dev-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const DEV = path.join(process.cwd(), "src/app/dev");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("the /dev layout guards every page beneath it", () => {
  const layoutPath = path.join(DEV, "layout.tsx");

  it("exists, and calls notFound() when isDevFixtureAllowed() is false", () => {
    const src = readFileSync(layoutPath, "utf8");
    expect(src).toMatch(/isDevFixtureAllowed\(\)/);
    expect(src).toMatch(/notFound\(\)/);
  });

  it("marks every fixture noindex (a second layer behind the 404)", () => {
    const src = readFileSync(layoutPath, "utf8");
    expect(src).toMatch(/robots:\s*\{[^}]*index:\s*false/);
  });

  it("there is no route handler under /dev (a route.ts would bypass the layout)", () => {
    const routes = walk(DEV).filter((f) => /(^|\/)route\.(ts|tsx|js)$/.test(f));
    expect(routes).toEqual([]);
  });

  it("every page under /dev is a plain page.tsx the layout wraps (and the scan found some, so this is not vacuous)", () => {
    const pages = walk(DEV).filter((f) => /(^|\/)page\.tsx$/.test(f));
    expect(pages.length).toBeGreaterThan(0);
  });

  it("no page opts out of the layout with its own parallel/intercepting route group", () => {
    const odd = walk(DEV).filter((f) => /\/(@|\(\.\))/.test(f.slice(DEV.length)));
    expect(odd).toEqual([]);
  });
});

describe("the layout answers 404 on the live site", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock("next/navigation");
  });

  async function layout() {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({
      notFound: () => {
        throw new Error("NEXT_NOT_FOUND");
      },
    }));
    return (await import(/* @vite-ignore */ "@/app/dev/layout")) as { default: (p: { children: unknown }) => unknown };
  }

  it("VERCEL_ENV=production with NODE_ENV=production: notFound()", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    const mod = await layout();
    expect(() => mod.default({ children: null })).toThrow("NEXT_NOT_FOUND");
  });

  it("CI's build (no VERCEL_ENV) renders its children", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    const mod = await layout();
    expect(() => mod.default({ children: null })).not.toThrow();
  });
});

describe("robots.txt keeps crawlers out of /dev/ too", () => {
  it("disallows /dev/", async () => {
    const mod = await import("@/app/robots");
    const robots = mod.default();
    const rules = Array.isArray(robots.rules) ? robots.rules : [robots.rules];
    const disallow = rules.flatMap((r) => (Array.isArray(r.disallow) ? r.disallow : r.disallow ? [r.disallow] : []));
    expect(disallow).toContain("/dev/");
  });
});
