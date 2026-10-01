/**
 * The Achievements editor's bulleted-list control. The editor is paragraph-
 * per-bullet (MinimalRichEditorList), so the control only has to settle one
 * question the paragraphs cannot: does a role with a SINGLE achievement print
 * as a one-item bulleted list, or as a prose line? Two or more paragraphs are
 * always a list. TipTap cannot render server-side (see
 * experience-bullets-rich-text.test.tsx), so the rules live in pure functions
 * and are tested here; the button itself is exercised in a browser by
 * e2e/resume-editor-bullets.spec.ts.
 */
import { describe, expect, it } from "vitest";
import {
  bulletsPatch,
  canTurnOffBullets,
  experienceBulletParagraphs,
} from "@/lib/resume-builder/achievements-editor";

describe("experienceBulletParagraphs", () => {
  it("seeds from bullets, one paragraph each", () => {
    expect(experienceBulletParagraphs({ title: "", company: "", bullets: ["A", "B"] })).toEqual(["A", "B"]);
  });
  it("falls back to a single paragraph holding the description", () => {
    expect(experienceBulletParagraphs({ title: "", company: "", description: "Prose." })).toEqual(["Prose."]);
  });
  it("an old-format entry opens exactly as stored: one achievement string with several bullets in it is ONE paragraph", () => {
    expect(experienceBulletParagraphs({ title: "", company: "", bullets: ["• A • B • C"] })).toEqual(["• A • B • C"]);
    expect(experienceBulletParagraphs({ title: "", company: "", description: "- A\n- B" })).toEqual(["- A\n- B"]);
  });
  it("is empty for a brand-new entry", () => {
    expect(experienceBulletParagraphs({ title: "", company: "" })).toEqual([]);
  });
});

describe("bulletsPatch", () => {
  it.each([
    ["no paragraphs", [], false, { description: "", bullets: undefined }],
    ["only blank paragraphs", ["", "  "], false, { description: "", bullets: undefined }],
    ["one paragraph, not bulleted: prose, as before", ["Led the migration."], false, { description: "Led the migration.", bullets: undefined }],
    ["two paragraphs are always a list", ["A", "B"], false, { description: "A B", bullets: ["A", "B"] }],
    ["blank paragraphs between are dropped", ["A", "", "B"], false, { description: "A B", bullets: ["A", "B"] }],
    ["one paragraph, bulleted: a one-item list", ["Led the migration."], true, { description: "Led the migration.", bullets: ["Led the migration."] }],
    ["bulleted but nothing typed yet: nothing to store", [""], true, { description: "", bullets: undefined }],
    ["paragraphs are trimmed", ["  A  ", "B "], true, { description: "A B", bullets: ["A", "B"] }],
  ])("%s", (_label, paragraphs, bulleted, expected) => {
    expect(bulletsPatch(paragraphs, bulleted)).toEqual(expected);
  });
});

describe("canTurnOffBullets", () => {
  it("is true for zero or one achievement: it can go back to a prose line", () => {
    expect(canTurnOffBullets([])).toBe(true);
    expect(canTurnOffBullets(["A"])).toBe(true);
    expect(canTurnOffBullets(["A", ""])).toBe(true);
  });
  it("is false for two or more: each paragraph is its own bullet, so there is no prose form to go back to", () => {
    expect(canTurnOffBullets(["A", "B"])).toBe(false);
    expect(canTurnOffBullets(["A", "", "B"])).toBe(false);
  });
});
