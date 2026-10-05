/**
 * Signing up with a six-digit code instead of a confirmation link (S1-101): the three Server Actions behind /signup/check-email, and the signup action's
 * hand-off to that page.
 *
 * What is real here: the actions, the pending-signup cookie codec, the attempt limiter and the existing resend limiter (against an in-memory model of
 * consume_anonymous_rate_limit and the table read, tests/support/fake-rate-limit-db.ts), and onboardingDestination. What is faked: Supabase auth (verifyOtp,
 * resend and signUp are spies), the cookie jar, the request headers and redirect(), which throws exactly as Next's does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createFakeRateLimitDb, type FakeRateLimitDb } from "../support/fake-rate-limit-db";
import { encodeSignupPending, decodeSignupPending } from "@/lib/auth/signup-pending-codec";

const h = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  sets: [] as Array<{ name: string; value: string; options: Record<string, unknown> }>,
  deletes: [] as Array<{ name: string; path?: string }>,
  headers: new Map<string, string>(),
  verifyOtp: vi.fn(),
  resend: vi.fn(),
  signUp: vi.fn(),
  db: null as unknown,
}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (n: string) => h.headers.get(n) ?? null }),
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name)! } : undefined),
    getAll: () => [...h.jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      h.jar.set(name, value);
      h.sets.push({ name, value, options });
    },
    delete: (arg: string | { name: string; path?: string }) => {
      const name = typeof arg === "string" ? arg : arg.name;
      h.jar.delete(name);
      h.deletes.push({ name, path: typeof arg === "string" ? undefined : arg.path });
    },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectUrl: url });
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp: h.verifyOtp, resend: h.resend, signUp: h.signUp } }),
}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => h.db }));
vi.mock("@/lib/analytics/posthog", () => ({ captureEvent: vi.fn() }));

const { verifySignupCodeAction, resendSignupCodeAction, startOverSignupAction, signUpAction } = await import("@/lib/auth/actions");

const NOW = new Date("2026-10-06T10:00:00Z");
const EMAIL = "ada@example.com";
const IP = "203.0.113.7";
/** Built at run time, never written down: the secret scan treats a typed-out password in a test as a credential. */
const PASSWORD = `Aa1-${randomUUID().slice(0, 12)}`;
const WRONG_OR_EXPIRED = `That code didn't work. It may be wrong, or it may have expired. Check the 6 digits, or use "Resend code" to get a new one.`;
const idle = { status: "idle", message: null, fieldError: null, code: "", ended: false } as const;
const idleResend = { status: "idle", message: null, cooldownSeconds: null, ended: false } as const;

let db: FakeRateLimitDb;

function pend(opts: { email?: string; redirectTo?: string; issuedAtMsAgo?: number } = {}) {
  h.jar.set("tr_signup_pending", encodeSignupPending({ email: opts.email ?? EMAIL, redirectTo: opts.redirectTo ?? "", issuedAt: Date.now() - (opts.issuedAtMsAgo ?? 120_000) }));
}
function codeForm(code: string) {
  const fd = new FormData();
  fd.set("code", code);
  return fd;
}
async function run<T>(fn: () => Promise<T>): Promise<{ result?: T; redirectedTo?: string }> {
  try {
    return { result: await fn() };
  } catch (e) {
    const url = (e as { redirectUrl?: string }).redirectUrl;
    if (url !== undefined) return { redirectedTo: url };
    throw e;
  }
}
const verify = (code: string) => run(() => verifySignupCodeAction(idle, codeForm(code)));
const rejected = (message = "Token has expired or is invalid", status = 403, code = "otp_expired") => ({ data: { user: null, session: null }, error: { message, status, code } });
const accepted = { data: { user: { id: "u1" }, session: { access_token: "t" } }, error: null };

