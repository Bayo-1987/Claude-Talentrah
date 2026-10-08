/**
 * When Supabase refuses a password (S1-45): signup and the reset form say exactly why, in plain words.
 *
 * Production Supabase auth now enforces the app's own rule (minimum length 8; lowercase, uppercase and digits required) and leaked-
 * password protection (HaveIBeenPwned). So a signup or a password change can be refused by Supabase as `weak_password` even when
 * the app's own check passed (a leaked password is the usual case). Before this change both actions returned `error.message`
 * verbatim: whatever Supabase's English happened to be, or, for a case we did not anticipate, something raw. This pins:
 *   1. a pwned password gets one fixed sentence;
 *   2. a length or character-class refusal names the requirements, built from the app's own list so the two cannot drift;
 *   3. an unknown reason still gets a specific sentence, never a generic error and never a raw code;
 *   4. the same in signUpAction and updatePasswordAction (the only path that sets a password: there is no separate change-password form);
 *   5. the client rule (getPasswordRequirements) equals Supabase's server rule, which is pinned here as an independent function.
 * No database: the Supabase client, rate limit and analytics are mocked, and the errors are real AuthWeakPasswordError instances.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthWeakPasswordError, AuthApiError } from "@supabase/supabase-js";
import { getPasswordRequirements, isPasswordValid } from "@/lib/auth/password";
import { resetPasswordSchema, signUpSchema } from "@/lib/auth/schemas";
import { LEAKED_MESSAGE, RATE_LIMITED_MESSAGE, REUSED_MESSAGE, passwordErrorMessage } from "@/lib/auth/password-errors";
import { PASSWORD_MIN_LENGTH, SUPABASE_PASSWORD_POLICY } from "@/lib/auth/password";
import { fakeSecret } from "../support/fake-secret";
import { readFileSync } from "node:fs";
import path from "node:path";

const supabase = vi.hoisted(() => ({
  signUp: vi.fn(),
  updateUser: vi.fn(),
  getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: supabase }) }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/auth/signup-rate-limit", () => ({ consumeSignupRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/security/request-ip", () => ({ getRequestIp: async () => "192.0.2.1" }));
vi.mock("@/lib/analytics/posthog", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/analytics/posthog")>()), captureEvent: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }),
}));

const { signUpAction, updatePasswordAction } = await import("@/lib/auth/actions");

const weak = (reasons: ("length" | "characters" | "pwned")[], message = "Password is known to be weak and easy to guess, please choose a different one.") =>
  new AuthWeakPasswordError(message, 422, reasons);

describe("passwordErrorMessage", () => {
  it("a leaked password gets the fixed breach sentence", () => {
    expect(LEAKED_MESSAGE).toBe("This password has appeared in a data breach. Please choose a different one.");
    expect(passwordErrorMessage(weak(["pwned"]))).toBe(LEAKED_MESSAGE);
  });

  it("pwned wins when it is one of several reasons", () => {
    expect(passwordErrorMessage(weak(["length", "pwned"]))).toBe(LEAKED_MESSAGE);
  });

  it("recognises a leaked password from the message when a gateway drops the reasons", () => {
    const err = new AuthApiError("Password is known to be weak and easy to guess, please choose a different one.", 422, "weak_password");
    expect(passwordErrorMessage(err)).toBe(LEAKED_MESSAGE);
  });

  it("too short names the length rule", () => {
    expect(passwordErrorMessage(weak(["length"], "Password should be at least 8 characters."))).toBe("Your password needs at least 8 characters.");
  });

  it("missing character classes name all three", () => {
    expect(passwordErrorMessage(weak(["characters"], "Password should contain at least one character of each."))).toBe(
      "Your password needs one uppercase letter, one lowercase letter and one number.",
    );
  });

  it("both together name every requirement, in the app's own words", () => {
    expect(passwordErrorMessage(weak(["length", "characters"]))).toBe(
      "Your password needs at least 8 characters, one uppercase letter, one lowercase letter and one number.",
    );
  });

  it("a weak_password with no recognised reason is still specific, never generic and never a raw code", () => {
    for (const err of [weak([], "Weak password"), new AuthApiError("Weak password", 422, "weak_password")]) {
      const text = passwordErrorMessage(err)!;
      expect(text).toBe("That password is too easy to guess. Choose one with at least 8 characters, one uppercase letter, one lowercase letter and one number.");
    }
  });

  it("never shows a raw error code or class name, in any case", () => {
    const all = [weak(["pwned"]), weak(["length"]), weak(["characters"]), weak(["length", "characters", "pwned"]), weak([], "Weak password")];
    for (const err of all) expect(passwordErrorMessage(err)).not.toMatch(/weak_password|AuthWeakPasswordError|reasons|422|_/);
  });

  it("an error that is not about password strength is not claimed (the caller keeps its own handling)", () => {
    expect(passwordErrorMessage(new AuthApiError("Signups not allowed for this instance", 422, "signup_disabled"))).toBeNull();
    expect(passwordErrorMessage(null)).toBeNull();
    expect(passwordErrorMessage({ message: "boom" })).toBeNull();
  });
});

describe("signUpAction shows the specific message", () => {
  beforeEach(() => supabase.signUp.mockReset());
  const form = (candidate = fakeSecret("password")) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ firstName: "Ada", lastName: "Obi", email: "ada@talentrah.test", country: "Nigeria", password: candidate, termsAccepted: "on" })) fd.set(k, v);
    return fd;
  };

  it("a leaked password: the breach sentence, on the banner and on the password field", async () => {
    supabase.signUp.mockResolvedValue({ data: { user: null, session: null }, error: weak(["pwned"]) });
    const r = await signUpAction({ error: null }, form());
    expect(r.error).toBe(LEAKED_MESSAGE);
    expect(r.fieldErrors?.password).toEqual([LEAKED_MESSAGE]);
  });

  it("a too-short password that got past the app's check (a rule drift) is named, not shown as Supabase's raw English", async () => {
    supabase.signUp.mockResolvedValue({ data: { user: null, session: null }, error: weak(["length"], "Password should be at least 8 characters.") });
    const r = await signUpAction({ error: null }, form());
    expect(r.error).toBe("Your password needs at least 8 characters.");
  });

  it("a rate-limited signup says to wait, in plain words", async () => {
    supabase.signUp.mockResolvedValue({ data: { user: null, session: null }, error: new AuthApiError("Email rate limit exceeded", 429, "over_email_send_rate_limit") });
    const r = await signUpAction({ error: null }, form());
    expect(r.error).toBe(RATE_LIMITED_MESSAGE);
    expect(r.fieldErrors).toBeUndefined();
  });

  it("any other Supabase error is passed through exactly as before", async () => {
    supabase.signUp.mockResolvedValue({ data: { user: null, session: null }, error: new AuthApiError("Signups not allowed for this instance", 422, "signup_disabled") });
    const r = await signUpAction({ error: null }, form());
    expect(r.error).toBe("Signups not allowed for this instance");
    expect(r.fieldErrors).toBeUndefined();
  });
});

describe("updatePasswordAction (reset and change) shows the specific message", () => {
  beforeEach(() => supabase.updateUser.mockReset());
  const form = () => {
    const fd = new FormData();
    fd.set("password", fakeSecret("password"));
    return fd;
  };

  it("a leaked password: the breach sentence, on the banner and on the field", async () => {
    supabase.updateUser.mockResolvedValue({ data: { user: null }, error: weak(["pwned"]) });
    const r = await updatePasswordAction({ error: null }, form());
    expect(r.error).toBe(LEAKED_MESSAGE);
    expect(r.fieldErrors?.password).toEqual([LEAKED_MESSAGE]);
  });

  it("a character-class refusal names the requirements", async () => {
    supabase.updateUser.mockResolvedValue({ data: { user: null }, error: weak(["characters"]) });
    const r = await updatePasswordAction({ error: null }, form());
    expect(r.error).toBe("Your password needs one uppercase letter, one lowercase letter and one number.");
  });

  it("the same password as before: a plain instruction, on the banner and the field", async () => {
    supabase.updateUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError("New password should be different from the old password.", 422, "same_password") });
    const r = await updatePasswordAction({ error: null }, form());
    expect(r.error).toBe(REUSED_MESSAGE);
    expect(r.fieldErrors?.password).toEqual([REUSED_MESSAGE]);
  });

  it("rate limited: wait and try again", async () => {
    supabase.updateUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit") });
    const r = await updatePasswordAction({ error: null }, form());
    expect(r.error).toBe(RATE_LIMITED_MESSAGE);
  });

  it("any other error is passed through exactly as before", async () => {
    supabase.updateUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError("Auth session missing!", 400, "session_not_found") });
    const r = await updatePasswordAction({ error: null }, form());
    expect(r.error).toBe("Auth session missing!");
  });
});

describe("the client rule equals the server rule", () => {
  /** Supabase's documented server rule as configured on production: min length 8 and each of lowercase, uppercase, digits (ASCII sets). */
  const supabaseRule = (p: string) => p.length >= 8 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p);

  it("pins the four requirements: their keys, their words and their order", () => {
    expect(getPasswordRequirements("").map((r) => [r.key, r.label])).toEqual([
      ["length", "At least 8 characters"],
      ["upper", "One uppercase letter"],
      ["lower", "One lowercase letter"],
      ["number", "One number"],
    ]);
  });

  it("pins each rule at its boundary", () => {
    const met = (p: string) => Object.fromEntries(getPasswordRequirements(p).map((r) => [r.key, r.met]));
    expect(met("Abcdef1")).toMatchObject({ length: false });
    expect(met("Abcdefg1")).toMatchObject({ length: true, upper: true, lower: true, number: true });
    expect(met("abcdefg1")).toMatchObject({ upper: false });
    expect(met("ABCDEFG1")).toMatchObject({ lower: false });
    expect(met("Abcdefgh")).toMatchObject({ number: false });
  });

  it("the app's check, both schemas and Supabase's rule agree on a spread of passwords (a change to one without the others fails here)", () => {
    const samples = ["", "short1A", "Abcdefg1", "abcdefg1", "ABCDEFG1", "Abcdefgh", "12345678", "password", "PASSWORD1", "Pässword1", "Ab1!Ab1!", "weakpassword", "A1a" + "x".repeat(40)];
    for (const p of samples) {
      const expected = supabaseRule(p);
      expect(isPasswordValid(p), p).toBe(expected);
      expect(resetPasswordSchema.safeParse({ password: p }).success, `reset: ${p}`).toBe(expected);
      const base = { firstName: "Ada", lastName: "Obi", email: "a@b.co", country: "Nigeria", termsAccepted: "on" };
      expect(signUpSchema.safeParse({ ...base, password: p }).success, `signup: ${p}`).toBe(expected);
    }
  });
});

