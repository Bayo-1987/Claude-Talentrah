import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * End-to-end tests must not find elements by the CSS classes they happen to
 * wear.
 *
 * FOUR SPECS BROKE THIS WAY BEFORE THIS CHECK EXISTED, and none of them failed
 * in a way that pointed at the cause:
 *
 *   div.sticky.z-10   the feed header became `position: fixed`
 *   div.border-l      the Farah panel became min-[760px]:border-l  (x3 specs)
 *
 * Every one reported "element(s) not found", which reads as "the feature is
 * gone" — so the first move is always to go looking for a bug in the product.
 * The class list is styling; it moves whenever the design does, and a test
 * holding onto it is coupled to something nobody thinks of as an interface.
 *
 * A `data-testid` is the opposite: it exists only for this, so changing it is
 * a deliberate act and renaming a Tailwind class is not.
 *
 * WHAT IS STILL FINE, and why the pattern below is narrow: semantic locators
 * (`getByRole`, `getByLabel`, `getByText`), test ids, plain tag selectors, and
 * attribute selectors. This objects to ONE thing — reaching for a class.
 */

const E2E_DIR = join(process.cwd(), "e2e");

/**
 * Any string literal shaped like `tag.class` — `"div.sticky.top-0"`,
 * `"p.line-clamp-3"`.
 *
 * Matched on the STRING, not on the function around it. The first version of
 * this keyed on `querySelector|locator` and its own self-check caught the
 * hole: three of the four real breakages went through a local helper,
 * `box("div.border-l")`, which no function-name list would have found.
 *
 * A leading tag is required, so this does not fire on `".ts"` or on paths
 * like `"e2e/foo.spec.ts"` — there is no bare `.class` usage in the suite to
 * catch, and requiring the tag is what keeps the check quiet enough to trust.
 */
const HTML_TAG =
  "div|span|p|a|button|input|nav|section|form|ul|ol|li|h[1-6]|img|svg|textarea|" +
  "select|label|table|tr|td|th|main|header|footer|article|aside|details|summary";
const CLASS_IN_SELECTOR = new RegExp(`["'\`](?:${HTML_TAG})\\.[a-z\\[]`, "i");
/*
 * Restricted to real element names, which is the difference between a check
 * people keep and one they disable. Matching any `word.word` string flagged
 * `"Node.js"` in a resume fixture and `"resume.pdf"` in an upload test — both
 * correct code, and two false alarms are enough for the next person to add an
 * ignore comment instead of reading it.
 */
/** `d.className.includes("...")`, `el.classList.contains("...")`. */
const CLASS_PREDICATE = /className\.includes\(|classList\.contains\(/;

function specFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return specFiles(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

describe("e2e specs locate elements by contract, not by styling", () => {
  it("no spec finds an element through a CSS class", () => {
    const offenders: string[] = [];

    for (const file of specFiles(E2E_DIR)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        // A line that already names a test id is doing the right thing even if
        // it also mentions a class (e.g. asserting on a className value).
        if (line.includes("data-testid") || line.includes("getByTestId")) return;
        // Prose, not code. A comment explaining why `div.border-l` was wrong
        // is the opposite of the problem and must not be flagged as it.
        const code = line.trim();
        if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return;
        if (CLASS_IN_SELECTOR.test(line) || CLASS_PREDICATE.test(line)) {
          offenders.push(`${file.replace(process.cwd() + "/", "")}:${i + 1}  ${line.trim()}`);
        }
      });
    }

    expect(
      offenders,
      "These locate elements by CSS class, which breaks silently when the " +
        "design changes and reports it as a missing element. Add a data-testid " +
        "to the component and use it:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the check itself catches what it is for", () => {
    /*
     * A guard that cannot fail is decoration. These are the exact shapes the
     * four real breakages had.
     */
    for (const bad of [
      'const m = document.querySelector("div.sticky.top-0");',
      'box("div.border-l")',
      'page.locator("p.line-clamp-3").first()',
      'd.className.includes("min-[760px]:w-[280px]")',
      'el.classList.contains("border-ink")',
    ]) {
      expect(
        CLASS_IN_SELECTOR.test(bad) || CLASS_PREDICATE.test(bad),
        `the check missed: ${bad}`,
      ).toBe(true);
    }
  });

  it("does not object to the locators it should leave alone", () => {
    for (const good of [
      'page.getByRole("button", { name: "Account menu" })',
      'page.getByTestId("farah-panel")',
      'document.querySelector(\'[data-testid="content-column"]\')',
      'page.getByLabel("Email")',
      'document.querySelectorAll("button")',
      'page.locator("nav")',
      'document.querySelectorAll("a,button,input,select,textarea")',
    ]) {
      expect(
        CLASS_IN_SELECTOR.test(good) || CLASS_PREDICATE.test(good),
        `false positive on: ${good}`,
      ).toBe(false);
    }
  });
});
