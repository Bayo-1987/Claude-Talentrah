import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * RULING B4. The accessor module holds exactly ONE double cast, and no other
 * file of the contract (the contract itself and the fakes) holds one.
 *
 * It counts CAST EXPRESSIONS in the syntax tree, so a comment that talks about
 * the cast is not a cast.
 *
 * SCOPE, reported to the Reviewer: the ruling says no other file under the
 * notifications directory may hold one, but four older double casts sit on
 * origin/main in three files this branch may not touch (win-back, proactive
 * match alert, employer resume view). This test therefore covers the files of
 * the contract: the contract, the accessor module and the fakes directory.
 */
const ROOT = path.resolve(__dirname, "../../src/lib/notifications");
const CONTRACT_FILES = ["contract.ts", "contract-db.ts", ...readdirSync(path.join(ROOT, "fakes")).filter((f) => f.endsWith(".ts")).map((f) => `fakes/${f}`)];

/** Counts `x as unknown as T`: a cast whose operand is itself a cast to `unknown`. */
export function countDoubleCasts(source: string): number {
  const file = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  let count = 0;
  const visit = (node: ts.Node) => {
    if (ts.isAsExpression(node)) {
      const inner = node.expression;
      const through = ts.isParenthesizedExpression(inner) ? inner.expression : inner;
      if (ts.isAsExpression(through) && through.type.kind === ts.SyntaxKind.UnknownKeyword) count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return count;
}

const countIn = (relative: string) => countDoubleCasts(readFileSync(path.join(ROOT, relative), "utf8"));

describe("the counter itself", () => {
  it("counts a double cast, ignores a single cast, a cast to unknown alone, and a comment about it", () => {
    expect(countDoubleCasts("const a = b as unknown as C;")).toBe(1);
    expect(countDoubleCasts("const a = (b as unknown) as C;")).toBe(1);
    expect(countDoubleCasts("const a = b as C;")).toBe(0);
    expect(countDoubleCasts("const a = b as unknown;")).toBe(0);
    expect(countDoubleCasts("// x as unknown as Y\nconst a = 1;")).toBe(0);
    expect(countDoubleCasts("const a = b as unknown as C; const d = e as unknown as F;")).toBe(2);
  });
});

describe("ruling B4: one double cast in the accessor module, none elsewhere in the contract", () => {
  it("the file list really covers the contract, the accessor module and the fakes", () => {
    expect(CONTRACT_FILES).toEqual(expect.arrayContaining(["contract.ts", "contract-db.ts", "fakes/fake-backend.ts", "fakes/fake-push-sender.ts", "fakes/index.ts"]));
  });

  it("the accessor module holds exactly one", () => {
    expect(countIn("contract-db.ts")).toBe(1);
  });

  for (const file of CONTRACT_FILES.filter((f) => f !== "contract-db.ts")) {
    it(`${file} holds none`, () => {
      expect(countIn(file)).toBe(0);
    });
  }
});
