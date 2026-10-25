/**
 * REGRESSION GUARD: every key the app writes to the visitor's own browser storage is named in the Data & Cookie Notice.
 *
 * The notice once said Talentrah saves "two small notes" in the browser; the remembered sign-in email (src/lib/auth/remembered-email.ts) made that false. This test reads src, finds EVERY client
 * storage write (localStorage / sessionStorage `setItem(key, ...)`, `indexedDB.open(name, ...)`, and any assignment to `document.cookie`), resolves each key to the string the code spells (through
 * `const` and `export const` constants and one level of alias, across files), and fails when that key does not appear in the notice's visible text. A new `setItem` anywhere in src therefore fails
 * until the notice names it; a key the scan cannot resolve also fails (an unresolvable key is a key nobody checked).
 *
 * Out of scope on purpose: the server-set sign-in cookies (set by Supabase on the server, `src/lib/supabase/server.ts`, already listed in the notice), and reads (`getItem`).
 * EXEMPTIONS: none today. The list below is the only way to exempt a key; each entry needs a reason, must name a key the scan really finds, and the list itself is pinned, so widening it fails.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DataCookieNoticePage from "@/app/legal/data-cookie-notice/page";

const ROOT = path.resolve(__dirname, "../..");
/** key -> why it need not be in the notice. Empty on purpose; see the pin below. */
const EXEMPT: Record<string, string> = {};

type SourceFile = { file: string; text: string };

function walk(dir: string, out: SourceFile[] = []): SourceFile[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push({ file: path.relative(ROOT, full), text: readFileSync(full, "utf8") });
  }
  return out;
}

/** Source with comments removed (the files explain the very calls this looks for). Strings are kept. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

/** `const NAME = "literal"` and `const A = B` aliases declared in ONE file, and the `export const NAME = "literal"` constants of all files (what an import can reach). */
function constantsOf(text: string): { literals: Map<string, string>; aliases: Map<string, string> } {
  const literals = new Map<string, string>();
  const aliases = new Map<string, string>();
  for (const m of stripComments(text).matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*(?::\s*[\w<>[\]| ]+)?=\s*(?:"([^"\n]*)"|'([^'\n]*)'|([A-Za-z_$][\w$]*)\s*[;\n])/g)) {
    if (m[2] !== undefined || m[3] !== undefined) literals.set(m[1], (m[2] ?? m[3])!);
    else if (m[4]) aliases.set(m[1], m[4]);
  }
  return { literals, aliases };
}

function exportedLiterals(files: SourceFile[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const { text } of files) for (const m of stripComments(text).matchAll(/\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*(?::\s*[\w<>[\]| ]+)?=\s*(?:"([^"\n]*)"|'([^'\n]*)')/g)) out.set(m[1], (m[2] ?? m[3])!);
  return out;
}

/** A name used as a key, resolved in the file that uses it first (two files may both call theirs STORAGE_KEY), then through the exported constants an import can reach, following aliases. */
function resolveName(name: string, local: ReturnType<typeof constantsOf>, exported: Map<string, string>): string | undefined {
  let current = name;
  for (let hops = 0; hops < 4; hops++) {
    const direct = local.literals.get(current) ?? exported.get(current);
    if (direct !== undefined) return direct;
    const next = local.aliases.get(current);
    if (!next) return undefined;
    current = next;
  }
  return undefined;
}

export function findWrittenKeys(files: SourceFile[]): { keys: Map<string, string[]>; unresolved: string[] } {
  const exported = exportedLiterals(files);
  const keys = new Map<string, string[]>();
  const unresolved: string[] = [];
  const note = (key: string, file: string) => keys.set(key, [...(keys.get(key) ?? []), file]);
  for (const { file, text } of files) {
    const code = stripComments(text);
    const local = constantsOf(text);
    const args: string[] = [];
    for (const m of code.matchAll(/\bsetItem\s*\(\s*([^,)]+?)\s*[,)]/g)) args.push(m[1]);
    for (const m of code.matchAll(/\bindexedDB\s*\.\s*open\s*\(\s*([^,)]+?)\s*[,)]/g)) args.push(m[1]);
    for (const arg of args) {
      const literal = /^(?:"([^"]*)"|'([^']*)')$/.exec(arg);
      const resolved = literal ? (literal[1] ?? literal[2]) : resolveName(arg, local, exported);
      if (resolved === undefined) unresolved.push(`${file}: ${arg}`);
      else note(resolved, file);
    }
    if (/\bdocument\s*\.\s*cookie\s*=(?!=)/.test(code)) unresolved.push(`${file}: a client-side write to document.cookie`);
  }
  return { keys, unresolved };
}

const noticeText = () => renderToStaticMarkup(<DataCookieNoticePage />).replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");

describe("the scan can say yes (controls on synthetic sources)", () => {
  const file = (text: string): SourceFile => ({ file: "synthetic.ts", text });
  it("finds a literal key, a constant key and an alias, ignores a comment, flags an unresolvable key and a cookie write", () => {
    const { keys, unresolved } = findWrittenKeys([
      file(`const K = "talentrah.a"; const ALIAS = K; localStorage.setItem(K, "1"); sessionStorage.setItem(ALIAS, "2"); localStorage.setItem("talentrah.b", "3"); indexedDB.open("talentrah-db", 1);`),
      file(`// localStorage.setItem("talentrah.commented", "x")\n /* sessionStorage.setItem("talentrah.block", "x") */ localStorage.setItem(computeKey(), "4"); document.cookie = "a=b";`),
    ]);
    expect([...keys.keys()].sort()).toEqual(["talentrah-db", "talentrah.a", "talentrah.b"]);
    expect(unresolved.some((u) => u.includes("computeKey("))).toBe(true);
    expect(unresolved.some((u) => u.includes("document.cookie"))).toBe(true);
  });
});

describe("every client storage key in src is named in the Data & Cookie Notice", () => {
  const { keys, unresolved } = findWrittenKeys(walk(path.join(ROOT, "src")));

  it("is not vacuous: it finds the keys we know about", () => {
    for (const known of ["talentrah.farahLauncher", "talentrah-cookie-consent", "talentrah.lastEmail", "talentrah-install-dismissed", "talentrah:pending-job-banner", "talentrah-pending-job-assessment-files"]) {
      expect([...keys.keys()], `the scan no longer finds ${known}`).toContain(known);
    }
  });

  it("resolves every key (an unresolvable key, or a client write to document.cookie, is a failure)", () => {
    expect(unresolved).toEqual([]);
  });

  it("names every key in the notice's visible text, except those on the named exemption list", () => {
    const text = noticeText();
    const missing = [...keys.entries()].filter(([key]) => !(key in EXEMPT) && !text.includes(key)).map(([key, where]) => `${key} (written in ${[...new Set(where)].join(", ")})`);
    expect(missing, "these keys are written to the visitor's browser but the Data & Cookie Notice does not name them").toEqual([]);
  });

  it("keeps the exemption list empty, and any entry must give a reason and name a key the scan really finds", () => {
    expect(Object.keys(EXEMPT)).toEqual([]);
    for (const [key, reason] of Object.entries(EXEMPT)) {
      expect(reason.trim().length, `exemption ${key} needs a reason`).toBeGreaterThan(10);
      expect([...keys.keys()], `exemption ${key} names a key nothing writes`).toContain(key);
    }
  });
});
