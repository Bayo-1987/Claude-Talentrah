/**
 * P1 — the attempt sink and its classifiers (src/lib/demo/attempt-log.ts).
 * The sink is fail-safe by contract: it is called from a request path that must answer the visitor whether or
 * not the log works (the migration may not even be applied yet, and an outage of the log table must never turn
 * into an outage of the demo).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.fn();
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ from: (table: string) => ({ insert: (row: unknown) => insert(table, row) }) }),
}));

const { recordDemoAttempt, classifyRefusal, classifyError } = await import("@/lib/demo/attempt-log");
const { LLMProviderError } = await import("@/lib/llm/errors");

// Braces matter: vitest runs a function RETURNED from beforeEach as teardown, and mockReset() returns the mock.
beforeEach(() => {
  insert.mockReset();
});

describe("recordDemoAttempt", () => {
  it("writes one row to anonymous_demo_attempts, snake_cased, with only the allowed columns", async () => {
    insert.mockResolvedValue({ error: null });
    await recordDemoAttempt({ outcome: "refused", reason: "daily_cap", errorClass: null, ipRuleActive: false });
    expect(insert).toHaveBeenCalledTimes(1);
    const [table, row] = insert.mock.calls[0] as [string, Record<string, unknown>];
    expect(table).toBe("anonymous_demo_attempts");
    expect(row).toEqual({ outcome: "refused", reason: "daily_cap", error_class: null, ip_rule_active: false });
  });

  it("never rejects: a database error is logged and swallowed", async () => {
    insert.mockResolvedValue({ error: { message: 'relation "anonymous_demo_attempts" does not exist' } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(recordDemoAttempt({ outcome: "success", ipRuleActive: false })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("never rejects: a thrown error (client construction, network) is swallowed too", async () => {
    insert.mockImplementation(async () => {
      throw new Error("socket hang up");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(recordDemoAttempt({ outcome: "success", ipRuleActive: false })).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe("classifyRefusal — which limit said no", () => {
  it.each([
    ["already_used", false, "visitor_cookie"],
    ["already_used", true, "visitor_or_ip"],
    ["daily_cap", false, "daily_cap"],
    ["daily_cap", true, "daily_cap"],
    ["no_identifier", false, "unidentifiable"],
    ["error", false, "claim_error"],
  ] as const)("%s with the IP rule %s -> %s", (reason, ipRuleActive, expected) => {
    expect(classifyRefusal(reason, ipRuleActive)).toBe(expected);
  });
});

describe("classifyError — the class, never the message", () => {
  it("names the provider failure kind", () => {
    expect(classifyError(new LLMProviderError("groq", "rate_limit", "x"))).toBe("rate_limit");
    expect(classifyError(new LLMProviderError("gemini", "auth", "x"))).toBe("auth");
  });
  it("falls back to the constructor name for anything else, and to 'unknown' for non-errors", () => {
    expect(classifyError(new TypeError("boom"))).toBe("TypeError");
    expect(classifyError("a string with CONFIDENTIAL text")).toBe("unknown");
    expect(classifyError(null)).toBe("unknown");
  });
  it("does not leak the error's message text", () => {
    const e = new Error("contains CONFIDENTIAL-PASTE");
    expect(classifyError(e)).not.toContain("CONFIDENTIAL");
  });
});