const logged = () =>
  JSON.stringify([console.error, console.warn, console.log, console.info].flatMap((f) => (f as unknown as { mock: { calls: unknown[][] } }).mock.calls));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.jar.clear();
  h.sets.length = 0;
  h.deletes.length = 0;
  h.headers = new Map([["x-real-ip", IP], ["host", "talentrah.test"]]);
  h.verifyOtp.mockReset();
  h.resend.mockReset();
  h.signUp.mockReset();
  h.resend.mockResolvedValue({ data: {}, error: null });
  db = createFakeRateLimitDb();
  h.db = db;
  for (const m of ["error", "warn", "log", "info"] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a correct code", () => {
  it("signs in and lands where the confirmation link would: onboarding", async () => {
    pend();
    h.verifyOtp.mockResolvedValue(accepted);
    const { redirectedTo } = await verify("123456");
    expect(redirectedTo).toBe("/onboarding");
    expect(h.verifyOtp).toHaveBeenCalledWith({ email: EMAIL, token: "123456", type: "email" });
  });

  it("carries the destination the signup form was given, exactly as the link route does (onboarding?next=...)", async () => {
    pend({ redirectTo: "/jobs?page=2" });
    h.verifyOtp.mockResolvedValue(accepted);
    expect((await verify("123456")).redirectedTo).toBe("/onboarding?next=%2Fjobs%3Fpage%3D2");
  });

  it("clears the pending cookie and the link flow's stashed destination (which is scoped to /auth)", async () => {
    pend();
    h.jar.set("tr_post_auth", "/jobs");
    h.verifyOtp.mockResolvedValue(accepted);
    await verify("123456");
    expect(h.deletes).toContainEqual({ name: "tr_signup_pending", path: "/signup" });
    expect(h.deletes).toContainEqual({ name: "tr_post_auth", path: "/auth" });
  });

  it("accepts a pasted code with spaces or dashes", async () => {
    pend();
    h.verifyOtp.mockResolvedValue(accepted);
    await verify("123 456");
    expect(h.verifyOtp).toHaveBeenCalledWith({ email: EMAIL, token: "123456", type: "email" });
  });

  it("does not use up any of the failure budget", async () => {
    pend();
    h.verifyOtp.mockResolvedValue(accepted);
    await verify("123456");
    expect(db.total("codeFailEmail")).toBe(0);
    expect(db.total("codeFailIp")).toBe(0);
  });

  it("the address is in no URL the flow produces", async () => {
    pend({ redirectTo: "/jobs" });
    h.verifyOtp.mockResolvedValue(accepted);
    const { redirectedTo } = await verify("123456");
    for (const part of ["@", "%40", "example.com", "ada"]) expect(redirectedTo, part).not.toContain(part);
  });

  it("an accepted code with no session is not a sign-in: the person is told to try again and stays on the page", async () => {
    pend();
    h.verifyOtp.mockResolvedValue({ data: { user: { id: "u1" }, session: null }, error: null });
    const { result, redirectedTo } = await verify("123456");
    expect(redirectedTo).toBeUndefined();
    expect(result?.message).toBe("We couldn't check that code just now. Try again in a moment.");
  });
});

