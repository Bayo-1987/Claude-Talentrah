/**
 * send-503 / S18 — "₦" and the amount are ONE text node, so the accessible text of a price is "₦2,500", not "2,500".
 *
 * A price read out as "2,500" with the currency sign in a separate element (or a separate adjacent text node, which React
 * renders as `₦<!-- -->2,500`) lets a reader that walks nodes drop the sign. NairaAmount is the one component that renders a price
 * in the display font; and no JSX anywhere writes `₦{expression}`, the two-node pattern.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { NairaAmount } from "@/components/ui/naira-amount";

describe("NairaAmount", () => {
  it("renders the sign and the amount as one contiguous text node", () => {
    const html = renderToString(<p>{<NairaAmount amount={2500} />}</p>);
    expect(html).toContain(">₦2,500<");
    expect(html).not.toContain("<!-- -->");
    expect(html).not.toMatch(/₦<\/?[a-z]/);
  });

  it("groups thousands the Nigerian way and keeps zero", () => {
    expect(renderToString(<NairaAmount amount={1250000} />)).toContain("₦1,250,000");
    expect(renderToString(<NairaAmount amount={0} />)).toContain("₦0");
  });
});

describe("no JSX writes the two-node pattern ₦{expression}", () => {
  const SRC = path.resolve(__dirname, "../../src");
  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? files(p) : /\.tsx$/.test(e.name) ? [p] : [];
    });

  /** JSX text ending in ₦ whose next sibling is an expression container: React renders two adjacent text nodes. */
  function offenders(source: string, name: string): string[] {
    const sf = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const out: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isJsxText(n) && /₦\s*$/.test(n.text)) {
        const parent = n.parent;
        const kids: readonly ts.JsxChild[] = ts.isJsxElement(parent) || ts.isJsxFragment(parent) ? parent.children : [];
        const next = kids[kids.indexOf(n) + 1];
        if (next && ts.isJsxExpression(next)) out.push(sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 + "");
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  }

  it("scanner positive control: it flags ₦{x} and passes a template string", () => {
    expect(offenders("const a = <p>Pay ₦{amount}</p>;", "x.tsx")).toHaveLength(1);
    expect(offenders("const a = <p>{`₦${amount}`}</p>;", "x.tsx")).toEqual([]);
  });

  it("src/ has none", () => {
    const hits = files(SRC).flatMap((f) => offenders(fs.readFileSync(f, "utf8"), f).map((l) => `${path.relative(SRC, f)}:${l}`));
    expect(hits, "write the price as one string: {`₦${n.toLocaleString(\"en-NG\")}`}").toEqual([]);
  });
});
