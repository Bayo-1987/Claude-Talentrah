/**
 * The scanner behind tests/lib/identifier-columns-not-read-by-callers.test.ts: finds every read of the four tables 0232 narrows that a signed-in
 * or signed-out caller's client makes, and returns the ones the new grants would refuse. Lives here so the same scan can be pointed at other
 * trees (the tests' own reads) without importing a test file.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { refusalFor, WITHHELD } from "./fake-grants-client";

const ROOT = join(__dirname, "..", "..");

export function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

export const ROOT_DIR = ROOT;
export const FILES = walk(join(ROOT, "src"))
  .map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, "utf8") }))
  .filter((f) => f.path !== "src/lib/supabase/types.ts");

/** Operator scripts build their own client with the service key (see the last test), so they are checked for that rather than for column lists. */
export const SCRIPTS = walk(join(ROOT, "scripts")).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, "utf8") }));

/** The code without its comments, with the layout kept (so line numbers still point at the right place). */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[\s;{}(,])\/\/.*$/gm, "$1");
}

/** `const NAME = "literal"` (and `export const`), found anywhere in src, for a select list held in a named constant. */
function stringConstants(files: { text: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const { text } of files) {
    for (const m of stripComments(text).matchAll(/\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*string\s*)?=\s*(["'`])((?:\\.|(?!\2)[^\\])*)\2\s*;/g)) {
      if (!map.has(m[1])) map.set(m[1], m[3].replace(/\s+/g, " "));
    }
  }
  return map;
}
export const CONSTANTS = stringConstants(FILES);

/** The text of the first argument of a call whose `(` is at `open`, balanced over parentheses and quotes. */
function firstArgument(text: string, open: number): { arg: string; end: number } {
  let depth = 0;
  let quote: string | null = null;
  const start = open + 1;
  let arg: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return { arg: (arg ?? text.slice(start, i)).trim(), end: i };
    } else if (ch === "," && depth === 1 && arg === null) arg = text.slice(start, i);
  }
  return { arg: (arg ?? text.slice(start)).trim(), end: text.length };
}

/** The select list a first argument stands for: a string literal as written, or a named constant resolved; null when it cannot be known. */
function resolveList(arg: string): string | null {
  const literal = /^(["'`])([\s\S]*)\1$/.exec(arg);
  if (literal) return literal[2].replace(/\$\{[^}]*\}/g, "x").replace(/\s+/g, " ");
  if (arg === "") return "";
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(arg)) return CONSTANTS.get(arg) ?? null;
  return null;
}

export type Kind = "service" | "caller";

/** Which client the variable in front of a `.from(` is. A service-role client says so where it is made; everything else is the caller's. */
export function clientKind(text: string, fromIndex: number): { kind: Kind; name: string } {
  const before = text.slice(Math.max(0, fromIndex - 200), fromIndex);
  const m = /([A-Za-z_$][\w$]*)\s*$/.exec(before);
  const name = m ? m[1] : "?";
  if (/createServiceRoleClient\(\)\s*$/.test(before)) return { kind: "service", name: "createServiceRoleClient()" };
  if (name === "?") return { kind: "caller", name };
  const id = name.replace(/\$/g, "\\$");
  const decl = new RegExp(`(?:const|let)\\s+${id}\\s*=\\s*(?:await\\s+)?([A-Za-z_][\\w]*)\\(`).exec(text);
  if (decl && decl[1] === "createServiceRoleClient") return { kind: "service", name };
  const param = new RegExp(`(?:^|[^\\w$])${id}\\s*:\\s*([^,)=]*ServiceRole[^,)=]*)`).exec(text);
  if (param) return { kind: "service", name };
  return { kind: "caller", name };
}

const FILTER_METHODS = "eq|neq|in|is|not|order|ilike|like|contains|overlaps|gt|gte|lt|lte|match";

export interface Problem {
  where: string;
  what: string;
}

/** Every read through a caller's client that the new grants would refuse. */
export function problemsIn(files: { path: string; text: string }[]): Problem[] {
  const problems: Problem[] = [];
  for (const { path, text: raw } of files) {
    const text = stripComments(raw);
    for (const m of text.matchAll(/\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g)) {
      const table = m[1];
      const { kind, name } = clientKind(text, m.index!);
      if (kind === "service") continue;
      const rest = text.slice(m.index!, m.index! + 1800);
      const stmtEnd = rest.search(/;\s*(\n|$)/);
      const chain = stmtEnd === -1 ? rest : rest.slice(0, stmtEnd);
      const line = text.slice(0, m.index!).split("\n").length;
      const select = /\.select\(/.exec(chain);
      if (select) {
        const open = select.index + select[0].length - 1;
        const { arg } = firstArgument(chain, open);
        const list = resolveList(arg);
        if (list === null) {
          if (table in WITHHELD) problems.push({ where: `${path}:${line}`, what: `${table} .select(${arg}) via ${name}: the list cannot be resolved to a literal` });
        } else {
          const refusal = refusalFor(table, list);
          if (refusal) problems.push({ where: `${path}:${line}`, what: `${table} .select(${JSON.stringify(list).slice(0, 80)}) via ${name}: ${refusal.message}` });
        }
      }
      for (const f of chain.matchAll(new RegExp(`\\.(${FILTER_METHODS})\\(\\s*["'\`]([a-z_]+)`, "g"))) {
        if ((WITHHELD[table] ?? []).includes(f[2])) problems.push({ where: `${path}:${line}`, what: `${table} .${f[1]}("${f[2]}") via ${name}: a withheld column used as a filter or sort` });
      }
    }
  }
  return problems;
}