describe("a code that does not work", () => {
  it("shows ONE plain message (what happened and what to do), keeps what was typed, and counts a failure", async () => {
    pend();
    h.verifyOtp.mockResolvedValue(rejected());
    const { result, redirectedTo } = await verify("654321");
    expect(redirectedTo).toBeUndefined();
    expect(result).toEqual({ status: "error", message: WRONG_OR_EXPIRED, fieldError: null, code: "654321", ended: false });
    expect(db.total("codeFailEmail")).toBe(1);
    expect(db.total("codeFailIp")).toBe(1);
  });

  it("wrong, expired and unknown-address codes all get the SAME message (nothing to enumerate accounts with)", async () => {
    const outcomes = [
      rejected("Token has expired or is invalid", 403, "otp_expired"),
      rejected("Token has expired or is invalid", 403, "otp_expired"),
      rejected("User not found", 404, "user_not_found"),
      rejected("Email link is invalid or has expired", 400, "validation_failed"),
    ];
    const messages: Array<string | null | undefined> = [];
    for (const [i, o] of outcomes.entries()) {
      h.jar.clear();
      pend({ email: `person${i}@example.com` });
      h.verifyOtp.mockResolvedValueOnce(o);
      messages.push((await verify("111111")).result?.message);
    }
    expect(new Set(messages)).toEqual(new Set([WRONG_OR_EXPIRED]));
  });

  it("a code that is not six digits is refused on the spot: a field message, Supabase never asked, nothing counted", async () => {
    pend();
    const { result } = await verify("12");
    expect(result).toEqual({ status: "error", message: null, fieldError: "Enter the 6-digit code from the email.", code: "12", ended: false });
    expect(h.verifyOtp).not.toHaveBeenCalled();
    expect(db.total("codeFailEmail")).toBe(0);
    expect(db.total("codeBurstEmail")).toBe(0);
  });

  it("nothing in the log carries the address, even when Supabase's own message does", async () => {
    pend();
    h.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: { message: `Error sending to ada@example.com failed`, status: 500, code: "unexpected_failure" } });
    await verify("123456");
    expect(logged()).not.toContain("ada@example.com");
  });
});

describe("the attempt limit (6 failed per email)", () => {
  it("the 7th attempt is blocked without asking Supabase, even with the right code", async () => {
    pend();
    h.verifyOtp.mockResolvedValue(rejected());
    for (let i = 0; i < 6; i++) expect((await verify("000000")).result?.message, `attempt ${i + 1}`).toBe(WRONG_OR_EXPIRED);
    expect(h.verifyOtp).toHaveBeenCalledTimes(6);
    h.verifyOtp.mockResolvedValue(accepted);
    const seventh = await verify("123456");
    expect(seventh.redirectedTo).toBeUndefined();
    expect(seventh.result?.message).toBe("Too many tries. Wait about 15 minutes, then enter the code again.");
    expect(h.verifyOtp).toHaveBeenCalledTimes(6);
  });

  it("failed attempts count; a success does not: five wrong codes then the right one signs in, and the count stays at five", async () => {
    pend();
    h.verifyOtp.mockResolvedValue(rejected());
    for (let i = 0; i < 5; i++) await verify("000000");
    h.verifyOtp.mockResolvedValue(accepted);
    expect((await verify("123456")).redirectedTo).toBe("/onboarding");
    expect(db.total("codeFailEmail")).toBe(5);
  });

  it("the block ends with the window", async () => {
    pend();
    h.verifyOtp.mockResolvedValue(rejected());
    for (let i = 0; i < 6; i++) await verify("000000");
    vi.setSystemTime(new Date("2026-10-06T10:15:01Z"));
    h.verifyOtp.mockResolvedValue(accepted);
    expect((await verify("123456")).redirectedTo).toBe("/onboarding");
  });

  it("a rate-limit answer from Supabase itself is shown as 'too many tries' and is not counted as a failed code", async () => {
    pend();
    h.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: { message: "Request rate limit reached", status: 429, code: "over_request_rate_limit" } });
    const { result } = await verify("123456");
    expect(result?.message).toMatch(/^Too many tries\./);
    expect(db.total("codeFailEmail")).toBe(0);
  });

  it.each([503, 500, 0, undefined])("a Supabase outage (status %s) is 'try again in a moment' and is not counted either", async (status) => {
    pend();
    h.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: { message: "upstream", status, code: "unexpected_failure" } });
    const { result } = await verify("123456");
    expect(result?.message).toBe("We couldn't check that code just now. Try again in a moment.");
    expect(db.total("codeFailEmail")).toBe(0);
  });

  it("a burst of simultaneous guesses cannot get past the atomic ceiling (12 reach Supabase, the rest do not)", async () => {
    pend();
    h.verifyOtp.mockResolvedValue(rejected());
    await Promise.all(Array.from({ length: 40 }, () => verify("000000")));
    expect(h.verifyOtp.mock.calls.length).toBeLessThanOrEqual(12);
  });
});

