/**
 * The install strip in the EMPLOYER shell (src/app/employer/layout.tsx), next to the seeker shell's (src/components/app-shell/app-shell.tsx).
 *
 * The employer layout is an async Server Component that calls getOptionalUser() and the database; a unit test cannot render it without hand-written module factories for the shared
 * auth modules, which tests/ci/mock-factory-ratchet.test.ts forbids adding. So the decision it makes is split out where it can be tested for real (EmployerInstallStrip: nothing under
 * the kill switch, the shared lazy strip otherwise), and WHERE the layout mounts it is pinned by reading its source. The behaviour in a browser is e2e/pwa-install-strip-employer.spec.ts.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isValidElement } from "react";
import ts from "typescript";
import { EmployerInstallStrip } from "@/components/employer/employer-install-strip";
import { InstallStripLazy } from "@/components/pwa/install-strip-lazy";

const read = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");
/** Source with comments removed: the files explain the very things the checks forbid. */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * The employer layout read as a syntax tree. Nothing here depends on a local variable's name or on where a helper is declared:
 *  - the layout is the DEFAULT EXPORT of the file (not "the first function");
 *  - the signed-out branch is found by the SHAPE of the guard (a top-level `if (!x)` with no else, whose body always returns), not by what x is called;
 *  - "mounts the strip" means the strip is REACHABLE from a branch: every identifier and JSX tag in it is followed into same-file declarations (function declarations, const arrows
 *    and const aliases, wherever they are declared), transitively, until it meets a name the file imported from the strip's own modules or an alias of one.
 */
const layoutFile = () => ts.createSourceFile("layout.tsx", read("src/app/employer/layout.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const STRIP_MODULE = /(^|\/)(employer-install-strip|install-strip-lazy|install-strip)$/;

function findAll(node: ts.Node, pred: (n: ts.Node) => boolean): ts.Node[] {
  const out: ts.Node[] = [];
  const walk = (n: ts.Node) => {
    if (pred(n)) out.push(n);
    ts.forEachChild(n, walk);
  };
  walk(node);
  return out;
}

/** The default-exported function of the file: `export default function X() {}`, or `export default X` pointing at a function declaration or a const arrow. */
function defaultExportBody(file: ts.SourceFile): ts.Block {
  const hasMod = (n: ts.Node, k: ts.SyntaxKind) => ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === k);
  let fn: ts.Node | undefined = file.statements.find((st) => ts.isFunctionDeclaration(st) && hasMod(st, ts.SyntaxKind.ExportKeyword) && hasMod(st, ts.SyntaxKind.DefaultKeyword));
  if (!fn) {
    const assign = file.statements.find((st): st is ts.ExportAssignment => ts.isExportAssignment(st) && !st.isExportEquals);
    if (assign && ts.isIdentifier(assign.expression)) {
      const name = assign.expression.text;
      fn = file.statements.find((st) => ts.isFunctionDeclaration(st) && st.name?.text === name);
      if (!fn) {
        const decl = findAll(file, (n) => ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name)[0] as ts.VariableDeclaration | undefined;
        fn = decl?.initializer;
      }
    } else if (assign) fn = assign.expression;
  }
  const body = fn && (ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) ? fn.body : undefined;
  expect(body && ts.isBlock(body), "the layout is the default export of src/app/employer/layout.tsx and has a block body").toBe(true);
  return body as ts.Block;
}

const alwaysReturns = (st: ts.Statement): boolean =>
  ts.isReturnStatement(st) || (ts.isBlock(st) && st.statements.length > 0 && alwaysReturns(st.statements[st.statements.length - 1]));

/** signedOut: the early-return guard (`if (!x) return ...`, no else); rest: the statements after it in the same body, i.e. the signed-in shell. */
function employerLayoutBranches() {
  const body = defaultExportBody(layoutFile()).statements;
  const at = body.findIndex(
    (st) => ts.isIfStatement(st) && !st.elseStatement && ts.isPrefixUnaryExpression(st.expression) && st.expression.operator === ts.SyntaxKind.ExclamationToken && alwaysReturns(st.thenStatement),
  );
  return { signedOut: at === -1 ? null : (body[at] as ts.IfStatement).thenStatement, rest: at === -1 ? [] : body.slice(at + 1) };
}

/** Local names that ARE the strip: whatever the file imports from the strip's own modules (renamed imports included), plus every const alias of one, to a fixed point. */
function stripNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const st of file.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !STRIP_MODULE.test(st.moduleSpecifier.text)) continue;
    const c = st.importClause;
    if (c?.name) names.add(c.name.text);
    if (c?.namedBindings && ts.isNamedImports(c.namedBindings)) for (const e of c.namedBindings.elements) names.add(e.name.text);
  }
  const aliases = findAll(file, (n) => ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && !!n.initializer && ts.isIdentifier(n.initializer)) as ts.VariableDeclaration[];
  for (let grew = true; grew; ) {
    grew = false;
    for (const d of aliases) {
      const alias = (d.name as ts.Identifier).text;
      if (names.has((d.initializer as ts.Identifier).text) && !names.has(alias)) {
        names.add(alias);
        grew = true;
      }
    }
  }
  return names;
}

