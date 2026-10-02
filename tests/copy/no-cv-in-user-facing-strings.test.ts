/**
 * send-495 / S19 — house rule: the product says "Resume", never "CV".
 *
 * /refer promised "2 free CV tailorings", the Start-from-a-template screen said "Import my CV" and "a complete,
 * realistic CV", and billing still says "1 CV tailoring". A grep for "CV" cannot tell a string a person reads from
 * a comment or an identifier, so this reads the real thing: it parses every .ts/.tsx under src/ with the TypeScript
 * compiler and checks only string literals, template-literal text and JSX text. Comments are not nodes, so they
 * never trip it.
 *
 * It is a RATCHET: a new seeker-facing "CV" fails here. The allowlisted strings are billing/page.tsx's
 * "1 CV tailoring" (belongs to the billing-copy PR, S18; that PR deletes the entry along with the string) and the ISO
 * country code "CV" (Cabo Verde) in lib/jobs/countries.ts,
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
  // Not the word: ISO 3166-1 alpha-2 for Cabo Verde, in the country-code table ("CV" -> "Cape Verde"). Found when S12 added the file.
  "lib/jobs/countries.ts": { text: "CV", removedBy: "nobody: it is a country code, not copy" },
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

  it("is not vacuous: it read real source files and found every allowlisted string where it says it is", () => {
    expect(files.length).toBeGreaterThan(200);
    for (const [file, entry] of Object.entries(ALLOWED)) {
      expect(hits.some((h) => h.file === file && h.text === entry.text), `${file}: the allowlisted string is gone: delete its ALLOWED entry`).toBe(true);
    }
  });

  it("the country-code exemption is exactly that: a bare CV elsewhere still fails", () => {
    // Same text, different file: not allowed. (ALLOWED is keyed by file.)
    expect(ALLOWED["app/(app)/refer/page.tsx"]).toBeUndefined();
    expect(ALLOWED["lib/jobs/countries.ts"]?.text).toBe("CV");
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

  it("/refer says 'resume tailorings' (never CV), from the one derived reward sentence the page and the public landing use", async () => {
    // Since 0215 the wording is derived from the reward and the tailoring price (src/lib/referrals/copy.ts), not hard-coded
    // in the page, so the Resume-not-CV rule is pinned where the words are now produced, and the page must use them.
    const { referralRewardHeadline, referralRewardWorth } = await import("@/lib/referrals/copy");
    expect(referralRewardWorth()).toMatch(/enough for \d+ resume tailorings?/);
    for (const sentence of [referralRewardHeadline(), referralRewardWorth()]) expect(sentence).not.toMatch(/\bCVs?\b/);
    const page = fs.readFileSync(path.join(SRC, "app/(app)/refer/page.tsx"), "utf8");
    expect(page).toContain("referralRewardHeadline()");
    expect(page).toContain("referralRewardWorth()");
  });
});
