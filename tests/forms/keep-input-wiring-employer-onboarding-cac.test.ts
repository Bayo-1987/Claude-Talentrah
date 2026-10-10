/**
 * Employer onboarding ("Create company") and "Verify by CAC": an error keeps what was typed (QA ONBOARD-KEEP-1, CAC-KEEP-1; browser proofs e2e employer-onboarding-form-rule and employer-cac-form-rule).
 * The onboarding form's domain field is controlled by its own state and always survived; the company name and description are uncontrolled and React 19's post-action reset emptied them. The CAC form
 * put the SAVED values back as defaults, so a refused resubmit replaced what had just been typed.
 * Where the scan can only show the wiring, tests/employer/onboarding-cac-keep-input.test.ts runs the actions and checks which errors hand the values back.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\s+/g, " ");

describe("employer onboarding form", () => {
  const actions = read("src/lib/employer/actions.ts");
  const form = read("src/components/employer/org-onboarding-form.tsx");
  it("the action reads the three fields once and hands them back with its errors", () => {
    expect(actions).toContain('const typed = submittedValues(form, ["name", "domain", "description"]);');
    expect(actions).toContain('{ error: "Company name is required.", values: typed }');
  });
  it("the company name and the description default to the returned values", () => {
    expect(form).toContain('defaultValue={inputValue(createValues, "name")}');
    expect(form).toContain('defaultValue={inputValue(createValues, "description")}');
  });
  it("the domain field stays controlled by its state, which survives the reset on its own", () => {
    expect(form).toContain("value={domain}");
    expect(form).toContain("onChange={(e) => setDomain(e.target.value)}");
  });
});

describe("CAC verification form", () => {
  const actions = read("src/lib/employer/actions.ts");
  const form = read("src/components/employer/cac-verification-form.tsx");
  it("the action hands the typed RC number and business name back with both errors", () => {
    expect(actions).toContain('const typed = submittedValues(form, ["cacNumber", "cacBusinessName"]);');
    expect(actions).toContain('{ error: "Both the RC number and the registered business name are required.", values: typed }');
    expect(actions).toContain("{ error: `Couldn't submit for verification: ${error.message}`, values: typed }");
  });
  it("both fields default to the returned values, falling back to the saved submission", () => {
    expect(form).toContain('defaultValue={inputValue(values, "cacBusinessName", initial.cacBusinessName)}');
    expect(form).toContain('defaultValue={inputValue(values, "cacNumber", initial.cacNumber)}');
  });
});
