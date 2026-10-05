/**
 * No database. (1) The checker is proven against PLANTED writes, so the real scan below cannot be passing because the checker is blind. (2) The real scan fails if any file that uses the browser Supabase client
 * (anon key in the browser), or any helper that is handed that client, inserts, updates, upserts or deletes through `.from(...)`, or calls `.rpc(`. (3) A new file that names the public anon key must be reviewed and added to the list.
 * Why: see tests/support/browser-client-writes.ts.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANON_KEY_FILES_REVIEWED, acceptsSupabaseClient, browserWriteFindings, usesBrowserClient } from "../support/browser-client-writes";

const BROWSER_FILE = `"use client";\nimport { createClient } from "@/lib/supabase/client";\n`;
const planted = (body: string) => `${BROWSER_FILE}export function f() {\n  const supabase = createClient();\n  ${body}\n}\n`;

describe("the checker flags a planted browser write", () => {
  it("insert", () => expect(browserWriteFindings("x.tsx", planted('void supabase.from("feedback").insert({ message: "hi" });')).map((f) => f.reason)).toEqual([".from(...).insert( from the browser client"]));
  it("update", () => expect(browserWriteFindings("x.tsx", planted('void supabase.from("profiles").update({ first_name: "x" }).eq("id", 1);')).map((f) => f.reason)).toEqual([".from(...).update( from the browser client"]));
  it("upsert", () => expect(browserWriteFindings("x.tsx", planted('void supabase.from("resumes").upsert({ id: 1 });')).map((f) => f.reason)).toEqual([".from(...).upsert( from the browser client"]));
  it("delete", () => expect(browserWriteFindings("x.tsx", planted('void supabase.from("applications").delete().eq("id", 1);')).map((f) => f.reason)).toEqual([".from(...).delete( from the browser client"]));
  it("a chain broken over several lines", () => expect(browserWriteFindings("x.tsx", planted('void supabase\n    .from("applications")\n    .eq("user_id", 1)\n    .delete();')).length).toBe(1));
  it("a storage upload", () => expect(browserWriteFindings("x.tsx", planted('void supabase.storage.from("resumes").upload("a.pdf", file);')).map((f) => f.reason)[0]).toMatch(/upload/));
  it("an rpc", () => expect(browserWriteFindings("x.tsx", planted('void supabase.rpc("grant_something", {});')).map((f) => f.reason)[0]).toMatch(/\.rpc\(/));
  it("a helper that is handed the client", () => {
    const helper = `import type { SupabaseClient } from "@supabase/supabase-js";\nexport async function h(s: SupabaseClient) { await s.from("profiles").update({ a: 1 }); }\n`;
    expect(acceptsSupabaseClient(helper)).toBe(true);
    expect(browserWriteFindings("h.ts", helper, { helper: true })).toHaveLength(1);
  });
  it("createBrowserClient used directly", () => {
    const src = `import { createBrowserClient } from "@supabase/ssr";\nconst s = createBrowserClient("u", "k");\nvoid s.from("feedback").insert({});\n`;
    expect(usesBrowserClient(src)).toBe(true);
    expect(browserWriteFindings("x.ts", src)).toHaveLength(1);
  });
});

describe("the checker sees the browser client however it is loaded", () => {
  const dynamic = (body: string) => `"use client";\nexport async function f() {\n  const { createClient } = await import("@/lib/supabase/client");\n  const supabase = createClient();\n  ${body}\n}\n`;
  it("a dynamic import followed by an insert is flagged", () => {
    const src = dynamic('void supabase.from("feedback").insert({ message: "hi" });');
    expect(usesBrowserClient(src)).toBe(true);
    expect(browserWriteFindings("x.tsx", src).map((f) => f.reason)).toEqual([".from(...).insert( from the browser client"]);
  });
  it("a dynamic import with only auth and select calls is not flagged", () => {
    const src = dynamic('void supabase.auth.getSession(); void supabase.from("blog_posts").select("id").limit(1);');
    expect(usesBrowserClient(src)).toBe(true);
    expect(browserWriteFindings("x.tsx", src)).toEqual([]);
  });
  it.each([
    ['await import("@/lib/supabase/client")'],
    ["await import('@/lib/supabase/client')"],
    ['await import( "@/lib/supabase/client" )'],
    ['await import("../supabase/client")'],
    ['await import("../../lib/supabase/client")'],
    ['await import("./client")'],
    ['require("@/lib/supabase/client")'],
  ])("%s counts as loading the browser client", (load) => expect(usesBrowserClient(`const m = ${load};\n`)).toBe(true));
  it("a dynamic import of some other module does not", () => expect(usesBrowserClient('const m = await import("@/lib/supabase/server");\n')).toBe(false));
});

describe("the checker leaves good code alone", () => {
  it("auth calls and reads", () => expect(browserWriteFindings("x.tsx", planted('void supabase.auth.getSession(); void supabase.from("blog_posts").select("id").limit(1);'))).toEqual([]));
  it("a Map or URLSearchParams delete is not a table write", () => expect(browserWriteFindings("x.tsx", planted("const m = new Map(); m.delete(1); const p = new URLSearchParams(); p.delete('a'); document.body.classList.remove('x');"))).toEqual([]));
  it("a server file (session client) is not in scope", () => expect(browserWriteFindings("s.ts", `import { createClient } from "@/lib/supabase/server";\nvoid (await createClient()).from("feedback").insert({});\n`)).toEqual([]));
  it("a service-role write is not in scope", () => expect(browserWriteFindings("s.ts", `import { createServiceRoleClient } from "@/lib/supabase/service-role";\nvoid createServiceRoleClient().from("feedback").insert({});\n`)).toEqual([]));
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) && e.name !== "types.ts" && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
}

/** `@/lib/x/y` imports of a file, resolved to src paths that exist. */
function localImports(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/from\s+["']@\/([^"']+)["']/g)) {
    for (const cand of [`src/${m[1]}.ts`, `src/${m[1]}.tsx`, `src/${m[1]}/index.ts`, `src/${m[1]}/index.tsx`]) if (existsSync(cand)) { out.push(cand); break; }
  }
  return out;
}

