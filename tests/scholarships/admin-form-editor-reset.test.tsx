/**
 * Admin "New listing" form: after "Save as pending" every field resets EXCEPT the "Other eligibility notes" rich editor, which kept the previous listing's text (an operator adding a
 * second listing would carry it over). The editor is uncontrolled (TipTap's document is the source of truth and it reads its initial content once), so React's form reset cannot clear it;
 * the form now remounts it, by key, each time a save SUCCEEDS. A failed save (a field error) must NOT remount it: the operator's text stays. The decision is one pure function; the
 * browser proof is e2e/admin-scholarship-form-reset.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { nextEditorGeneration } from "@/lib/scholarships/editor-generation";
import { initialAdminScholarshipState, type AdminScholarshipState } from "@/lib/scholarships/admin-state";

const idle = initialAdminScholarshipState;
const success: AdminScholarshipState = { status: "success", pending: [], unlocked: true };
const failed: AdminScholarshipState = { status: "error", error: "Check the fields below.", fieldErrors: { officialUrl: ["Enter a full URL."] }, pending: null, unlocked: true };

describe("nextEditorGeneration", () => {
  it("a new SUCCESS state clears the editor (the generation moves, so the editor remounts empty)", () => {
    expect(nextEditorGeneration(idle, success, 0)).toBe(1);
    expect(nextEditorGeneration(success, { ...success }, 1)).toBe(2); // a second listing in a row: a new success object
  });
  it("a FAILED save keeps the editor's text (field error and general error alike)", () => {
    expect(nextEditorGeneration(idle, failed, 0)).toBe(0);
    expect(nextEditorGeneration(success, failed, 3)).toBe(3);
    expect(nextEditorGeneration(idle, { ...failed, fieldErrors: undefined }, 5)).toBe(5);
  });
  it("the same state again (a re-render) changes nothing", () => {
    expect(nextEditorGeneration(success, success, 4)).toBe(4);
  });
  it("an idle state changes nothing", () => {
    expect(nextEditorGeneration(success, idle, 2)).toBe(2);
  });
});

describe("AdminScholarshipForm wires the generation to the editor's key", () => {
  const source = readFileSync(path.join(__dirname, "../../src/app/admin/(protected)/scholarships/new/admin-scholarship-form.tsx"), "utf8").replace(/\s+/g, " ");
  it("the eligibility editor is keyed by the generation", () => {
    expect(source).toMatch(/<MinimalRichEditor key=\{editorGeneration\} id="eligibilityOther"/);
  });
  it("the generation is advanced from the create action's state, during render (no effect)", () => {
    expect(source).toContain("nextEditorGeneration(");
    // Only an effect that sets the generation is banned; the banner scroll-into-view effect is fine.
    const effectBodies = [...source.matchAll(/useEffect\(\(\) => \{([^]*?)\}, \[/g)].map((m) => m[1]).join(" ");
    expect(effectBodies).not.toContain("setEditorGeneration");
  });
});
