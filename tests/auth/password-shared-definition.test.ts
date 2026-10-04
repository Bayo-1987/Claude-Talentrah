/**
 * ONE definition of the password rule (S1-45 / S1-58).
 *
 * The rule a person is shown (the checklist), the rule the server action enforces (the zod check on signup and reset), and the sentences
 * that explain a refusal from Supabase all read the same list, src/lib/auth/password-rules.ts. So changing a rule there changes all of
 * them, and nothing else in the app may carry its own copy of the wording. Two checks hold that:
 *   1. behavioural: replace the list (a stricter length, a renamed rule, a new rule) and every consumer follows;
 *   2. structural: no user-facing string outside the list names a rule, so a consumer that bypasses the list fails here.
 * No database, no network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthWeakPasswordError } from "@supabase/supabase-js";
import { fakeSecret } from "../support/fake-secret";

const ROOT = path.join(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

afterEach(() => {
  vi.doUnmock("@/lib/auth/password-rules");
  vi.resetModules();
});

/** A replacement list: a stricter length, a renamed uppercase rule, and a rule the app does not have today (a symbol). */
function changedRules() {
  const MIN = 12;
  return {
    PASSWORD_MIN_LENGTH: MIN,
    PASSWORD_RULES: [
      { key: "length", label: `At least ${MIN} characters`, test: (p: string) => p.length >= MIN },
      { key: "upper", label: "A capital letter", test: (p: string) => /[A-Z]/.test(p) },
      { key: "lower", label: "One lowercase letter", test: (p: string) => /[a-z]/.test(p) },
      { key: "number", label: "One number", test: (p: string) => /[0-9]/.test(p) },
      { key: "symbol", label: "One symbol", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
    ],
  };
}

describe("replace the list and every consumer follows", () => {
  it("the checklist shows the new rules, the new wording and the new count", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth/password-rules", changedRules);
    const { PasswordRequirements } = await import("@/components/auth/password-requirements");
    const markup = renderToStaticMarkup(createElement(PasswordRequirements, { password: "" }));
    expect(markup).toContain("At least 12 characters");
    expect(markup).toContain("A capital letter");
    expect(markup).toContain("One symbol");
    expect(markup).not.toContain("One uppercase letter");
    expect((markup.match(/<li\b/g) ?? []).length).toBe(5);
  });

  it("the server action's check enforces the new rules and says what is missing in the new wording", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth/password-rules", changedRules);
    const { resetPasswordSchema, signUpSchema } = await import("@/lib/auth/schemas");
    // 8 characters with every OLD class and no symbol: fine before, refused now (too short, and no symbol).
    const old = fakeSecret("password").replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
    const reset = resetPasswordSchema.safeParse({ password: old });
    expect(reset.success).toBe(false);
    const msg = reset.error!.issues[0].message;
    expect(msg).toBe("Your password needs at least 12 characters and one symbol.");
    const signup = signUpSchema.safeParse({ firstName: "Ada", lastName: "Obi", email: "ada@talentrah.test", country: "Nigeria", password: old, termsAccepted: "on" });
    expect(signup.success).toBe(false);
    expect(signup.error!.issues.find((i) => i.path[0] === "password")!.message).toBe(msg);
    // A value that meets the new list passes.
    expect(resetPasswordSchema.safeParse({ password: `${fakeSecret("password")}!` }).success).toBe(true);
  });

  it("an explanation of a Supabase refusal quotes the new wording, and a bare 'weak password' lists every current rule", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth/password-rules", changedRules);
    const { passwordErrorMessage } = await import("@/lib/auth/password-errors");
    const weak = (reasons: ("length" | "characters" | "pwned")[], message: string) => new AuthWeakPasswordError(message, 422, reasons);
    // the server names no number: the app's own (now 12) is the fallback
    expect(passwordErrorMessage(weak(["length"], "Password is too short."))).toBe("Your password needs at least 12 characters.");
    // the server names the classes it requires (its alphabets); the app's own wording for those classes is used
    expect(passwordErrorMessage(weak(["characters"], "Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789.")))
      .toBe("Your password needs a capital letter, one lowercase letter and one number.");
    const unknown = passwordErrorMessage(weak([], "Weak password"))!;
    for (const need of ["at least 12 characters", "a capital letter", "one lowercase letter", "one number", "one symbol"]) expect(unknown).toContain(need);
  });
});

describe("nothing outside the list carries its own wording of a rule", () => {
  // Every place that talks to a person about the password rule, other than the list itself.
  const FILES = [
    "src/lib/auth/password-errors.ts",
    "src/lib/auth/schemas.ts",
    "src/lib/auth/actions.ts",
    "src/components/auth/password-requirements.tsx",
    "src/components/auth/signup-form.tsx",
    "src/components/auth/reset-password-form.tsx",
    "src/components/ui/password-field.tsx",
  ];
  // A quoted string or template literal that names a rule in words.
  const RULE_WORDS = /["'`][^"'`\n]*(uppercase|lowercase|upper case|lower case|upper and lower|capital|digit|a number|one number|\d+ characters|one symbol)[^"'`\n]*["'`]/i;

  it("scans the files it should (the check itself is not empty)", () => {
    for (const f of FILES) expect(read(f).length, f).toBeGreaterThan(200);
  });

  it.each(FILES)("%s has no user-facing string naming a password rule", (file) => {
    const offenders: string[] = [];
    read(file).split("\n").forEach((line, i) => {
      const code = line.replace(/^\s*(\*|\/\/).*$/, "").replace(/\/\*.*?\*\//g, "");
      const m = RULE_WORDS.exec(code);
      if (m) offenders.push(`${file}:${i + 1}: ${m[0]}`);
    });
    expect(offenders, "take the wording from src/lib/auth/password-rules.ts instead").toEqual([]);
  });

  it("only password-rules.ts and password.ts define rule words (a new consumer shows up here)", () => {
    const hits = readdirSync(path.join(ROOT, "src/lib/auth")).filter((n) => n.endsWith(".ts")).filter((n) => /uppercase letter|lowercase letter/i.test(read(`src/lib/auth/${n}`)));
    expect(hits.sort()).toEqual(["password-rules.ts"].sort());
  });
});

describe("the declared dashboard policy is built from the list, not typed beside it", () => {
  it("minimum length and required classes come from the rules", async () => {
    vi.resetModules();
    const { SUPABASE_PASSWORD_POLICY, PASSWORD_MIN_LENGTH } = await import("@/lib/auth/password");
    const { PASSWORD_RULES } = await import("@/lib/auth/password-rules");
    expect(SUPABASE_PASSWORD_POLICY.minimumLength).toBe(PASSWORD_MIN_LENGTH);
    const classKeys = PASSWORD_RULES.map((r) => r.key).filter((k) => k !== "length").sort();
    expect(SUPABASE_PASSWORD_POLICY.requirements).toBe(classKeys.join(",") === "lower,number,upper" ? "lower_upper_letters_digits" : "UNMAPPED");
  });

  it("changing the list changes the declared policy (so the dashboard guard would fail until the dashboard is updated)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth/password-rules", changedRules);
    const { SUPABASE_PASSWORD_POLICY } = await import("@/lib/auth/password");
    expect(SUPABASE_PASSWORD_POLICY.minimumLength).toBe(12);
    // a symbol rule is a class the declared requirements do not cover: the policy says so rather than pretending the dashboard value is unchanged
    expect(SUPABASE_PASSWORD_POLICY.requirements).toBe("lower_upper_letters_digits_symbols");
  });
});
