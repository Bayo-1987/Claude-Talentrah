/**
 * Where the shared "an error keeps what was typed" helper (src/lib/forms/keep-input.ts) is wired in. Each form listed here returns the submitted values with every error and uses them
 * as its fields' defaults; the browser proof for each is a QA red spec (e2e/admin-blog-form-rule.spec.ts, e2e/admin-operators-invite-form-rule.spec.ts). Add a form to this table when it is
 * converted. A form NOT in the table is not yet converted (the rollout list is in the backlog), which is why this is a list and not a scan.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\s+/g, " ");
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("blog post form (create and update)", () => {
  const actions = read("src/lib/admin/blog/actions.ts");
  const form = read("src/components/admin/blog-post-form.tsx");
  it("all four error returns after a parse hand the values back (create: validation, duplicate slug; update: validation, update error)", () => {
    expect(count(actions, "values: submittedValues(formData, BLOG_FIELDS)")).toBe(4);
    expect(actions).toContain('const BLOG_FIELDS = ["title", "slug", "description", "author", "body"]');
  });
  it("the form takes each field's default from the action's state through inputValue; the author keeps its default for a new post", () => {
    expect(form).toContain('inputValue(state.values, field, post?.[field], fallback)');
    for (const f of ["title", "slug", "description", "body"]) expect(form, f).toContain(`defaultValue={keep("${f}")}`);
    expect(form).toContain('defaultValue={keep("author", "The Talentrah Team")}');
  });
});

describe("invite-operator form", () => {
  const invite = read("src/lib/admin/operators/invite.ts");
  const form = read("src/components/admin/invite-operator-form.tsx");
  it("every invite error hands the typed email, display name and role back; a sent invitation hands none", () => {
    expect(invite).toContain('const typed = submittedValues(formData, ["email", "displayName", "roleId"]);');
    expect(count(invite, "values: typed")).toBe(5);
    const success = invite.slice(invite.indexOf('status: "success"'));
    expect(success).not.toContain("values:");
  });
  it("the three fields default to the returned values (the role select included)", () => {
    for (const f of ["email", "displayName", "roleId"]) expect(form, f).toContain(`inputValue(state.values, "${f}")`);
  });
  it("the role <select> is keyed by the returned value (a select does not pick up a changed defaultValue on its own)", () => {
    expect(form).toContain('key={selectKey(state.values, "roleId")}');
  });
  it("there is still no password field on the form", () => {
    expect(form).not.toMatch(/type="password"|name="password"/);
  });
});

describe("contact form", () => {
  const actions = read("src/lib/contact/actions.ts");
  const form = read("src/app/contact/contact-form.tsx");
  it("every error return (validation, rate limit, mailer not wired, send failed) hands the typed values back; the honeypot and the success hand none", () => {
    expect(actions).toContain('const typed = submittedValues(formData, ["name", "email", "topic", "message"]);');
    expect(count(actions, "values: typed")).toBe(4);
    expect(read("src/lib/contact/schemas.ts")).toContain("values?: SubmittedValues");
  });
  it("name, email, message default to the returned values; the Topic <select> is keyed by it", () => {
    for (const f of ["name", "email", "topic", "message"]) expect(form, f).toContain(`inputValue(state.values, "${f}")`);
    expect(form).toContain('key={selectKey(state.values, "topic")}');
  });
});

describe("feedback form", () => {
  const actions = read("src/lib/feedback/actions.ts");
  const form = read("src/app/(app)/feedback/feedback-form.tsx");
  it("every error return (validation, expired session, insert failure) hands the category and the message back", () => {
    expect(actions).toContain('const typed = submittedValues(formData, ["category", "message"]);');
    expect(count(actions, "values: typed")).toBe(3);
    expect(read("src/lib/feedback/state.ts")).toContain("values?: SubmittedValues");
  });
  it("the message defaults to the returned value; the category <select> is keyed by it", () => {
    expect(form).toContain('inputValue(state.values, "message")');
    expect(form).toContain('inputValue(state.values, "category")');
    expect(form).toContain('key={selectKey(state.values, "category")}');
  });
});

describe("admin New listing form (scholarships)", () => {
  const actions = read("src/lib/scholarships/admin-actions.ts");
  const form = read("src/app/admin/(protected)/scholarships/new/admin-scholarship-form.tsx");
  const FIELDS = ["provider", "programName", "hostInstitution", "degreeLevels", "fundingType", "fundingCovers", "fieldTags", "eligibilityNationalities", "eligibilityPriorDegree", "eligibilityAge", "eligibilityOther", "applicationDeadline", "cycleYear", "deadlineNote", "officialUrl", "sourceName", "reviewNote"];
  it("all four create errors (validation, deadline note refused at save, note rule from the database, other save failure) hand the typed values back; a success hands none", () => {
    expect(actions).toContain('{ multi: ["degreeLevels"] }');
    for (const f of FIELDS) expect(actions, f).toContain(`"${f}"`);
    expect(count(actions, "values: typed")).toBe(4);
    expect(read("src/lib/scholarships/admin-state.ts")).toContain("values?: SubmittedValues");
  });
  it("every text field, the reviewer note and the rich editor default to the returned values; the Funding select is keyed; the degree checkboxes are ticked from the list", () => {
    for (const f of ["provider", "programName", "hostInstitution", "fundingCovers", "fieldTags", "eligibilityNationalities", "eligibilityPriorDegree", "eligibilityAge", "applicationDeadline", "cycleYear", "deadlineNote", "officialUrl", "sourceName", "reviewNote", "eligibilityOther"]) {
      expect(form, f).toContain(`inputValue(state.values, "${f}")`);
    }
    expect(form).toContain('key={selectKey(state.values, "fundingType")}');
    expect(form).toContain('defaultChecked={inputList(state.values, "degreeLevels").includes(value)}');
  });
  it("the Deadline note counter follows the returned note instead of dropping to 0", () => {
    expect(form).toContain('setNoteLength((state.values?.deadlineNote ?? "").trim().length)');
    expect(form).not.toContain("setNoteLength(0)");
  });
});

describe("settings form (profile)", () => {
  const actions = read("src/lib/profile/settings-actions.ts");
  const form = read("src/app/(app)/settings/settings-form.tsx");
  it("every save error (validation, expired session, refused write, no row) hands the typed name and country back; a success hands none", () => {
    expect(actions).toContain('const typed = submittedValues(formData, ["firstName", "lastName", "country"]);');
    expect(count(actions, "values: typed")).toBe(4);
    expect(read("src/lib/profile/settings-state.ts")).toContain("values?: SubmittedValues");
    expect(actions.slice(actions.indexOf('status: "success"'))).not.toContain("values:");
  });
  it("the names default to the returned values over the saved profile; the Country <select> is keyed by the returned value", () => {
    expect(form).toContain('inputValue(state.values, "firstName", firstName)');
    expect(form).toContain('inputValue(state.values, "lastName", lastName)');
    expect(form).toContain('inputValue(state.values, "country", country ?? "")');
    expect(form).toContain('key={selectKey(state.values, "country")}');
  });
});

describe("company profile form (employer)", () => {
  const actions = read("src/lib/employer/actions.ts");
  const form = read("src/components/employer/company-profile-form.tsx");
  it("both error returns (name required, save failed) hand the typed values back; the saved state hands none", () => {
    expect(actions).toContain('const typed = submittedValues(form, ["name", "domain", "description", "logoUrl"]);');
    expect(actions).toContain('{ error: "Company name is required.", values: typed }');
    expect(actions).toContain("{ error: `Couldn't save your profile: ${error.message}`, values: typed }");
    expect(actions).toContain("{ error: string; values?: SubmittedValues }");
  });
  it("the four fields default to the returned values, falling back to the saved profile", () => {
    for (const f of ["name", "domain", "description", "logoUrl"]) {
      expect(form, f).toContain(`inputValue(values, "${f}", initial.${f})`);
    }
  });
});
