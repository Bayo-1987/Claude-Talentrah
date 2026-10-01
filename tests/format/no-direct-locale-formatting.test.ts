/**
 * send-499 — RATCHET: no screen formats a date by hand.
 *
 * Every date and time a person reads goes through src/lib/format/datetime.ts (and relative times through
 * src/lib/format-relative-time.ts). A new direct call fails here, with the file and line.
 *
 * What is flagged, found with the TypeScript compiler (not a grep, which cannot tell a Date from a number):
 *   - any `.toLocaleDateString(...)` or `.toLocaleTimeString(...)`;
 *   - any `Intl.DateTimeFormat`;
 *   - any `.toLocaleString(...)` whose receiver is a Date (or cannot be told apart from one: `any`/`unknown`).
 * NOT flagged: `.toLocaleString()` on a number (₦ amounts, counts); that is number formatting, which this does not own.
 *
 * The only file allowed to use them is the formatter itself, plus an explicit ALLOWLIST (locale-formatting-allowlist.ts) of
 * today's remaining violations that can only ever SHRINK: tests/format/ratchet-check.ts holds it exactly equal to the real
 * hits and its ceiling at or below where it started, so a new violation fails, a converted site that is still listed fails, and
 * the allowlist cannot grow. The scanner is proven able to fail, and not vacuous: it must have read the real source tree.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { checkRatchet } from "./ratchet-check";
import { ALLOWLIST, ALLOWLIST_CEILING, INITIAL_VIOLATIONS } from "./locale-formatting-allowlist";

const ROOT = path.resolve(__dirname, "../..");
const ALLOWED = new Set(["src/lib/format/datetime.ts"]);

interface Hit {
  file: string;
  line: number;
  text: string;
}

function scan(program: ts.Program, only?: (rel: string) => boolean): Hit[] {
  const checker = program.getTypeChecker();
  const hits: Hit[] = [];
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const rel = path.relative(ROOT, sf.fileName).split(path.sep).join("/");
    if (only ? !only(rel) : !rel.startsWith("src/")) continue;
    if (ALLOWED.has(rel)) continue;

    const flag = (node: ts.Node) => {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
      hits.push({ file: rel, line: line + 1, text: node.getText().replace(/\s+/g, " ").slice(0, 90) });
    };

    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const name = n.expression.name.text;
        if (name === "toLocaleDateString" || name === "toLocaleTimeString") flag(n);
        else if (name === "toLocaleString") {
          const t = checker.getTypeAtLocation(n.expression.expression);
          const typeName = checker.typeToString(t);
          const isDate = typeName === "Date" || typeName === "any" || typeName === "unknown";
          if (isDate) flag(n);
        }
      }
      if (
        ts.isPropertyAccessExpression(n) &&
        n.name.text === "DateTimeFormat" &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === "Intl"
      ) {
        flag(n);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return hits;
}

function programFor(files: Record<string, string>): ts.Program {
  const host = ts.createCompilerHost({});
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, lang, ...rest) => {
    const rel = path.relative(ROOT, name).split(path.sep).join("/");
    return rel in files ? ts.createSourceFile(name, files[rel], lang, true) : original(name, lang, ...rest);
  };
  const originalExists = host.fileExists.bind(host);
  host.fileExists = (name) => path.relative(ROOT, name).split(path.sep).join("/") in files || originalExists(name);
  return ts.createProgram(
    Object.keys(files).map((f) => path.join(ROOT, f)),
    { target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts"], noEmit: true, skipLibCheck: true, types: [] },
    host,
  );
}

describe("the scanner itself", () => {
  const src = (code: string) => scan(programFor({ "src/x.ts": code }), (r) => r === "src/x.ts");

  it("flags toLocaleDateString, toLocaleTimeString and Intl.DateTimeFormat", () => {
    expect(src(`export const a = new Date().toLocaleDateString();`)).toHaveLength(1);
    expect(src(`export const a = new Date().toLocaleTimeString("en");`)).toHaveLength(1);
    expect(src(`export const a = new Intl.DateTimeFormat("en").format(new Date());`)).toHaveLength(1);
  });

  it("flags toLocaleString on a Date, however it was built", () => {
    expect(src(`export const a = new Date(1).toLocaleString();`)).toHaveLength(1);
    expect(src(`const d: Date = new Date(); export const a = d.toLocaleString("en-GB", { dateStyle: "medium" });`)).toHaveLength(1);
    expect(src(`export const a = (x: string) => new Date(x).toLocaleString(undefined, { hour: "numeric" });`)).toHaveLength(1);
  });

  it("does NOT flag number formatting (₦ amounts, counts), the thing a grep cannot tell apart", () => {
    expect(src(`export const a = (n: number) => n.toLocaleString();`)).toEqual([]);
    expect(src(`export const a = (n: number) => \`₦\${n.toLocaleString("en-NG")}\`;`)).toEqual([]);
    expect(src(`export const a = (r: { total: number }) => r.total.toLocaleString();`)).toEqual([]);
  });

  it("flags a receiver it cannot type (any / unknown) rather than waving it through", () => {
    expect(src(`export const a = (x: any) => x.toLocaleString();`)).toHaveLength(1);
  });

  it("ignores comments and strings that merely mention the methods", () => {
    expect(src(`// d.toLocaleDateString()\nexport const a = "toLocaleDateString";`)).toEqual([]);
  });
});

describe("src/ formats dates only through the formatter (modulo the shrinking allowlist)", () => {
  const tsconfig = ts.readConfigFile(path.join(ROOT, "tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(tsconfig.config, ts.sys, ROOT);
  const program = ts.createProgram(
    parsed.fileNames.filter((f) => f.includes(`${path.sep}src${path.sep}`)),
    { ...parsed.options, noEmit: true },
  );
  const hits = scan(program);

  it("is not vacuous: it read hundreds of real source files", () => {
    const read = program.getSourceFiles().filter((f) => !f.isDeclarationFile && f.fileName.includes(`${path.sep}src${path.sep}`));
    expect(read.length).toBeGreaterThan(300);
  });

  it("has no direct date formatting outside src/lib/format/datetime.ts, except exactly what the allowlist says", () => {
    const problems = checkRatchet({ hits, allowlist: ALLOWLIST, ceiling: ALLOWLIST_CEILING, initial: INITIAL_VIOLATIONS });
    expect(
      problems,
      `${problems.join("\n")}\n\nHits:\n${hits.map((h) => `  ${h.file}:${h.line}  ${h.text}`).join("\n")}`,
    ).toEqual([]);
  }, 120_000);

  it("the allowlist ceiling has not grown since main (skipped, loudly, where origin/main is not available)", (ctx) => {
    let mainSource: string;
    try {
      mainSource = execFileSync("git", ["show", "origin/main:tests/format/locale-formatting-allowlist.ts"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      ctx.skip("origin/main (or the file on it) is not available in this checkout, so growth since main cannot be checked here");
      return;
    }
    const onMain = Number(/ALLOWLIST_CEILING = (\d+)/.exec(mainSource)?.[1]);
    expect(Number.isFinite(onMain), "could not read ALLOWLIST_CEILING from origin/main").toBe(true);
    expect(ALLOWLIST_CEILING, "the allowlist may only shrink: its ceiling is above the one on main").toBeLessThanOrEqual(onMain);
  });
});
