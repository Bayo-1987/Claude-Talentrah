/**
 * Admin "New listing" form: the Deadline note's character counter ("N / 600") is React state set only in the field's onChange. After a save the form is reset (every native field comes
 * back empty), but the counter kept the PREVIOUS listing's count, in red if it was over the limit, beside an empty field. It now returns to 0 whenever the create action returns a new
 * state (a save, a refusal: the form is reset either way), in the same render-time block that remounts the notes editor.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.join(__dirname, "../../src/app/admin/(protected)/scholarships/new/admin-scholarship-form.tsx"), "utf8").replace(/\s+/g, " ");

describe("the Deadline note counter after a save", () => {
  const block = source.slice(source.indexOf("if (state !== seenState) {"), source.indexOf("}", source.indexOf("if (state !== seenState) {")) + 1);
  it("finds the render-time block that reacts to a new action state", () => {
    expect(block.length).toBeGreaterThan(20);
    expect(block).toContain("setEditorGeneration(");
  });
  it("resets the counter to 0 in that block (no effect needed)", () => {
    expect(block).toContain("setNoteLength(0)");
    expect(source).not.toMatch(/useEffect/);
  });
  it("the counter state is declared BEFORE the block that resets it", () => {
    expect(source.indexOf("const [noteLength, setNoteLength]")).toBeGreaterThan(-1);
    expect(source.indexOf("const [noteLength, setNoteLength]")).toBeLessThan(source.indexOf("if (state !== seenState) {"));
  });
  it("typing still updates it", () => {
    expect(source).toContain("setNoteLength(e.target.value.trim().length)");
  });
});
