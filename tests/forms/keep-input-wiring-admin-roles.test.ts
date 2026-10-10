/**
 * Admin > Operators > Roles: the role editor and an operator's role select keep what was typed after a refused save (src/lib/forms/keep-input.ts), and creating a role sends an explicit
 * null for p_role_id. Browser proof: e2e/admin-role-editor-form-rule.spec.ts and e2e/admin-operator-row-form-rule.spec.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\s+/g, " ");
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("role editor (create, rename, permissions)", () => {
  const actions = read("src/lib/admin/operators/role-actions.ts");
  const form = read("src/components/admin/role-editor.tsx");
  it("creating a role sends p_role_id as null: an undefined argument is dropped from the request and admin_upsert_role (0075) has no default for it (PGRST202)", () => {
    expect(actions).toContain("p_role_id: (roleId || null) as unknown as string");
    expect(actions).not.toContain("undefined as unknown as string");
  });
  it("every error return of saveRoleAction (no name, database error, refusal) hands the typed name and ticked permissions back; the success hands none", () => {
    expect(actions).toContain('const typed = submittedValues(formData, ["name", "permissions"], { multi: ["permissions"] });');
    const save = actions.slice(actions.indexOf("export async function saveRoleAction"), actions.indexOf("export async function deleteRoleAction"));
    expect(count(save, "values: typed")).toBe(3);
    const success = save.slice(save.indexOf('status: "success"'));
    expect(success).not.toContain("values:");
  });
  it("the name defaults to the returned value and the permission ticks to the returned list, falling back to the saved role", () => {
    expect(form).toContain('inputValue(saveState.values, "name", role?.name)');
    expect(form).toContain('inputList(saveState.values, "permissions")');
    expect(form).toContain("keptPermissions ? keptPermissions.includes(p.key) : (role?.permissions.includes(p.key) ?? false)");
  });
});

describe("operator row (role select)", () => {
  const actions = read("src/lib/admin/operators/actions.ts");
  const form = read("src/components/admin/operator-row-form.tsx");
  it("a refused role change hands the picked role back; a success hands none", () => {
    expect(actions).toContain('result.status === "error" ? { ...result, values: submittedValues(formData, ["roleId"]) } : result');
  });
  it("the select is keyed by the returned value (a select does not pick up a changed defaultValue on its own) and defaults to it", () => {
    // SELECT-REMOUNT-2: key and default come from the saved role AND the typed one.
    expect(form).toContain('const roleSelect = savedSelect("roleId", roleId, roleState.values);');
    expect(form).toContain("key={roleSelect.key}");
    expect(form).toContain("defaultValue={roleSelect.defaultValue}");
  });
});
