/**
 * Finds `vi.mock("<module>", <factory>)` calls in a test file and says what kind of factory each is, with the TypeScript parser (not a grep: a string that merely contains "vi.mock(" is not a call).
 *
 *   hand    a hand-written object: it replaces the module with exactly the names it lists, so a function the module gains later (and that code under the test calls) is missing from the mock and the test fails
 *   shared  built by a helper in tests/**\/support (safeSpendTally, safeChatGate): the helper is the one place that carries the module's exports
 *   safe    spreads the real module (`importActual` / `importOriginal`) and overrides what the test needs, so new exports come through untouched
 *
 * `vi.mock("<module>")` with no factory (an automock) is not reported: it mocks every export by itself.
 */
import ts from "typescript";

export type FactoryKind = "hand" | "shared" | "safe";
export interface FactoryMock {
  module: string;
  kind: FactoryKind;
  line: number;
}

export function classifyFactory(factoryText: string): FactoryKind {
  if (/\bimportActual\b|\bimportOriginal\b/.test(factoryText)) return "safe";
  if (/\bimport\(\s*["'`]\.{1,2}\/(?:[\w-]+\/)*(?:support|helpers)\//.test(factoryText) || /\broute-mocks\b/.test(factoryText)) return "shared";
  return "hand";
}

export function findFactoryMocks(sourceText: string, fileName = "x.ts"): FactoryMock[] {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2022, true, fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: FactoryMock[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === "vi" &&
      n.expression.name.text === "mock" &&
      n.arguments.length >= 2 &&
      ts.isStringLiteralLike(n.arguments[0])
    ) {
      const { line } = sf.getLineAndCharacterOfPosition(n.getStart());
      found.push({ module: n.arguments[0].text, kind: classifyFactory(n.arguments[1].getText(sf)), line: line + 1 });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}
