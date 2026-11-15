import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { notifyNewApplicantWith } from "@/lib/notifications/new-applicant/notify";

const ROOT = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The names of the call expressions that enclose a node, innermost first. */
function enclosingCalls(node: ts.Node): string[] {
  const names: string[] = [];
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) names.push(n.expression.text);
  return names;
}
function callsNamed(source: ts.SourceFile, name: string): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) found.push(n);
    ts.forEachChild(n, visit);
  };
  visit(source);
  return found;
}

describe("the one hook where an application is created (src/lib/applications/actions.ts)", () => {
  const file = ts.createSourceFile("actions.ts", read("src/lib/applications/actions.ts"), ts.ScriptTarget.Latest, true);

  it("calls notifyNewApplicant exactly once, and imports it from the new-applicant module", () => {
    expect(callsNamed(file, "notifyNewApplicant")).toHaveLength(1);
    expect(read("src/lib/applications/actions.ts")).toContain('import { notifyNewApplicant } from "@/lib/notifications/new-applicant/notify";');
  });
  it("runs it AFTER THE RESPONSE: the call sits inside an after() callback, inside a try, beside the existing instant email", () => {
    const [call] = callsNamed(file, "notifyNewApplicant");
    expect(enclosingCalls(call)).toContain("after");
    let insideTry = false;
    for (let n: ts.Node | undefined = call.parent; n; n = n.parent) if (ts.isTryStatement(n)) insideTry = true;
    expect(insideTry).toBe(true);
    const [email] = callsNamed(file, "notifyFirstApplicant");
    expect(call.getStart()).toBeGreaterThan(email.getStart());
    expect(enclosingCalls(email)).toContain("after");
  });
  it("is awaited inside the callback, so a rejection cannot escape it as an unhandled one", () => {
    const [call] = callsNamed(file, "notifyNewApplicant");
    expect(ts.isAwaitExpression(call.parent)).toBe(true);
  });
});

describe("the event keeps the sender out of the page and out of the request", () => {
  it("the new-applicant module never imports the push wiring statically (so web-push is not loaded when the flags are off); it loads it with a dynamic import", () => {
    const dir = path.join(ROOT, "src/lib/notifications/new-applicant");
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".ts") && statSync(path.join(dir, f)).isFile())) {
      const code = stripComments(readFileSync(path.join(dir, name), "utf8"));
      expect(code, name).not.toMatch(/^import[^;]*from\s+["'][^"']*push\/wiring["']/m);
      expect(code, name).not.toMatch(/^import[^;]*from\s+["'][^"']*web-push/m);
    }
    expect(stripComments(read("src/lib/notifications/new-applicant/push-gates.ts"))).toMatch(/await import\(["'][^"']*push\/wiring["']\)/);
  });
  it("the viewed notice and the match alert load the sender the same way: no static import of the wiring", () => {
    for (const file of ["src/lib/notifications/employer-resume-view/notify.ts", "src/lib/notifications/proactive-match-alert/send.ts"]) {
      expect(stripComments(read(file)), file).not.toMatch(/^import[^;]*from\s+["'][^"']*push\/wiring["']/m);
    }
  });
  it("a sender that throws, a database that fails and a flag store that is down all leave the caller with nothing thrown (the response is the apply's own, unchanged)", async () => {
    const boom = async () => {
      throw new Error("down");
    };
    await expect(
      notifyNewApplicantWith("x", { flagOn: boom, prefs: boom, deliver: boom, notice: boom, recipients: boom, claimInbox: boom, writeInbox: boom, releaseInbox: boom }),
    ).resolves.toBeUndefined();
  });
});
