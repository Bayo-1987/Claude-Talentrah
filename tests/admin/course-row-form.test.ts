/**
 * Admin > Courses row form (QA, 9 Oct): COURSE-MSG-1 and COURSE-KEEP-1.
 *
 * COURSE-MSG-1: the form kept two action states and showed the toggle's (Make live / Take out) ahead of the save's, and neither was ever cleared, so after one toggle every later Save result
 * ("Saved." or a refusal) was hidden behind the toggle's old message. Now both forms feed ONE state, so the banner is always the latest result.
 * COURSE-KEEP-1: a refused Save snapped every field back to the saved values; the action now returns the five typed fields with each error (src/lib/forms/keep-input.ts) and the form uses them as defaults.
 * Browser proof: QA's e2e/admin-courses-form-rule.spec.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCourseRowAction } from "@/lib/admin/catalog/row-action";
import type { ModerationState } from "@/lib/admin/moderation/state";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\s+/g, " ");
const count = (s: string, needle: string) => s.split(needle).length - 1;

const ID = "course-1";
const saveForm = () => {
  const f = new FormData();
  f.set("id", ID);
  return f;
};
const toggleForm = () => {
  const f = saveForm();
  f.set("decision", "deactivate");
  return f;
};
const idle: ModerationState = { status: "idle" };
const typed = { title: "T", provider: "P", skill_tag: "s", price_tier: "low", affiliate_url: "ftp://x" };

const actions = (save: ModerationState, toggle: ModerationState) => ({ save: async () => save, toggle: async () => toggle });

describe("runCourseRowAction: the banner is the latest result (COURSE-MSG-1)", () => {
  it("a toggle then a refused Save: the Save's refusal is what is left", async () => {
    const afterToggle = await runCourseRowAction(idle, toggleForm(), actions({ status: "idle" }, { status: "success", message: "“X” is no longer offered.", targetId: ID }));
    expect(afterToggle.message).toBe("“X” is no longer offered.");
    const refusal: ModerationState = { status: "error", message: "The link must start with http:// or https://.", targetId: ID, values: typed };
    const afterSave = await runCourseRowAction(afterToggle, saveForm(), actions(refusal, { status: "idle" }));
    expect(afterSave.message).toBe("The link must start with http:// or https://.");
    expect(afterSave.status).toBe("error");
  });
  it("a toggle then a successful Save: 'Saved.' is what is left, not the toggle's old message", async () => {
    const afterToggle: ModerationState = { status: "success", message: "“X” is no longer offered.", targetId: ID };
    const afterSave = await runCourseRowAction(afterToggle, saveForm(), actions({ status: "success", message: "Saved.", targetId: ID }, { status: "idle" }));
    expect(afterSave.message).toBe("Saved.");
  });
  it("a Save then a toggle: the toggle's message replaces the Save's", async () => {
    const afterSave: ModerationState = { status: "success", message: "Saved.", targetId: ID };
    const afterToggle = await runCourseRowAction(afterSave, toggleForm(), actions({ status: "idle" }, { status: "success", message: "“X” is live.", targetId: ID }));
    expect(afterToggle.message).toBe("“X” is live.");
  });
  it("the form with a decision field runs the toggle only, and the form without one runs the save only", async () => {
    const calls: string[] = [];
    const spy = {
      save: async () => (calls.push("save"), idle),
      toggle: async () => (calls.push("toggle"), idle),
    };
    await runCourseRowAction(idle, toggleForm(), spy);
    await runCourseRowAction(idle, saveForm(), spy);
    expect(calls).toEqual(["toggle", "save"]);
  });
});

describe("runCourseRowAction: a toggle does not throw away what a refused Save kept (COURSE-KEEP-1)", () => {
  it("the typed values from a refused Save survive a toggle that returns none", async () => {
    const refused: ModerationState = { status: "error", message: "The link must start with http:// or https://.", targetId: ID, values: typed };
    const afterToggle = await runCourseRowAction(refused, toggleForm(), actions(idle, { status: "success", message: "done", targetId: ID }));
    expect(afterToggle.values).toEqual(typed);
  });
  it("a successful Save returns none, so the fields fall back to the saved values", async () => {
    const afterSave = await runCourseRowAction({ status: "error", message: "x", targetId: ID, values: typed }, saveForm(), actions({ status: "success", message: "Saved.", targetId: ID }, idle));
    expect(afterSave.values).toBeUndefined();
  });
});

describe("wiring", () => {
  const actionsSrc = read("src/lib/admin/catalog/actions.ts");
  const form = read("src/components/admin/course-row-form.tsx");
  it("every error return of the edit action hands the five typed fields back; its success hands none", () => {
    const edit = actionsSrc.slice(actionsSrc.indexOf("export async function updateCourseAction"));
    expect(edit).toContain('const typed = submittedValues(formData, ["title", "provider", "skill_tag", "price_tier", "affiliate_url"]);');
    expect(count(edit, "values: typed")).toBe(7);
    expect(edit.slice(edit.indexOf('message: "Saved."'))).not.toContain("values:");
    expect(read("src/lib/admin/moderation/state.ts")).toContain("values?: SubmittedValues");
  });
  it("the text fields default to the returned values and the price tier <select> takes its key and default from tierSelect", () => {
    for (const f of ["title", "provider", "skill_tag", "affiliate_url"]) expect(form, f).toContain(`inputValue(state.values, "${f}"`);
    // The tier select's key and default come from tierSelect (COURSE-TIER-1; tests/admin/course-tier-select.test.ts).
    expect(form).toContain("tierSelect(course.priceTier, state.values)");
  });
  it("both forms feed one action state, so there is one banner: no second state to pick between", () => {
    expect(count(form, "useActionState(")).toBe(1);
    expect(form).toContain("runCourseRowAction");
    expect(form).not.toContain("toggleState");
  });
});