describe("the minimum and the character classes come from the SERVER's own message, so the words are right before and after the dashboard changes", () => {
  it.each([6, 8, 10])("a server that asks for %i characters is quoted at %i", (n) => {
    expect(passwordErrorMessage(weak(["length"], `Password should be at least ${n} characters.`))).toBe(`Your password needs at least ${n} characters.`);
  });

  it("with no number in the message it falls back to the app's own rule", () => {
    expect(passwordErrorMessage(weak(["length"], "Password too short"))).toBe(`Your password needs at least ${PASSWORD_MIN_LENGTH} characters.`);
  });

  const LOWER = "abcdefghijklmnopqrstuvwxyz", UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", DIGITS = "0123456789", SYMBOLS = "!@#$%^&*()_+-=[]{};':\"|<>?,./`~";
  const named = (...sets: string[]) => `Password should contain at least one character of each: ${sets.join(", ")}.`;

  it("names exactly the classes the server named (today's three)", () => {
    expect(passwordErrorMessage(weak(["characters"], named(LOWER, UPPER, DIGITS)))).toBe("Your password needs one uppercase letter, one lowercase letter and one number.");
  });

  it("a stricter server (symbols too) is followed, not contradicted", () => {
    expect(passwordErrorMessage(weak(["characters"], named(LOWER, UPPER, DIGITS, SYMBOLS)))).toBe(
      "Your password needs one uppercase letter, one lowercase letter, one number and one symbol.",
    );
  });

  it("a looser server (letters and digits only) is followed too", () => {
    expect(passwordErrorMessage(weak(["characters"], named(LOWER, DIGITS)))).toBe("Your password needs one lowercase letter and one number.");
  });

  it("length and classes together", () => {
    expect(passwordErrorMessage(weak(["length", "characters"], `Password should be at least 8 characters. ${named(LOWER, UPPER, DIGITS)}`))).toBe(
      "Your password needs at least 8 characters, one uppercase letter, one lowercase letter and one number.",
    );
  });
});

