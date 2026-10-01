/**
 * send-495 / S19 — house rule: the product says "Resume", never "CV".
 *
 * /refer promised "2 free CV tailorings", the Start-from-a-template screen said "Import my CV" and "a complete,
 * realistic CV", and billing still says "1 CV tailoring". A grep for "CV" cannot tell a string a person reads from
 * a comment or an identifier, so this reads the real thing: it parses every .ts/.tsx under src/ with the TypeScript
 * compiler and checks only string literals, template-literal text and JSX text. Comments are not nodes, so they
 * never trip it.
 *
 * It is a RATCHET: a new seeker-facing "CV" fails here. The one allowlisted string is billing/page.tsx's
 * "1 CV tailoring", which belongs to the billing-copy PR (S18); that PR deletes the entry along with the string,
 * and the test below fails if an entry outlives its string, so it cannot be forgotten.
 *
 * The scanner is proven able to fail (positive controls below) and proven not to be vacuous (it must have read
 * real files, and must find the allowlisted string where it says it is).
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../src");
const CV = /\bCVs?\b/;

/** Strings a person might read, from one source text: literals, template text, JSX text. */
function textNodes(source: string, fileName = "x.tsx"): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text);
    else if (ts.isJsxText(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts") ? [p] : [];
  });
}

/** file (relative to src/) -> the exact string that is allowed to say CV, with who removes it. */
const ALLOWED: Record<string, { text: string; removedBy: string }> = {
  "app/(app)/billing/page.tsx": { text: "1 CV tailoring · credits never expire", removedBy: "the S18 billing-copy PR" },
};

const files = sourceFiles(SRC);
const hits = files.flatMap((f) => {
  const rel = path.relative(SRC, f).split(path.sep).join("/");
  return textNodes(fs.readFileSync(f, "utf8"), f)
    .filter((t) => CV.test(t))
    .map((t) => ({ file: rel, text: t.replace(/\s+/g, " ").trim() }));
});

describe("the scanner itself", () => {
  it("flags a CV in a string literal, a template literal and JSX text", () => {
    expect(textNodes(`const a = "Import my CV";`).filter((t) => CV.test(t))).toHaveLength(1);
    expect(textNodes("const b = `Open a CV ${x}`;").filter((t) => CV.test(t))).toHaveLength(1);
    expect(textNodes(`export const C = () => <p>Add your CV here</p>;`).filter((t) => CV.test(t))).toHaveLength(1);
    expect(textNodes(`export const D = () => <input placeholder="Your CV" />;`).filter((t) => CV.test(t))).toHaveLength(1);
  });

  it("ignores comments, identifiers and words that merely contain the letters", () => {
    expect(textNodes(`// Import my CV\n/* CV */ const CVBuilder = 1; const x = "ACVB";`).filter((t) => CV.test(t))).toEqual([]);
  });

  it("is not vacuous: it read real source files and found the one allowlisted string", () => {
    expect(files.length).toBeGreaterThan(200);
    const entry = ALLOWED["app/(app)/billing/page.tsx"];
    expect(hits.some((h) => h.file === "app/(app)/billing/page.tsx" && h.text === entry.text), "the allowlisted string is gone: delete its ALLOWED entry").toBe(true);
  });
});

describe("seeker-facing strings say Resume, never CV", () => {
  it("has no CV in any string, template or JSX text under src/ (except the allowlisted one)", () => {
    const unexpected = hits.filter((h) => ALLOWED[h.file]?.text !== h.text);
    expect(unexpected, `say "Resume":\n${unexpected.map((h) => `  ${h.file}: ${h.text}`).join("\n")}`).toEqual([]);
  });
});

describe("the S19 copy changes themselves", () => {
  const read = (rel: string) => textNodes(fs.readFileSync(path.join(SRC, rel), "utf8"), rel).join(" ").replace(/\s+/g, " ");

  it("/refer promises 'resume tailorings' in the heading and in the body", () => {
    const text = read("app/(app)/refer/page.tsx");
    expect(text.match(/free resume tailorings/g)?.length, "heading and body should both say 'free resume tailorings'").toBe(2);
  });
});
