/**
 * The feed page hands the RIGHT value to each piece. tests/jobs/country-urls.test.tsx pins the helpers and no-default-country-ui.test.tsx pins the filter bar's markup, but
 * the page that connects them (an async Server Component that cannot be rendered here without module factories the ratchet forbids) was covered only by "does not read the
 * profile". A wrong variable to FeedTabs (the APPLIED country instead of the CHOSEN one, which differ on Saved), to the bar or to the helper line would pass all of that.
 * So the page source is read as a syntax tree, resolved through the destructuring of resolveCountryParam rather than through any local variable's name.
 *
 * The same walk in a real browser, against the built app, is e2e/country-no-default-wiring.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const rel = "src/app/(app)/jobs/(feed)/page.tsx";
const file = ts.createSourceFile(rel, readFileSync(path.resolve(__dirname, "../..", rel), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const all = (pred: (n: ts.Node) => boolean): ts.Node[] => {
  const out: ts.Node[] = [];
  const walk = (n: ts.Node) => {
    if (pred(n)) out.push(n);
    ts.forEachChild(n, walk);
  };
  walk(file);
  return out;
};

/** The two local names resolveCountryParam's result is bound to: `applied` (what the tab applies) and `chosen` (what the URL named; survives on Saved). */
function boundNames() {
  const decls = all((n) => ts.isVariableDeclaration(n) && !!n.initializer && ts.isCallExpression(n.initializer) && n.initializer.expression.getText() === "resolveCountryParam") as ts.VariableDeclaration[];
  expect(decls, "resolveCountryParam is destructured once").toHaveLength(1);
  const pattern = decls[0].name;
  expect(ts.isObjectBindingPattern(pattern), "the result is destructured").toBe(true);
  const bound: Record<string, string> = {};
  for (const el of (pattern as ts.ObjectBindingPattern).elements) {
    const prop = (el.propertyName ?? el.name).getText();
    bound[prop] = el.name.getText();
  }
  expect(bound.country, "country is bound").toBeTruthy();
  expect(bound.chosen, "chosen is bound").toBeTruthy();
  expect(bound.country).not.toBe(bound.chosen);
  return { applied: bound.country, chosen: bound.chosen };
}

const attr = (tag: string, name: string): string | undefined => {
  const els = all((n) => (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText() === tag) as (ts.JsxSelfClosingElement | ts.JsxOpeningElement)[];
  expect(els, `<${tag}> is rendered once`).toHaveLength(1);
  const a = els[0].attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name);
  const init = a?.initializer;
  return init && ts.isJsxExpression(init) ? init.expression?.getText().replace(/\s+/g, " ") : undefined;
};

describe("the feed page's wiring of the country", () => {
  it("FeedTabs gets the country the URL CHOSEN (it survives Saved, which applies none), not the applied one", () => {
    expect(attr("FeedTabs", "country")).toBe(boundNames().chosen);
  });

  it("FilterBar gets the APPLIED country, and the profile suggestion is built from the profile country, the CHOSEN country and the tab", () => {
    const { applied, chosen } = boundNames();
    expect(attr("FilterBar", "country")).toBe(applied);
    expect(attr("FilterBar", "suggestedCountry")).toMatch(new RegExp(`^countrySuggestion\\(\\w+\\.country, ${chosen}, tab\\)$`));
  });

  it("the helper line is given the APPLIED country (so it is silent when none is applied and names the one that is)", () => {
    expect(attr("CountryNote", "country")).toBe(boundNames().applied);
  });

  it("Most Recent's paging links are given the APPLIED country", () => {
    const calls = all((n) => ts.isCallExpression(n) && n.expression.getText() === "recentPageHref") as ts.CallExpression[];
    expect(calls).toHaveLength(1);
    const arg = calls[0].arguments[0] as ts.ObjectLiteralExpression;
    const country = arg.properties.find((p) => p.name?.getText() === "country");
    expect(ts.isShorthandPropertyAssignment(country!) ? country.name.getText() : (country as ts.PropertyAssignment).initializer.getText()).toBe(boundNames().applied);
  });
});
