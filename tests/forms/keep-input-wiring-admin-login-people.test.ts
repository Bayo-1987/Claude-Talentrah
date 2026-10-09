/** Admin sign-in (the email only, never the password) and the People lookup (the typed term) keep what was typed after an error / a lookup. Wiring assertions in their own file. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(path.join(__dirname, "../..", rel), "utf8").replace(/\s+/g, " ");
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("admin sign-in form", () => {
  const actions = read("src/lib/admin/actions.ts");
  const form = read("src/components/admin/admin-login-form.tsx");
  it("hands back the typed EMAIL only, on all six error returns; the password is never a field of the returned values", () => {
    expect(actions).toContain('const typed = submittedValues(formData, ["email"]);');
    expect(count(actions, "values: typed")).toBe(6);
    expect(actions).not.toMatch(/submittedValues\(formData, \[[^\]]*password/i);
  });
  it("the email defaults to the returned value and the password field has no default", () => {
    expect(form).toContain('defaultValue={inputValue(state.values, "email")}');
    expect(form).toMatch(/<PasswordField key=\{resetKey\} id="admin-password" label="Password" name="password" autoComplete="current-password" required \/>/);
  });
});

describe("People lookup", () => {
  const actions = read("src/lib/admin/finance/actions.ts");
  const form = read("src/components/admin/person-lookup.tsx");
  it("hands the typed term back with a found, not-found and error outcome", () => {
    expect(actions).toContain('const typed = submittedValues(formData, ["term"]);');
    expect(count(actions, "values: typed")).toBe(3);
  });
  it("the search box defaults to the returned term", () => {
    expect(form).toContain('defaultValue={inputValue(state.values, "term")}');
  });
});
