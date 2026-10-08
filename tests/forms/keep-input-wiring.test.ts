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
  it("there is still no password field on the form", () => {
    expect(form).not.toMatch(/type="password"|name="password"/);
  });
});
