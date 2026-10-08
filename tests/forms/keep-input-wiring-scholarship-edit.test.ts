/**
 * Where the shared "an error keeps what was typed" helper (src/lib/forms/keep-input.ts) is wired into the admin Edit listing form. Kept in its own file (the main table,
 * keep-input-wiring.test.ts, is edited by several branches at once and conflicts on every merge).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\s+/g, " ");
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("admin Edit listing form (scholarships)", () => {
  const actions = read("src/lib/scholarships/admin-edit-action.ts");
  const form = read("src/app/admin/(protected)/scholarships/[id]/edit/edit-scholarship-form.tsx");
  const FIELDS = ["provider", "programName", "hostInstitution", "degreeLevels", "fundingType", "fundingCovers", "fieldTags", "eligibilityNationalities", "eligibilityPriorDegree", "eligibilityAge", "eligibilityOther", "applicationDeadline", "cycleYear", "deadlineNote", "officialUrl", "sourceName", "reviewNote"];
  it("all eight error returns (validation, read failure, missing listing, not editable, refused at save, note rule from the database, other write failure, stale status) hand the typed values back; a save redirects and hands none", () => {
    expect(actions).toContain('{ multi: ["degreeLevels"] }');
    for (const f of FIELDS) expect(actions, f).toContain(`"${f}"`);
    expect(count(actions, "values: typed")).toBe(8);
    expect(read("src/lib/scholarships/admin-edit-state.ts")).toContain("values?: SubmittedValues");
  });
  it("every field defaults to the returned value, falling back to the stored one; the Funding select is keyed; the degree checkboxes are ticked from the list", () => {
    for (const f of FIELDS.filter((x) => x !== "degreeLevels" && x !== "fundingType")) {
      expect(form, f).toContain(`inputValue(state.values, "${f}", initial.${f})`);
    }
    expect(form).toContain('key={selectKey(state.values, "fundingType")}');
    expect(form).toContain('inputValue(state.values, "fundingType", initial.fundingType)');
    expect(form).toContain('defaultChecked={(state.values ? inputList(state.values, "degreeLevels") : initial.degreeLevels).includes(value)}');
  });
  it("the form submits through the form action again (no private submit handler) and the Deadline note counter follows the returned note", () => {
    expect(form).toContain("<form action={formAction}");
    expect(form).not.toContain("onSubmit");
    expect(form).toContain("(state.values?.deadlineNote ?? initial.deadlineNote).trim().length");
  });
});