describe("the other refusals", () => {
  it("the same password as the old one", () => {
    expect(REUSED_MESSAGE).toBe("Choose a password you haven't used on this account before.");
    expect(passwordErrorMessage(new AuthApiError("New password should be different from the old password.", 422, "same_password"))).toBe(REUSED_MESSAGE);
  });

  it.each(["over_request_rate_limit", "over_email_send_rate_limit", "over_sms_send_rate_limit"])("rate limited (%s)", (code) => {
    expect(RATE_LIMITED_MESSAGE).toBe("Too many attempts. Wait a few minutes, then try again.");
    expect(passwordErrorMessage(new AuthApiError("Request rate limit reached", 429, code))).toBe(RATE_LIMITED_MESSAGE);
  });

  it("an unnamed 429 is a rate limit too", () => {
    expect(passwordErrorMessage(new AuthApiError("Too many requests", 429, undefined))).toBe(RATE_LIMITED_MESSAGE);
  });

  it("never a raw code in any of them", () => {
    for (const m of [REUSED_MESSAGE, RATE_LIMITED_MESSAGE, LEAKED_MESSAGE]) expect(m).not.toMatch(/_|\b4\d\d\b/);
  });
});

describe("the client and the server cannot quietly disagree", () => {
  const read = (rel: string) => readFileSync(path.join(__dirname, "../..", rel), "utf8");

  it("the policy the dashboard must carry is declared once, next to the rule, and equals it", () => {
    expect(SUPABASE_PASSWORD_POLICY).toEqual({ minimumLength: PASSWORD_MIN_LENGTH, requirements: "lower_upper_letters_digits", leakedPasswordProtection: true });
  });

  it("the local stack's own declaration (supabase/config.toml) matches the rule on length, and never demands more than the app does", () => {
    const toml = read("supabase/config.toml");
    expect(Number(/^minimum_password_length\s*=\s*(\d+)/m.exec(toml)?.[1])).toBe(PASSWORD_MIN_LENGTH);
    const requirements = /^password_requirements\s*=\s*"([^"]*)"/m.exec(toml)?.[1];
    // "" (no class requirement) or exactly the app's: a symbol requirement here would reject passwords the app tells users are fine
    expect(["", SUPABASE_PASSWORD_POLICY.requirements]).toContain(requirements);
  });

  it("the error mapper hard-codes no number: every figure it prints comes from the server's message or the app's constant", () => {
    const src = read("src/lib/auth/password-errors.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // 0 and 1 (indices), the 429 status, and the alphabet of digits the server names ("0123456789") are not rules
    expect(src.match(/(?<![\w$])\d+(?![\w])/g)?.filter((n) => !["0", "1", "429", "0123456789"].includes(n)) ?? []).toEqual([]);
  });

  it("the app's own requirement text is built from the same constant", () => {
    expect(getPasswordRequirements("").find((r) => r.key === "length")!.label).toBe(`At least ${PASSWORD_MIN_LENGTH} characters`);
  });
});
