/**
 * PR-U1: the service-role client is reached only AFTER the permission check, and only from the two route files. deps.ts is the one module that creates it. The routes load deps.ts
 * lazily, inside the `service` provider they give the handler (an `await import(...)`), and the handler calls that provider only after its guard (origin, admin session, `jobs_import`)
 * has passed. So a request that is not an admin with the permission never loads the module, let alone creates the client. Static checks of the source, plus a run with fakes.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handleConfirm, handlePreview } from "@/lib/jobs/sheet-import/handlers";
import { ADMIN, ORIGIN, formRequest, makeDeps, sheetOf, sha12 } from "./support";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path.relative(ROOT, p).split(path.sep).join("/"));
  }
  return out;
}
const ROUTES = ["src/app/admin/jobs-import/confirm/route.ts", "src/app/admin/jobs-import/preview/route.ts"];

describe("deps.ts, the service-role client, is named by the two routes and nowhere else", () => {
  it("only the confirm and preview routes name it", () => {
    const naming = walk(path.join(ROOT, "src")).filter((f) => /sheet-import\/deps["']/.test(code(f)) || (f.startsWith("src/lib/jobs/sheet-import/") && /from ["']\.\/deps["']/.test(code(f))));
    expect(naming.sort()).toEqual([...ROUTES].sort());
  });

  it("neither route imports it at the top: it is an `await import()` inside the service provider, the only place that names it", () => {
    for (const f of ROUTES) {
      const src = code(f);
      expect(src, f).not.toMatch(/^import[^\n]*sheet-import\/deps"/m);
      expect(src, f).toMatch(/service:\s*async\s*\(\)\s*=>\s*\(await import\("@\/lib\/jobs\/sheet-import\/deps"\)\)\.realService\(\)/);
      expect(src.match(/sheet-import\/deps"/g), f).toHaveLength(1);
    }
  });

  it("createServiceRoleClient is named by deps.ts and by no other file of the uploader", () => {
    const naming = walk(path.join(ROOT, "src/lib/jobs/sheet-import")).filter((f) => code(f).includes("createServiceRoleClient"));
    expect(naming).toEqual(["src/lib/jobs/sheet-import/deps.ts"]);
  });
});

describe("each handler asks for the service only after its guard", () => {
  const src = code("src/lib/jobs/sheet-import/handlers.ts");
  const body = (name: string) => src.slice(src.indexOf(`export async function ${name}`));
  it.each([["handlePreview"], ["handleConfirm"]])("%s calls guard() before the first deps.service()", (name) => {
    const fn = name === "handlePreview" ? body(name).slice(0, body(name).indexOf("export async function handleConfirm")) : body(name);
    const guard = fn.indexOf("await guard(");
    const service = fn.indexOf("deps.service(");
    expect(guard).toBeGreaterThan(-1);
    expect(service).toBeGreaterThan(guard);
  });

  it("the guard itself never asks for the service", () => {
    const guardFn = src.slice(src.indexOf("async function guard("), src.indexOf("type Read ="));
    expect(guardFn).not.toMatch(/\.service\(/);
    expect(guardFn).toMatch(/permissions\.includes\(JOBS_IMPORT_PERMISSION\)/);
  });
});

describe.each([["preview", handlePreview], ["confirm", handleConfirm]] as const)("the %s handler, run with fakes: the service provider is never called for a request that fails the guard", (name, handler) => {
  const text = sheetOf({ link: 1 });
  const fields: Record<string, string> = name === "confirm" ? { sha12: sha12(text), importable: "1", batches: "1", tick: "on" } : {};
  const cases: Array<[string, Partial<Parameters<typeof makeDeps>[0]>, { origin?: string | null }]> = [
    ["no admin session", { getAdmin: async () => null }, {}],
    ["an admin without jobs_import", { getAdmin: async () => ({ ...ADMIN, permissions: ["blog"] }) }, {}],
    ["another origin", {}, { origin: "https://evil.example.test" }],
    ["no origin header", {}, { origin: null }],
  ];
  it.each(cases)("%s", async (_label, over, init) => {
    let asked = 0;
    const { deps } = makeDeps({ ...over, service: () => (asked++, {} as never) });
    const res = await handler(formRequest(name, text, fields, init), deps);
    expect([401, 403]).toContain(res.status);
    expect(asked).toBe(0);
  });

  it("is called for an admin with jobs_import (the control case)", async () => {
    let asked = 0;
    const { deps, db } = makeDeps();
    deps.service = () => (asked++, db as never);
    const res = await handler(formRequest(name, text, fields), deps);
    expect(res.status).toBe(200);
    expect(asked).toBeGreaterThan(0);
    void ORIGIN;
  });
});