/** Same-file declarations by name (function declarations, and any variable with an initializer: arrows, function expressions, elements, aliases), wherever they sit in the file. */
function declarations(file: ts.SourceFile): Map<string, ts.Node[]> {
  const map = new Map<string, ts.Node[]>();
  const add = (name: string, node: ts.Node) => map.set(name, [...(map.get(name) ?? []), node]);
  for (const n of findAll(file, () => true)) {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) add(n.name.text, n.body);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) add(n.name.text, n.initializer);
  }
  return map;
}

/** True when the strip is reachable from `roots`: any identifier or JSX tag in them that is a strip name, or that names a same-file declaration from which one is reachable. */
function reachesStrip(roots: ts.Node[]): boolean {
  const file = layoutFile();
  const strip = stripNames(file);
  const decls = declarations(file);
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const node = queue.pop()!;
    for (const id of findAll(node, ts.isIdentifier) as ts.Identifier[]) {
      if (strip.has(id.text)) return true;
      if (!seen.has(id.text) && decls.has(id.text)) {
        seen.add(id.text);
        queue.push(...decls.get(id.text)!);
      }
    }
  }
  return false;
}

const saved = process.env.PWA_KILL;
afterEach(() => {
  if (saved === undefined) delete process.env.PWA_KILL;
  else process.env.PWA_KILL = saved;
});

describe("EmployerInstallStrip", () => {
  it("is the shared lazy strip (not a copy) when the kill switch is off", () => {
    delete process.env.PWA_KILL;
    const el = EmployerInstallStrip();
    expect(isValidElement(el)).toBe(true);
    expect((el as { type: unknown }).type).toBe(InstallStripLazy);
  });

  it("renders NOTHING when PWA_KILL is exactly '1' (it also covers the iOS hint, which needs no prompt event)", () => {
    process.env.PWA_KILL = "1";
    expect(EmployerInstallStrip()).toBeNull();
  });

  it.each(["", "0", "true", " 1"])("only '1' kills: PWA_KILL=%j still shows it", (v) => {
    process.env.PWA_KILL = v;
    expect((EmployerInstallStrip() as { type: unknown } | null)?.type).toBe(InstallStripLazy);
  });

  it("reads the variable when it is rendered, not when the module loads (the layout is dynamic)", () => {
    delete process.env.PWA_KILL;
    expect(EmployerInstallStrip()).not.toBeNull();
    process.env.PWA_KILL = "1";
    expect(EmployerInstallStrip()).toBeNull();
  });
});