describe("the IP the limits are keyed on (S1-101 review)", () => {
  const ipKeys = (bucket: string) => [...db.counts.keys()].filter((k) => k.split("\u0000")[1] === bucket).map((k) => k.split("\u0000")[0]);

  it("is the platform's client IP (x-real-ip), never the leftmost x-forwarded-for entry, which a caller can write", async () => {
    pend();
    h.verifyOtp.mockResolvedValue(rejected());
    h.headers.set("x-forwarded-for", `6.6.6.6, ${IP}`);
    await verify("000000");
    expect(ipKeys("codeFailIp")).toEqual([IP]);
    expect(ipKeys("codeBurstIp")).toEqual([IP]);
  });

  it("changing the spoofed header does not move the count to a new key: every attempt lands on the same IP key", async () => {
    pend();
    h.verifyOtp.mockResolvedValue(rejected());
    for (const spoof of ["6.6.6.6", "7.7.7.7", "8.8.8.8, 9.9.9.9"]) {
      h.headers.set("x-forwarded-for", `${spoof}, ${IP}`);
      await verify("000000");
    }
    expect(ipKeys("codeFailIp")).toEqual([IP]);
    expect(db.total("codeFailIp")).toBe(3);
  });

  it("a request with ONLY a forwarded-for header (nothing from the platform) has no per-IP key at all: it is not trusted", async () => {
    pend();
    h.verifyOtp.mockResolvedValue(rejected());
    h.headers.delete("x-real-ip");
    h.headers.set("x-forwarded-for", "6.6.6.6");
    await verify("000000");
    expect(db.total("codeFailIp")).toBe(0);
    expect(db.total("codeBurstIp")).toBe(0);
    expect(db.keys()).not.toContain("6.6.6.6");
  });

  it("resend uses the same trusted IP for its daily per-IP limit", async () => {
    pend({ issuedAtMsAgo: 120_000 });
    h.headers.set("x-forwarded-for", `6.6.6.6, ${IP}`);
    await run(() => resendSignupCodeAction(idleResend, new FormData()));
    expect(ipKeys("resendIp")).toEqual([IP]);
  });
});

describe("no pending signup", () => {
  it("with no cookie the action says the step has timed out and never asks Supabase", async () => {
    const { result } = await verify("123456");
    expect(result).toEqual({ status: "error", message: "This step has timed out. Go back to sign up and we'll send a new code.", fieldError: null, code: "123456", ended: true });
    expect(h.verifyOtp).not.toHaveBeenCalled();
  });

  it("a tampered cookie is the same as no cookie", async () => {
    h.jar.set("tr_signup_pending", "%%%");
    expect((await verify("123456")).result?.ended).toBe(true);
  });
});

