/**
 * P1 — the homepage demo logs EVERY attempt with its outcome, and the IP rule stays off on purpose.
 *
 * Why this exists: production had 3 demo runs ever, every row with a null ip_hash, and refusals were not
 * recorded anywhere, so "barely used" and "silently failing" were indistinguishable. After this, each POST to
 * /api/public/jd-demo leaves one row: outcome = success | refused | error | invalid, with WHICH limit refused
 * or WHAT class of error — never an address, never pasted text.
 *
 * Mocked at the module boundary, like tests/demo/jd-demo-no-balance.test.tsx (the limiter's real behaviour is
 * tests/demo/anonymous-limit.test.ts). The IP-rule decision tests deliberately use the REAL limiter module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tailorResumeToJob = vi.fn();
const claimAnonymousRun = vi.fn();
const releaseAnonymousRun = vi.fn(async () => undefined);
const recordDemoAttempt = vi.fn(async () => undefined);

vi.mock("@/lib/tailoring/tailor", () => ({ tailorResumeToJob: (...a: unknown[]) => tailorResumeToJob(...a) }));
vi.mock("@/lib/demo/attempt-log", async (importOriginal) => {
  // Real classifiers, fake sink: the point is what the route asks to record.
  const actual = await importOriginal<typeof import("@/lib/demo/attempt-log")>();
  return { ...actual, recordDemoAttempt: (...a: unknown[]) => recordDemoAttempt(...(a as [])) };
});
vi.mock("@/lib/demo/anonymous-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/demo/anonymous-limit")>();
  return {
    ...actual,
    claimAnonymousRun: (...a: unknown[]) => claimAnonymousRun(...a),
    releaseAnonymousRun: (...a: unknown[]) => releaseAnonymousRun(...(a as [])),
  };
});

const { POST } = await import("@/app/api/public/jd-demo/route");
const { LLMProviderError } = await import("@/lib/llm/errors");

const JD = "We are hiring a backend engineer to build and operate payment APIs at scale. ".repeat(2);
const PASTED_JD_SENTINEL = "CONFIDENTIAL-PASTE-9f3a ".repeat(6);
const VISITOR_IP = "203.0.113.77";

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/public/jd-demo", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": VISITOR_IP, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const OK_RESULT = {
  structuredJd: {}, gapAnalysis: [], tailoredResume: {}, atsScore: 70, atsFixes: [], jdTruncation: null,
};

beforeEach(() => {
  for (const f of [tailorResumeToJob, claimAnonymousRun, releaseAnonymousRun, recordDemoAttempt]) f.mockReset();
  claimAnonymousRun.mockResolvedValue({ allowed: true, reason: "ok" });
  tailorResumeToJob.mockResolvedValue(OK_RESULT);
  vi.stubEnv("ANON_DEMO_IP_SALT", "");
});
afterEach(() => vi.unstubAllEnvs());

/** The one attempt the route recorded, or fail with what it did record. */
function recorded() {
  expect(recordDemoAttempt, "exactly one attempt row per request").toHaveBeenCalledTimes(1);
  return (recordDemoAttempt.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
}

describe("every outcome leaves exactly one attempt row", () => {
  it("success", async () => {
    const res = await post({ jdText: JD });
    expect(res.status).toBe(200);
    expect(recorded()).toMatchObject({ outcome: "success" });
  });

  it("refused: the visitor's cookie already used its run (IP rule off, so it can only be the cookie)", async () => {
    claimAnonymousRun.mockResolvedValue({ allowed: false, reason: "already_used" });
    const res = await post({ jdText: JD });
    expect(res.status).toBe(403);
    expect(recorded()).toMatchObject({ outcome: "refused", reason: "visitor_cookie", ipRuleActive: false });
    expect(tailorResumeToJob).not.toHaveBeenCalled();
  });

  it("refused: the daily cap", async () => {
    claimAnonymousRun.mockResolvedValue({ allowed: false, reason: "daily_cap" });
    const res = await post({ jdText: JD });
    expect(res.status).toBe(429);
    expect(recorded()).toMatchObject({ outcome: "refused", reason: "daily_cap" });
  });

  it("refused: no identifier, and a claim that errored, are OUR failures and are recorded as such", async () => {
    claimAnonymousRun.mockResolvedValue({ allowed: false, reason: "no_identifier" });
    await post({ jdText: JD });
    expect(recorded()).toMatchObject({ outcome: "refused", reason: "unidentifiable" });
    recordDemoAttempt.mockClear();
    claimAnonymousRun.mockResolvedValue({ allowed: false, reason: "error" });
    await post({ jdText: JD });
    expect(recorded()).toMatchObject({ outcome: "refused", reason: "claim_error" });
  });

  it("error: the model call failed; the class is recorded, never the message", async () => {
    tailorResumeToJob.mockRejectedValue(new LLMProviderError("groq", "rate_limit", `quota exceeded for ${PASTED_JD_SENTINEL}`));
    const res = await post({ jdText: JD });
    expect(res.status).toBe(502);
    expect(releaseAnonymousRun).toHaveBeenCalledTimes(1);
    const row = recorded();
    expect(row).toMatchObject({ outcome: "error", errorClass: "rate_limit" });
    expect(JSON.stringify(row)).not.toContain("CONFIDENTIAL");
  });

  it("invalid: a pasted link, a too-short paste, and a malformed body are attempts too (and say why)", async () => {
    await post({ jdText: "https://example.com/jobs/123" });
    expect(recorded()).toMatchObject({ outcome: "invalid", reason: "link_only" });
    recordDemoAttempt.mockClear();
    await post({ jdText: "too short" });
    expect(recorded()).toMatchObject({ outcome: "invalid", reason: "too_short" });
    recordDemoAttempt.mockClear();
    await post("{not json");
    expect(recorded()).toMatchObject({ outcome: "invalid", reason: "malformed_body" });
    expect(claimAnonymousRun, "an invalid paste must not spend a claim").not.toHaveBeenCalled();
  });

  it("a logging failure never changes the visitor's answer", async () => {
    recordDemoAttempt.mockRejectedValue(new Error("table does not exist yet"));
    const res = await post({ jdText: JD });
    expect(res.status).toBe(200);
  });
});

describe("no PII reaches the log", () => {
  it("the recorded row has only the four allowed keys, and carries neither the address nor the pasted text", async () => {
    claimAnonymousRun.mockResolvedValue({ allowed: false, reason: "already_used" });
    await post({ jdText: PASTED_JD_SENTINEL });
    const row = recorded();
    const ALLOWED = ["errorClass", "ipRuleActive", "outcome", "reason"];
    expect(Object.keys(row).length).toBeGreaterThan(0);
    for (const key of Object.keys(row)) expect(ALLOWED, `unexpected key "${key}" in an attempt row`).toContain(key);
    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain(VISITOR_IP);
    expect(serialised).not.toContain("CONFIDENTIAL");
  });
});

describe("the IP rule is OFF unless a salt is configured — a decision, not an accident", () => {
  // Nigerian mobile carriers put thousands of subscribers behind one address, so a per-IP lifetime limit
  // would wrongly refuse most of the market. Setting ANON_DEMO_IP_SALT turns that rule on; leaving it unset
  // is the standing decision, pinned here so changing it has to change a test.
  it("salt absent: the limiter is asked to claim with NO ip hash, even though the request carries an address", async () => {
    await post({ jdText: JD });
    expect(claimAnonymousRun).toHaveBeenCalledTimes(1);
    const [ipHash, visitorId] = claimAnonymousRun.mock.calls[0] as [string | null, string | null];
    expect(ipHash).toBeNull();
    expect(visitorId).toMatch(/^[0-9a-f-]{36}$/);
    expect(recorded()).toMatchObject({ ipRuleActive: false });
  });

  it("salt present (control, so the test above is not vacuous): the same request DOES carry an ip hash, and the log says the IP rule was active", async () => {
    vi.stubEnv("ANON_DEMO_IP_SALT", "test-salt-not-a-secret");
    await post({ jdText: JD });
    const [ipHash] = claimAnonymousRun.mock.calls[0] as [string | null];
    expect(ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ipHash).not.toContain(VISITOR_IP);
    expect(recorded()).toMatchObject({ ipRuleActive: true });
  });

  it("salt present and the visitor is refused as already-used: the log cannot claim it was the cookie, because it may have been the address", async () => {
    vi.stubEnv("ANON_DEMO_IP_SALT", "test-salt-not-a-secret");
    claimAnonymousRun.mockResolvedValue({ allowed: false, reason: "already_used" });
    await post({ jdText: JD });
    expect(recorded()).toMatchObject({ outcome: "refused", reason: "visitor_or_ip", ipRuleActive: true });
  });
});
