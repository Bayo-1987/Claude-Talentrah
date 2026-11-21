import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("/settings wiring", () => {
  const source = read("src/app/(app)/settings/page.tsx");
  const file = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true);

  it("renders the summary card, and no longer the bare text link", () => {
    expect(source).toContain("NotificationSettingsSummary");
    expect(source).not.toContain("<NotificationSettingsLink");
  });
  it("reads the cheap flag first and loads the preference row only when it is on (with every flag off the page does what it did)", () => {
    const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(text.indexOf("readNotificationsLinkFlag(")).toBeGreaterThan(-1);
    expect(text.indexOf("readNotificationsLinkFlag(")).toBeLessThan(text.indexOf("loadNotificationSummary("));
    expect(text).toMatch(/loadNotificationSummary\([\s\S]{0,80}showNotifications/);
  });
  it("the card is rendered only when the loader returned something", () => {
    let found = false;
    const visit = (n: ts.Node) => {
      if (ts.isJsxSelfClosingElement(n) && n.tagName.getText(file) === "NotificationSettingsSummary") {
        found = true;
        let p: ts.Node | undefined = n.parent;
        let guarded = false;
        while (p && !ts.isReturnStatement(p)) {
          if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) guarded = true;
          p = p.parent;
        }
        expect(guarded).toBe(true);
      }
      ts.forEachChild(n, visit);
    };
    visit(file);
    expect(found).toBe(true);
  });
  it("the detail page keeps the master-flag 404", () => {
    expect(read("src/app/(app)/settings/notifications/page.tsx")).toMatch(/notFound\(\)/);
  });
});
