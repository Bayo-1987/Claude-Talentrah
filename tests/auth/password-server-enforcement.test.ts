/**
 * The server side of the password rule, with the form out of the way (S1-58).
 *
 * Production Supabase now enforces a minimum length of 8, lowercase, uppercase and digits, and leaked-password protection. A form that
 * blocks a weak password in the browser shows the form works; it does not show the server enforces anything when the form is bypassed.
 * So these tests call each action's own server function directly, as an API client would (no browser, no form check), against a
 * stand-in for Supabase Auth that enforces a policy and refuses in GoTrue's documented shapes, through the REAL @supabase/supabase-js
 * client. Every refusal must come back as a plain sentence from the mapping in src/lib/auth/password-errors.ts, built from the one
 * shared rule list: never a raw Supabase error, never a generic "something went wrong".
 *
 * Two server functions set a password: signUpAction and updatePasswordAction (the reset form; the app has no separate change-password
 * form). Each is covered for: too short, each missing character type, a leaked password, the same password as before, and a rate limit.
 * Every password-shaped value is built at run time (fakeSecret). The stand-in is a model of documented GoTrue behaviour, not GoTrue itself.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { startFakeGoTrue, type FakeGoTrue } from "../support/fake-gotrue";
import { fakeSecret } from "../support/fake-secret";
import { SUPABASE_PASSWORD_POLICY } from "@/lib/auth/password";
import { PASSWORD_RULES } from "@/lib/auth/password-rules";
import { LEAKED_MESSAGE, RATE_LIMITED_MESSAGE, REUSED_MESSAGE } from "@/lib/auth/password-errors";

const ctx = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ctx.client }));
// The operator check after a successful reset reads admin_users with the service role; there is none.
vi.mock("@/lib/supabase/service-role", () => {
  const q: unknown = new Proxy({}, { get: (_t, key) => (key === "maybeSingle" || key === "single" ? async () => ({ data: null }) : () => q) });
  return { createServiceRoleClient: () => ({ from: () => q }) };
});
vi.mock("@/lib/auth/signup-rate-limit", () => ({ consumeSignupRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/security/request-ip", () => ({ getRequestIp: async () => "192.0.2.1" }));
vi.mock("@/lib/analytics/posthog", () => ({ captureEvent: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }),
}));

const { signUpAction, updatePasswordAction } = await import("@/lib/auth/actions");

const STATE = { error: null };
const needs = (...n: string[]) => `Your password needs ${n.length > 1 ? `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}` : n[0]}.`;
const rule = (key: string) => PASSWORD_RULES.find((r) => r.key === key)!;
const need = (key: string) => rule(key).label.charAt(0).toLowerCase() + rule(key).label.slice(1);
const lengthNeed = `at least ${SUPABASE_PASSWORD_POLICY.minimumLength} characters`;

/** The sentence must never be a raw Supabase string or a generic failure. */
function expectPlain(message: string | null | undefined) {
  expect(message).toBeTruthy();
  expect(message).not.toMatch(/weak_password|same_password|over_request_rate_limit|AuthWeakPasswordError|AuthApiError|reasons|\b422\b|\b429\b|Password should|known to be weak|New password should|Request rate limit/);
  expect(message).not.toMatch(/something went wrong|try again later|unexpected|error occurred/i);
}

const good = () => fakeSecret("password");
// Values the server must refuse, each built at run time from a valid sample.
const tooShort = () => good().slice(0, 4); // upper, lower, digit and a symbol, but 4 characters
const noUpper = () => good().toLowerCase();
const noLower = () => good().toUpperCase();
const noDigit = () => good().replace(/[0-9]/g, "x");

