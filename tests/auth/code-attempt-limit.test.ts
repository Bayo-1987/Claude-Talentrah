/**
 * The attempt limit on the signup code (S1-101): FAILED attempts only, 6 per email and 30 per IP, each per 15 minutes. No new table: it uses
 * anonymous_rate_limits (0117). Two things work together:
 *   - a count of FAILED attempts, read (not incremented) before the check and incremented after a failure, so a correct code never uses any of it;
 *   - an atomic ceiling that EVERY attempt takes one slot of (12 per email, 60 per IP), because a read-then-act gate alone lets a burst of parallel
 *     guesses all read "0 failures" before any of them records one. The ceiling is the part that holds under concurrency.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeRateLimitDb, type FakeRateLimitDb } from "../support/fake-rate-limit-db";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => holder.db }));

const { CODE_ATTEMPT_LIMITS, gateCodeAttempt, recordFailedCodeAttempt } = await import("@/lib/auth/code-attempt-limit");

let db: FakeRateLimitDb;
const T0 = new Date("2026-10-06T10:00:00Z");
const EMAIL = "ada@example.com";
const IP = "203.0.113.7";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  db = createFakeRateLimitDb();
  holder.db = db;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function attempt(email = EMAIL, ip: string | null = IP, wrong = true) {
  const gate = await gateCodeAttempt(email, ip);
  if (gate.allowed && wrong) await recordFailedCodeAttempt(email, ip);
  return gate;
}

describe("the numbers", () => {
  it("pins the limits", () => {
    expect(CODE_ATTEMPT_LIMITS).toEqual({
      failEmail: { limit: 6, windowSeconds: 900 },
      failIp: { limit: 30, windowSeconds: 900 },
      burstEmail: { limit: 12, windowSeconds: 900 },
      burstIp: { limit: 60, windowSeconds: 900 },
    });
  });
});

describe("failed attempts per email", () => {
  it("the first six wrong codes are allowed to be tried; the seventh attempt is blocked", async () => {
    for (let i = 1; i <= 6; i++) expect((await attempt()).allowed, `attempt ${i}`).toBe(true);
    const seventh = await attempt();
    expect(seventh.allowed).toBe(false);
  });

  it("a blocked attempt says when the window ends (15 minutes from the start of its window)", async () => {
    for (let i = 0; i < 6; i++) await attempt();
    const blocked = await gateCodeAttempt(EMAIL, IP);
    expect(blocked).toEqual({ allowed: false, resetsAt: new Date("2026-10-06T10:15:00Z").toISOString() });
  });

  it("SUCCESSFUL attempts do not count: the failure counters are untouched by a gate that is never followed by a failure", async () => {
    for (let i = 0; i < 5; i++) await attempt();
    await attempt(EMAIL, IP, false); // the correct code: gate only, no failure recorded
    expect(db.total("codeFailEmail")).toBe(5);
    expect(db.total("codeFailIp")).toBe(5);
  });

  it("five wrong codes then the right one is allowed", async () => {
    for (let i = 0; i < 5; i++) await attempt();
    expect((await attempt(EMAIL, IP, false)).allowed).toBe(true);
  });

  it("another address is not affected by this one's failures", async () => {
    for (let i = 0; i < 7; i++) await attempt();
    expect((await attempt("grace@example.com")).allowed).toBe(true);
  });

  it("the address is matched case-insensitively", async () => {
    for (let i = 0; i < 6; i++) await attempt("Ada@Example.com");
    expect((await attempt("ada@example.COM")).allowed).toBe(false);
  });

  it("a fresh window after 15 minutes allows attempts again", async () => {
    for (let i = 0; i < 7; i++) await attempt();
    vi.setSystemTime(new Date("2026-10-06T10:15:01Z"));
    expect((await attempt()).allowed).toBe(true);
  });
});

describe("failed attempts per IP", () => {
  it("30 failures from one IP across different addresses block the next attempt from that IP, whoever it is for", async () => {
    for (let i = 0; i < 30; i++) await attempt(`user${i}@example.com`, IP);
    expect((await attempt("someone.new@example.com", IP)).allowed).toBe(false);
    expect((await attempt("someone.new@example.com", "198.51.100.9")).allowed).toBe(true);
  });

  it.each([null, "127.0.0.1", "::1"])("an unidentifiable caller (%s) is not counted per IP: no IP bucket is touched", async (ip) => {
    for (let i = 0; i < 6; i++) await attempt(EMAIL, ip);
    expect(db.total("codeFailIp")).toBe(0);
    expect(db.total("codeBurstIp")).toBe(0);
    expect((await attempt(EMAIL, ip)).allowed).toBe(false); // the per-email limit still applies
  });
});

describe("the atomic ceiling under concurrency", () => {
  it("40 simultaneous attempts on one address let at most 12 through, even though none has recorded a failure yet", async () => {
    const results = await Promise.all(Array.from({ length: 40 }, () => gateCodeAttempt(EMAIL, IP)));
    expect(results.filter((r) => r.allowed)).toHaveLength(12);
  });

  it("the ceiling per IP holds across many addresses (60 per window)", async () => {
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) => gateCodeAttempt(`u${i}@example.com`, IP)));
    expect(results.filter((r) => r.allowed)).toHaveLength(60);
  });

  it("BOTH ceiling buckets are consumed on every attempt, even when the first one denies (no tell about which tripped)", async () => {
    for (let i = 0; i < 12; i++) await gateCodeAttempt(EMAIL, IP);
    const before = db.total("codeBurstIp");
    const denied = await gateCodeAttempt(EMAIL, IP);
    expect(denied.allowed).toBe(false);
    expect(db.total("codeBurstIp")).toBe(before + 1);
  });
});

describe("privacy and failure modes", () => {
  it("no rate key contains the address (it is hashed), and none contains an '@'", async () => {
    for (let i = 0; i < 3; i++) await attempt();
    const email = db.keys().filter((k) => k !== IP);
    expect(email.length).toBeGreaterThan(0);
    for (const k of email) {
      expect(k).not.toContain("@");
      expect(k).not.toContain("example.com");
    }
  });

  it("fails CLOSED when the counter cannot be written", async () => {
    db.failRpc = true;
    expect((await gateCodeAttempt(EMAIL, IP)).allowed).toBe(false);
  });

  it("fails CLOSED when the failure count cannot be read", async () => {
    db.failSelect = true;
    expect((await gateCodeAttempt(EMAIL, IP)).allowed).toBe(false);
  });

  it("recording a failure never throws, even when the counter is down", async () => {
    db.failRpc = true;
    await expect(recordFailedCodeAttempt(EMAIL, IP)).resolves.toBeUndefined();
  });

  it("logs never carry the address", async () => {
    db.failRpc = true;
    await gateCodeAttempt(EMAIL, IP);
    await recordFailedCodeAttempt(EMAIL, IP);
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls);
    expect(logged).not.toContain("ada@example.com");
  });
});
