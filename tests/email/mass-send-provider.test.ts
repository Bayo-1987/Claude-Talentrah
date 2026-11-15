import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/resend/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/resend/client")>()), getResendClient: () => null }));

import { QUOTA_HEADERS, classifyProviderError, createResendMassProvider, parseQuotaHeaders } from "@/lib/email/mass-send-provider";
import type { MassEmail } from "@/lib/email/mass-send";

const email = (n: number): MassEmail => ({ from: "A <a@mail.example.test>", to: `zq7.p${n}@example.test`, subject: "S", html: "<p>x</p>", text: "x", headers: { "List-Unsubscribe": "<u>" } });

describe("reading the provider's headers", () => {
  it("turns the two quota headers (used so far) into emails left, with the plan limits", () => {
    const q = parseQuotaHeaders({ [QUOTA_HEADERS.dailyUsed]: "30", [QUOTA_HEADERS.monthlyUsed]: "1000", [QUOTA_HEADERS.rateRemaining]: "7" }, {});
    expect(q).toEqual({ rateRemaining: 7, dailyRemaining: 70, monthlyRemaining: 2000 });
  });
  it("a plan limit from the environment replaces the default, and a bad value falls back", () => {
    expect(parseQuotaHeaders({ [QUOTA_HEADERS.dailyUsed]: "30" }, { MASS_EMAIL_PROVIDER_DAILY_LIMIT: "1000" })?.dailyRemaining).toBe(970);
    expect(parseQuotaHeaders({ [QUOTA_HEADERS.dailyUsed]: "30" }, { MASS_EMAIL_PROVIDER_DAILY_LIMIT: "nope" })?.dailyRemaining).toBe(70);
  });
  it("never goes below zero", () => {
    expect(parseQuotaHeaders({ [QUOTA_HEADERS.dailyUsed]: "500" }, {})?.dailyRemaining).toBe(0);
  });
  it("absent or unreadable headers give no reading at all", () => {
    expect(parseQuotaHeaders(null)).toBeNull();
    expect(parseQuotaHeaders({})).toBeNull();
    expect(parseQuotaHeaders({ [QUOTA_HEADERS.dailyUsed]: "many" })).toBeNull();
  });
  it("matches header names without regard to case", () => {
    expect(parseQuotaHeaders({ "X-Resend-Daily-Quota": "1" })?.dailyRemaining).toBe(99);
  });
});

describe("sorting the provider's errors", () => {
  it("daily and monthly quota errors", () => {
    expect(classifyProviderError({ name: "daily_quota_exceeded" }, null, null)).toEqual({ kind: "quota_exceeded", scope: "daily" });
    expect(classifyProviderError({ name: "monthly_quota_exceeded" }, null, null)).toEqual({ kind: "quota_exceeded", scope: "monthly" });
  });
  it("a rate limit carries the retry-after seconds", () => {
    expect(classifyProviderError({ name: "rate_limit_exceeded" }, { "retry-after": "7" }, null)).toEqual({ kind: "rate_limited", retryAfterSec: 7, quota: null });
    expect(classifyProviderError({ statusCode: 429 }, null, null)).toEqual({ kind: "rate_limited", retryAfterSec: null, quota: null });
  });
  it("a validation error is a refusal of the whole request", () => {
    expect(classifyProviderError({ name: "validation_error" }, null, null)).toEqual({ kind: "rejected" });
  });
  it("anything else, including a name the provider adds later, is an unknown outcome", () => {
    expect(classifyProviderError({ name: "internal_server_error" }, null, null)).toEqual({ kind: "unknown" });
    expect(classifyProviderError({ name: "some_new_error" }, null, null)).toEqual({ kind: "unknown" });
    expect(classifyProviderError(null, null, null)).toEqual({ kind: "unknown" });
  });
});

describe("the real adapter uses only the batch endpoint", () => {
  function fakeClient() {
    const calls = { batch: [] as unknown[][], emailsSend: 0, domainsList: 0 };
    const client = {
      batch: {
        send: async (...args: unknown[]) => {
          calls.batch.push(args);
          return { data: [], error: null, headers: { [QUOTA_HEADERS.dailyUsed]: "10" } };
        },
      },
      emails: { send: async () => { calls.emailsSend += 1; return { data: null, error: null, headers: null }; } },
      domains: { list: async () => { calls.domainsList += 1; return { data: [], error: null, headers: { [QUOTA_HEADERS.dailyUsed]: "5", [QUOTA_HEADERS.monthlyUsed]: "50" } }; } },
    };
    return { client, calls };
  }

  it("sends one object per recipient with the idempotency key, and never calls emails.send", async () => {
    const { client, calls } = fakeClient();
    const provider = createResendMassProvider(() => client as never);
    const answer = await provider.sendBatch([email(1), email(2)], { idempotencyKey: "key-123" });
    expect(answer.kind).toBe("ok");
    expect(calls.emailsSend).toBe(0);
    const [payload, options] = calls.batch[0] as [Array<{ to: string[] }>, { idempotencyKey: string }];
    expect(payload).toHaveLength(2);
    expect(payload.map((p) => p.to)).toEqual([["zq7.p1@example.test"], ["zq7.p2@example.test"]]);
    expect(options).toEqual({ idempotencyKey: "key-123" });
  });

  it("reads the quota from a read call, not from a send", async () => {
    const { client, calls } = fakeClient();
    const provider = createResendMassProvider(() => client as never);
    expect(await provider.readQuota()).toEqual({ rateRemaining: null, dailyRemaining: 95, monthlyRemaining: 2950 });
    expect(calls.batch).toHaveLength(0);
    expect(calls.emailsSend).toBe(0);
    expect(calls.domainsList).toBe(1);
  });

  it("a thrown error is an unknown outcome, and no client means nothing is sent", async () => {
    const throwing = createResendMassProvider(() => ({ batch: { send: async () => { throw new Error("socket hang up zq7.leak@example.test"); } } }) as never);
    expect(await throwing.sendBatch([email(1)], { idempotencyKey: "k" })).toEqual({ kind: "unknown" });
    const none = createResendMassProvider(() => null);
    expect(await none.sendBatch([email(1)], { idempotencyKey: "k" })).toEqual({ kind: "rejected" });
    expect(await none.readQuota()).toBeNull();
  });
});
