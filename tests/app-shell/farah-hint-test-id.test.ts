/**
 * The first-visit hint's test id is ONE constant (src/lib/farah/first-visit-hint-id.ts), used by the hint itself and by the install strip's checks. The strip hides itself while the hint is
 * on screen on a phone and finds it by this id, so a rename that missed one side would silently put the two on top of each other again. This reads the sources and fails if either
 * side stops using the constant, spells the id out, or the id changes.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FARAH_FIRST_VISIT_HINT_TEST_ID } from "@/lib/farah/first-visit-hint-id";

const src = (rel: string) => readFileSync(path.join(__dirname, "../..", rel), "utf8");
const SIDES = [
  "src/components/app-shell/farah-first-visit-hint.tsx",
  "src/lib/pwa/install-state.ts",
  "src/lib/pwa/watch-relevant-changes.ts",
];

describe("the Farah first-visit hint's test id", () => {
  it("is farah-first-visit-hint (e2e specs and the strip's tests locate it by this value)", () => {
    expect(FARAH_FIRST_VISIT_HINT_TEST_ID).toBe("farah-first-visit-hint");
  });

  it.each(SIDES)("%s imports the shared constant and does not spell the id out", (rel) => {
    const code = src(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code, `${rel} must import the constant`).toContain("FARAH_FIRST_VISIT_HINT_TEST_ID");
    expect(code, `${rel} must not hard-code the id`).not.toContain("farah-first-visit-hint");
  });

  it("the hint element's data-testid is the constant", () => {
    expect(src("src/components/app-shell/farah-first-visit-hint.tsx")).toMatch(/data-testid=\{FARAH_FIRST_VISIT_HINT_TEST_ID\}/);
  });
});