describe.each([
  ["signUpAction", async (fake: FakeGoTrue, password: string) => {
    ctx.client = createClient(fake.url, "anon", { auth: { persistSession: false, autoRefreshToken: false } });
    const fd = new FormData();
    for (const [k, v] of Object.entries({ firstName: "Ada", lastName: "Obi", email: "ada@talentrah.test", country: "Nigeria", password, termsAccepted: "on" })) fd.set(k, v);
    return signUpAction(STATE, fd);
  }],
  ["updatePasswordAction (reset)", async (fake: FakeGoTrue, password: string) => {
    const client = createClient(fake.url, "anon", { auth: { persistSession: false, autoRefreshToken: false } });
    await client.auth.setSession(fake.signIn("user-1"));
    ctx.client = client;
    const fd = new FormData();
    fd.set("password", password);
    return updatePasswordAction(STATE, fd);
  }],
] as const)("%s, called as the API would (no form)", (_name, call) => {
  let fake: FakeGoTrue;
  const pwned = good();
  const stricterPolicy = { minimumLength: SUPABASE_PASSWORD_POLICY.minimumLength + 2, requirements: "lower_upper_letters_digits" as const };

  beforeAll(async () => {
    fake = await startFakeGoTrue({ passwordPolicy: { minimumLength: SUPABASE_PASSWORD_POLICY.minimumLength, requirements: SUPABASE_PASSWORD_POLICY.requirements as "lower_upper_letters_digits", pwned: [pwned] } });
  });
  afterAll(async () => { await fake.close(); });
  beforeEach(() => { fake.requests.length = 0; });

  it("a valid password is accepted (the stand-in is not simply refusing everything)", async () => {
    const result = await call(fake, good());
    expect(result?.error ?? null).toBeNull();
    expect(fake.requests.some((r) => /\/(signup|user)$/.test(r.path) && ["POST", "PUT"].includes(r.method))).toBe(true);
  });

  it("too short: says how long it must be, in plain words", async () => {
    const result = await call(fake, tooShort());
    expect(result?.error).toBeTruthy();
    expectPlain(result!.fieldErrors?.password?.[0] ?? result!.error);
    expect(result!.fieldErrors?.password?.[0]).toBe(needs(lengthNeed));
  });

  it.each([
    ["uppercase", noUpper, "upper"],
    ["lowercase", noLower, "lower"],
    ["a digit", noDigit, "number"],
  ] as const)("missing %s: names exactly that rule", async (_n, make, key) => {
    const result = await call(fake, make());
    expectPlain(result!.fieldErrors?.password?.[0]);
    expect(result!.fieldErrors!.password![0]).toBe(needs(need(key)));
  });

  it("a leaked password: the fixed breach sentence, on the password field", async () => {
    const result = await call(fake, pwned);
    expect(result!.fieldErrors?.password?.[0]).toBe(LEAKED_MESSAGE);
    expectPlain(result!.error);
  });

  it("a server that is stricter than the app (longer minimum): the sentence quotes the SERVER's number", async () => {
    const strict = await startFakeGoTrue({ passwordPolicy: stricterPolicy });
    try {
      const nineChars = good().replace(/[^A-Za-z0-9]/g, "").slice(0, SUPABASE_PASSWORD_POLICY.minimumLength);
      expect(nineChars.length).toBe(SUPABASE_PASSWORD_POLICY.minimumLength); // passes the app's own check, so it reaches the server
      const result = await call(strict, nineChars);
      expect(result!.fieldErrors?.password?.[0]).toBe(needs(`at least ${stricterPolicy.minimumLength} characters`));
    } finally { await strict.close(); }
  });

  it("a rate limit is a plain sentence about the form, not the password, and not a raw 429", async () => {
    const limited = await startFakeGoTrue({ passwordPolicy: { ...stricterPolicy, minimumLength: 8, rateLimited: true } });
    try {
      const result = await call(limited, good());
      expect(result!.error).toBe(RATE_LIMITED_MESSAGE);
      expect(result!.fieldErrors?.password).toBeUndefined();
      expectPlain(result!.error);
    } finally { await limited.close(); }
  });
});

describe("updatePasswordAction: the same password as before", () => {
  it("is refused with the plain sentence, on the password field", async () => {
    const previous = good();
    const fake = await startFakeGoTrue({ passwordPolicy: { minimumLength: SUPABASE_PASSWORD_POLICY.minimumLength, requirements: "lower_upper_letters_digits" } });
    try {
      fake.setPassword("user-1", previous);
      const client = createClient(fake.url, "anon", { auth: { persistSession: false, autoRefreshToken: false } });
      await client.auth.setSession(fake.signIn("user-1"));
      ctx.client = client;
      const fd = new FormData();
      fd.set("password", previous);
      const result = await updatePasswordAction(STATE, fd);
      expect(result.fieldErrors?.password?.[0]).toBe(REUSED_MESSAGE);
      expectPlain(result.error);
    } finally { await fake.close(); }
  });
});

describe("the server's rule and the app's rule agree (so a bypassed form is refused with the same words the form shows)", () => {
  it("every value the app's own check rejects is also refused by the policy the dashboard is declared to carry", async () => {
    const { isPasswordValid } = await import("@/lib/auth/password");
    const fake = await startFakeGoTrue({ passwordPolicy: { minimumLength: SUPABASE_PASSWORD_POLICY.minimumLength, requirements: SUPABASE_PASSWORD_POLICY.requirements as "lower_upper_letters_digits" } });
    try {
      for (const value of [tooShort(), noUpper(), noLower(), noDigit(), good(), good().slice(0, 7), good().slice(0, 8)]) {
        const client = createClient(fake.url, "anon", { auth: { persistSession: false, autoRefreshToken: false } });
        const { error } = await client.auth.signUp({ email: "a@talentrah.test", password: value });
        expect(Boolean(error), `app says valid=${isPasswordValid(value)}`).toBe(!isPasswordValid(value));
      }
    } finally { await fake.close(); }
  });
});