describe("resend", () => {
  const resendNow = () => run(() => resendSignupCodeAction(idleResend, new FormData()));

  it("sends a new code through the existing resend call, restarts the minute, and keeps the cookie fresh", async () => {
    pend({ issuedAtMsAgo: 61_000 });
    const { result } = await resendNow();
    expect(h.resend).toHaveBeenCalledWith({ type: "signup", email: EMAIL });
    expect(result).toEqual({ status: "success", message: "We sent a new code. Check your inbox.", cooldownSeconds: 60, ended: false });
    const set = h.sets.find((s) => s.name === "tr_signup_pending")!;
    expect(decodeSignupPending(set.value)).toEqual({ email: EMAIL, redirectTo: "", issuedAt: NOW.getTime() });
    expect(set.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/signup", maxAge: 3600 });
  });

  it("within the first minute it refuses, says how long is left, and does not call Supabase or use the daily budget", async () => {
    pend({ issuedAtMsAgo: 10_000 });
    const { result } = await resendNow();
    expect(result).toEqual({ status: "error", message: "You can ask for another code in 50 seconds.", cooldownSeconds: 50, ended: false });
    expect(h.resend).not.toHaveBeenCalled();
    expect(db.total("resendEmail")).toBe(0);
  });

  it("uses the existing daily limits: the sixth send for one address in a day is refused without reaching Supabase", async () => {
    pend({ issuedAtMsAgo: 120_000 });
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(new Date(NOW.getTime() + (i + 1) * 61_000));
      expect((await resendNow()).result?.status, `send ${i + 1}`).toBe("success");
    }
    vi.setSystemTime(new Date(NOW.getTime() + 6 * 61_000));
    const sixth = await resendNow();
    expect(sixth.result).toMatchObject({ status: "error", message: "That's a lot of requests for this address — try again later." });
    expect(h.resend).toHaveBeenCalledTimes(5);
  });

  it("Supabase's own mailer limit (429) gets the same 'try later' message", async () => {
    pend({ issuedAtMsAgo: 120_000 });
    h.resend.mockResolvedValue({ data: {}, error: { message: "email rate limit exceeded", status: 429 } });
    expect((await resendNow()).result?.message).toBe("That's a lot of requests for this address — try again later.");
  });

  it("any other failure is one generic sentence, and the log never carries the address", async () => {
    pend({ issuedAtMsAgo: 120_000 });
    h.resend.mockResolvedValue({ data: {}, error: { message: `Email address "ada@example.com" is invalid`, status: 400 } });
    const { result } = await resendNow();
    expect(result?.message).toBe("Couldn't resend that — try again in a moment.");
    expect(logged()).not.toContain("ada@example.com");
  });

  it("with no pending signup it says the step has timed out", async () => {
    expect((await resendNow()).result).toMatchObject({ status: "error", ended: true });
    expect(h.resend).not.toHaveBeenCalled();
  });

  it("never returns the address", async () => {
    pend({ issuedAtMsAgo: 120_000 });
    expect(JSON.stringify((await resendNow()).result)).not.toContain("example.com");
  });
});

describe("the resend cooldown is kept by the server, per address (S1-101 review)", () => {
  const resendNow = () => run(() => resendSignupCodeAction(idleResend, new FormData()));
  const forged = () => pend({ issuedAtMsAgo: 600_000 }); // an unsigned cookie can say anything: here, "the code went out ten minutes ago"

  it("a cookie forged to say the code went out long ago does not buy a second send in the same minute", async () => {
    forged();
    expect((await resendNow()).result?.status).toBe("success");
    forged();
    const second = await resendNow();
    expect(second.result).toEqual({ status: "error", message: "You can ask for another code in 60 seconds.", cooldownSeconds: 60, ended: false });
    expect(h.resend).toHaveBeenCalledTimes(1);
  });

  it("clearing the cookie and setting it again for the same address within the minute is refused the same way", async () => {
    forged();
    await resendNow();
    h.jar.clear();
    forged();
    expect((await resendNow()).result?.status).toBe("error");
    expect(h.resend).toHaveBeenCalledTimes(1);
  });

  it("the minute is counted down from the server's clock: 30 seconds into it, 30 are left", async () => {
    forged();
    await resendNow();
    vi.setSystemTime(new Date(NOW.getTime() + 30_000));
    forged();
    expect((await resendNow()).result).toMatchObject({ status: "error", message: "You can ask for another code in 30 seconds.", cooldownSeconds: 30 });
  });

  it("once the minute is over it works again", async () => {
    forged();
    await resendNow();
    vi.setSystemTime(new Date(NOW.getTime() + 61_000));
    forged();
    expect((await resendNow()).result?.status).toBe("success");
    expect(h.resend).toHaveBeenCalledTimes(2);
  });

  it("a refused resend uses none of the daily budget (it is the minute, not the day, that said no)", async () => {
    forged();
    await resendNow();
    forged();
    await resendNow();
    expect(db.total("resendEmail")).toBe(1);
  });

  it("is keyed on the address, not the browser: another address is not held by this one's minute", async () => {
    forged();
    await resendNow();
    h.jar.clear();
    pend({ email: "grace@example.com", issuedAtMsAgo: 600_000 });
    expect((await resendNow()).result?.status).toBe("success");
  });

  it("the key is the hashed, lower-cased address: no '@' in it, and 'ADA@Example.com' is the same address as 'ada@example.com'", async () => {
    pend({ email: "ADA@Example.com", issuedAtMsAgo: 600_000 });
    await resendNow();
    pend({ email: "ada@example.com", issuedAtMsAgo: 600_000 });
    expect((await resendNow()).result?.status).toBe("error");
    const keys = [...db.counts.keys()].filter((k) => k.split("\u0000")[1] === "codeResendCooldown").map((k) => k.split("\u0000")[0]);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain("@");
  });

  it("fails closed with the generic sentence when the counter cannot be written (and nothing is sent)", async () => {
    forged();
    db.failRpc = true;
    expect((await resendNow()).result).toMatchObject({ status: "error", message: "Couldn't resend that — try again in a moment." });
    expect(h.resend).not.toHaveBeenCalled();
  });

  it("the signup's own email counts as the first send of the minute: a resend right after signing up is refused even with a forged cookie", async () => {
    h.signUp.mockResolvedValue({ data: { user: { id: "u1" }, session: null }, error: null });
    const fd = new FormData();
    for (const [k, v] of Object.entries({ firstName: "Ada", lastName: "Lovelace", email: EMAIL, country: "Nigeria", password: PASSWORD, termsAccepted: "on" })) fd.set(k, v);
    await run(() => signUpAction({ error: null }, fd));
    h.jar.clear();
    forged();
    expect((await resendNow()).result?.status).toBe("error");
    expect(h.resend).not.toHaveBeenCalled();
  });
});