describe("the employer layout mounts it in the signed-in branch only, last", () => {
  const layout = code("src/app/employer/layout.tsx");

  it("imports the employer wrapper and does not import next/dynamic or the strip internals", () => {
    expect(layout).toMatch(/import \{ EmployerInstallStrip \} from "@\/components\/employer\/employer-install-strip"/);
    expect(layout).not.toMatch(/next\/dynamic|install-strip-view|install-state/);
  });

  it("renders it AFTER the signed-out early return, so a signed-out visitor and the public /employer page get none", () => {
    // Read as a syntax tree, not as text (see employerLayoutBranches): rename-proof, and it follows helpers and aliases.
    const { signedOut, rest } = employerLayoutBranches();
    expect(signedOut, "an early-return guard (`if (!x) return ...`) exists in the layout").not.toBeNull();
    expect(reachesStrip([signedOut!]), "the strip is not reachable from the signed-out branch: not directly, not through a same-file helper component or an alias").toBe(false);
    expect(reachesStrip(rest), "the strip is reachable from the statements after the early return").toBe(true);
  });

  it("PINS DOCUMENTED BEHAVIOUR: a signed-in user with NO organisation (e.g. on /employer/onboarding) gets the strip too; the owner decision on a role gate is pending", () => {
    // layout.tsx documents that it deliberately does not call requireEmployer() (onboarding lives under it, a redirect would loop), so the shell, and the strip with it, renders
    // for any signed-in user whatever their organisation. This test records that as it stands; it is NOT a statement that it is right. If the owner decides the strip should be
    // gated on a role or an organisation, this test is the one to change on purpose.
    const { rest } = employerLayoutBranches();
    const strip = stripNames(layoutFile());
    const mounts = rest.flatMap((st) => findAll(st, (n) => ts.isJsxSelfClosingElement(n) && strip.has(n.tagName.getText())));
    expect(mounts).toHaveLength(1);
    let node: ts.Node | undefined = mounts[0].parent;
    const gates: string[] = [];
    while (node && !ts.isReturnStatement(node)) {
      const conditional =
        ts.isConditionalExpression(node) ||
        ts.isIfStatement(node) ||
        (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind));
      if (conditional) gates.push(node.getText().slice(0, 60));
      node = node.parent;
    }
    expect(gates, "the mount sits on the unconditional signed-in return, behind no condition (no role, organisation or context gate)").toEqual([]);
    expect(layout).toMatch(/getEmployerContext\(\)/);
    expect(layout, "the layout does not call requireEmployer()/requireUser(): that would redirect an organisation-less user and loop on /employer/onboarding").not.toMatch(/\brequire(Employer|User)\s*\(/);
  });

  it("puts it last in the shell, after the content wrapper (a fixed bar, last in DOM order so the skip link stays the first Tab stop)", () => {
    expect(layout.indexOf("<EmployerInstallStrip")).toBeGreaterThan(layout.indexOf("{children}"));
    expect(layout.indexOf("<EmployerInstallStrip")).toBeGreaterThan(layout.indexOf("<EmployerMasthead"));
  });
});

describe("on a phone the bar stands on the bottom edge in the employer shell", () => {
  // The shared bar is raised 58.5px (bottom-[calc(58.5px+env(safe-area-inset-bottom))] below 760px) to stand above the SEEKER shell's Farah tab, whose own reserve covers that
  // slot. The strip's spacer is measured to the bar's height only, so without a tab the last 58.5px of every employer page sat under the bar. The employer layout wraps the strip
  // and puts the bar on the edge instead (a descendant selector beats the bar's own class; the shared strip files are untouched), keeping the safe area as the bar's own bottom
  // padding so the spacer, which is measured from the bar, still matches it.
  const layout = code("src/app/employer/layout.tsx");

  it("wraps the strip in an element that overrides the bar's bottom offset and the safe-area padding", () => {
    const at = layout.indexOf("<EmployerInstallStrip");
    const wrapperStart = layout.lastIndexOf("<div", at);
    const wrapper = layout.slice(wrapperStart, at);
    expect(wrapper).toContain("[&_[data-testid=install-strip]]:bottom-0");
    expect(wrapper).toContain("[&_[data-testid=install-strip]]:pb-[calc(0.25rem+env(safe-area-inset-bottom))]");
    expect(layout.slice(at)).toMatch(/^<EmployerInstallStrip \/>\s*<\/div>/); // the wrapper holds the strip and nothing after it
  });

  it("does not add its own fixed padding next to the strip's spacer", () => {
    expect(layout).not.toMatch(/58\.5px/);
  });

  it("changes nothing in the shared strip or the seeker shell", () => {
    // Launcher PR-2: the seeker shell has no bottom bar any more, so the shared strip stands on the bottom edge at every width (the Farah launcher floats above it on a phone). The employer wrapper
    // above is therefore redundant but identical in effect, and is left alone so this change does not reach into the employer side.
    expect(read("src/components/pwa/install-strip-view.tsx")).toMatch(/fixed inset-x-0 bottom-0 z-\[17\]/);
    expect(read("src/components/pwa/install-strip-view.tsx")).not.toContain("58.5px");
    expect(code("src/components/pwa/install-strip-lazy.tsx")).not.toMatch(/employer/i);
  });
});

describe("hidden in print", () => {
  it("the bar and its spacer both carry print:hidden (the employer layout prints the applicant resume through the shell)", () => {
    expect(read("src/components/pwa/install-strip-view.tsx")).toContain("print:hidden");
    expect(read("src/components/pwa/install-strip.tsx")).toMatch(/data-testid="install-strip-spacer"[^>]*className="print:hidden"/);
  });
});