describe("the real source", () => {
  const files = sourceFiles("src");
  const text = (f: string) => readFileSync(f, "utf8");
  const browserFiles = files.filter((f) => !f.endsWith("src/lib/supabase/client.ts") && usesBrowserClient(text(f)));
  const helpers = [...new Set(browserFiles.flatMap((f) => localImports(text(f))))].filter((f) => !browserFiles.includes(f) && !f.endsWith("src/lib/supabase/client.ts") && acceptsSupabaseClient(text(f)));

  it("scans real files and finds the browser-client files and a helper that takes the client (non-vacuity)", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(browserFiles.length).toBeGreaterThanOrEqual(3);
    expect(helpers.length).toBeGreaterThanOrEqual(1);
  });
  it("no browser-client file or helper handed the browser client inserts, updates, upserts, deletes or calls rpc", () => {
    const findings = [...browserFiles.flatMap((f) => browserWriteFindings(f, text(f))), ...helpers.flatMap((f) => browserWriteFindings(f, text(f), { helper: true }))];
    expect(findings, findings.map((f) => `${f.file}:${f.line} ${f.reason}  ${f.snippet}`).join("\n")).toEqual([]);
  });
  it("only the reviewed files name the public anon key", () => {
    const named = files.filter((f) => text(f).includes("NEXT_PUBLIC_SUPABASE_ANON_KEY")).sort();
    expect(named, "a new file that names the anon key builds an anon-key client: check that it does not write, then add it to ANON_KEY_FILES_REVIEWED").toEqual([...ANON_KEY_FILES_REVIEWED].sort());
  });
});