describe("'Wrong address?'", () => {
  it("forgets the pending signup and goes back to /signup (no address in the URL)", async () => {
    pend();
    const { redirectedTo } = await run(() => startOverSignupAction());
    expect(redirectedTo).toBe("/signup");
    expect(h.deletes).toContainEqual({ name: "tr_signup_pending", path: "/signup" });
  });
});

describe("the signup action's hand-off", () => {
  function signupForm(extra: Record<string, string> = {}) {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ firstName: "Ada", lastName: "Lovelace", email: EMAIL, country: "Nigeria", password: PASSWORD, termsAccepted: "on", ...extra })) fd.set(k, v);
    return fd;
  }
  const signup = (fd: FormData) => run(() => signUpAction({ error: null }, fd));

  it("goes to a bare /signup/check-email: no address in the URL, in any form", async () => {
    h.signUp.mockResolvedValue({ data: { user: { id: "u1" }, session: null }, error: null });
    const { redirectedTo } = await signup(signupForm());
    expect(redirectedTo).toBe("/signup/check-email");
  });

  it("hands the address and the destination to the page in the pending cookie, with the time the code went out", async () => {
    h.signUp.mockResolvedValue({ data: { user: { id: "u1" }, session: null }, error: null });
    await signup(signupForm({ redirectTo: "/jobs" }));
    const set = h.sets.find((s) => s.name === "tr_signup_pending")!;
    expect(decodeSignupPending(set.value)).toEqual({ email: EMAIL, redirectTo: "/jobs", issuedAt: NOW.getTime() });
    expect(set.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/signup", maxAge: 3600 });
  });

  it("still asks Supabase to send a link that comes back through /auth/callback (people mid-flow before the template change keep a working link)", async () => {
    h.signUp.mockResolvedValue({ data: { user: { id: "u1" }, session: null }, error: null });
    await signup(signupForm());
    expect(h.signUp.mock.calls[0][0].options.emailRedirectTo).toBe("http://talentrah.test/auth/callback?next=/onboarding");
  });

  it("still stashes the destination for the link route", async () => {
    h.signUp.mockResolvedValue({ data: { user: { id: "u1" }, session: null }, error: null });
    await signup(signupForm({ redirectTo: "/jobs" }));
    expect(h.sets.find((s) => s.name === "tr_post_auth")?.value).toBe("/jobs");
  });
});
