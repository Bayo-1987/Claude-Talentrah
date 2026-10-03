/**
 * ACCT-1 PR 1 — which refusals from the payment provider let a deletion go ahead, and which stop it.
 *
 * The owner's rule: an authorisation that is already deactivated or unknown counts as cancelled ONLY when Paystack's own documented fields say so,
 * never when free message text happens to; every other refusal blocks the confirm. What Paystack documents for this endpoint: HTTP 404 (the resource
 * does not exist), and an error envelope of `status: false`, a `type` of api_error | validation_error | processor_error, and a Paystack-defined
 * `code`. It publishes no code value for "already deactivated", so the rule is the documented status PLUS the documented envelope: a 404 that is a
 * real Paystack error answer. A bare 404 (a wrong URL, a gateway page) has no envelope and blocks, as does an unreadable body (that is "unavailable").
 * The message is never read. These tests give the same wording to cases that must differ, to prove it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const deactivate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/paystack/client", async (importActual) => ({ ...(await importActual<typeof import("@/lib/paystack/client")>()), deactivateAuthorization: deactivate }));

import { PaystackDeclineError, PaystackUnavailableError } from "@/lib/paystack/client";
import { cancelStoredAuthorizations } from "@/lib/account-deletion/provider-cancel";

const auth = (code = "AUTH_1", source = "pass", id = "row-1") => ({ source, id, authorization_code: code });
const decline = (message: string, status: number, details: { type?: string; code?: string; bodyStatus?: boolean } = {}) => new PaystackDeclineError(message, status, details);

beforeEach(() => {
  deactivate.mockReset().mockResolvedValue({ httpStatus: 200, status: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const allLogged = () =>
  (["error", "warn", "info", "log"] as const)
    .flatMap((m) => (console[m] as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => `${m}: ${c.map(String).join(" ")}`));
const structured = () =>
  allLogged()
    .map((l) => /\[account-deletion\] PAYSTACK_DEACTIVATE (\{.*\})$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => JSON.parse(m[1]) as Record<string, unknown>);

describe("a refusal that counts as cancelled: the documented 404 with a real Paystack error envelope", () => {
  it.each(["api_error", "validation_error", "processor_error"])("404 + type %s + a code", async (type) => {
    deactivate.mockRejectedValue(decline("whatever words", 404, { type, code: "resource_not_found" }));
    expect(await cancelStoredAuthorizations([auth()])).toEqual({ ok: true, cancelled: 1 });
  });

  it("whatever the message says: the same 404 envelope with the message 'Invalid key' still counts (message is never read)", async () => {
    deactivate.mockRejectedValue(decline("Invalid key", 404, { type: "api_error", code: "resource_not_found" }));
    expect((await cancelStoredAuthorizations([auth()])).ok).toBe(true);
  });
});

describe("every other refusal blocks, however friendly its words", () => {
  it.each([
    ["the words 'already deactivated' on a 400", decline("Authorization is already deactivated", 400, { type: "validation_error", code: "invalid_params" })],
    ["the words 'not found' on a 400", decline("Authorization not found", 400, { type: "api_error", code: "resource_not_found" })],
    ["the words 'already deactivated' with NO status, type or code", decline("Authorization is already deactivated", undefined as never)],
    ["a 404 with no error envelope (a wrong URL or a gateway page)", decline("Not Found", 404)],
    ["a 404 whose type is not one Paystack documents", decline("x", 404, { type: "teapot", code: "resource_not_found" })],
    ["a 404 with a type but no code", decline("x", 404, { type: "api_error" })],
    ["a 404 with a blank code", decline("x", 404, { type: "api_error", code: "  " })],
    ["a 401 invalid key", decline("Invalid key", 401, { type: "validation_error", code: "invalid_key" })],
    ["a 403", decline("Forbidden", 403, { type: "api_error", code: "forbidden" })],
    ["a 422", decline("Unprocessable", 422, { type: "validation_error", code: "invalid_params" })],
    ["a 429", decline("Rate limited", 429, { type: "api_error", code: "rate_limited" })],
    ["Paystack being unavailable", new PaystackUnavailableError("Paystack deactivate authorization returned 502")],
    ["a network failure", new Error("ECONNRESET")],
  ])("%s", async (_name, err) => {
    deactivate.mockRejectedValue(err);
    const out = await cancelStoredAuthorizations([auth("AUTH_a", "pass", "row-9")]);
    expect(out).toEqual({ ok: false, cancelled: 0, failedSource: "pass", failedId: "row-9" });
  });

  it("the same 404 + envelope is cancelled, and the same words WITHOUT them block: it is the fields, not the text", async () => {
    deactivate.mockRejectedValueOnce(decline("Authorization not found", 404, { type: "api_error", code: "resource_not_found" }));
    expect((await cancelStoredAuthorizations([auth("AUTH_1")])).ok).toBe(true);
    deactivate.mockRejectedValueOnce(decline("Authorization not found", 404));
    expect((await cancelStoredAuthorizations([auth("AUTH_2")])).ok).toBe(false);
  });
});

describe("the walk through several cards", () => {
  it("cancels each distinct code once, in order, and counts them", async () => {
    const out = await cancelStoredAuthorizations([auth("AUTH_1"), auth("AUTH_2", "talent_directory", "t1"), auth("AUTH_1", "talent_directory", "t2")]);
    expect(out).toEqual({ ok: true, cancelled: 2 });
    expect(deactivate.mock.calls.map((c) => c[0])).toEqual(["AUTH_1", "AUTH_2"]);
  });

  it("stops at the first blocking refusal and reports how many were already cancelled", async () => {
    deactivate.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new PaystackUnavailableError("down"));
    const out = await cancelStoredAuthorizations([auth("AUTH_1"), auth("AUTH_2", "talent_directory", "t1"), auth("AUTH_3")]);
    expect(out).toEqual({ ok: false, cancelled: 1, failedSource: "talent_directory", failedId: "t1" });
    expect(deactivate).toHaveBeenCalledTimes(2);
  });

  it("never logs an authorisation code", async () => {
    deactivate.mockRejectedValue(new Error("down"));
    await cancelStoredAuthorizations([auth("AUTH_secretcode123")]);
    const logged = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).not.toContain("AUTH_secretcode123");
  });

  it("skips blank codes without calling the provider", async () => {
    expect(await cancelStoredAuthorizations([auth("  ")])).toEqual({ ok: true, cancelled: 0 });
    expect(deactivate).not.toHaveBeenCalled();
  });
});

describe("every deactivate call logs ONE structured line, so the first real responses can be read from the logs", () => {
  const FIELDS = ["classification", "code", "http_status", "status", "type"];

  it("success: the HTTP status, the response's status, no type or code, classification 'deactivated'", async () => {
    await cancelStoredAuthorizations([auth("AUTH_1")]);
    expect(structured()).toEqual([{ http_status: 200, status: true, type: null, code: null, classification: "deactivated" }]);
  });

  it("the documented not-found: its status, type and code are logged, classification 'already-deactivated'", async () => {
    deactivate.mockRejectedValue(decline("whatever", 404, { type: "api_error", code: "resource_not_found", bodyStatus: false }));
    await cancelStoredAuthorizations([auth("AUTH_1")]);
    expect(structured()).toEqual([{ http_status: 404, status: false, type: "api_error", code: "resource_not_found", classification: "already-deactivated" }]);
  });

  it("a refusal that blocks: classification 'blocked', with whatever fields Paystack gave", async () => {
    deactivate.mockRejectedValue(decline("Invalid key", 401, { type: "validation_error", code: "invalid_key", bodyStatus: false }));
    await cancelStoredAuthorizations([auth("AUTH_1")]);
    expect(structured()).toEqual([{ http_status: 401, status: false, type: "validation_error", code: "invalid_key", classification: "blocked" }]);
  });

  it("a 5xx logs its HTTP status; no answer at all logs nulls; both are 'blocked'", async () => {
    deactivate.mockRejectedValueOnce(new PaystackUnavailableError("returned 502", undefined, 502));
    await cancelStoredAuthorizations([auth("AUTH_1")]);
    deactivate.mockRejectedValueOnce(new PaystackUnavailableError("did not complete"));
    await cancelStoredAuthorizations([auth("AUTH_2")]);
    expect(structured()).toEqual([
      { http_status: 502, status: null, type: null, code: null, classification: "blocked" },
      { http_status: null, status: null, type: null, code: null, classification: "blocked" },
    ]);
  });

  it("an error that is not Paystack's at all still logs a line, with nulls", async () => {
    deactivate.mockRejectedValue(new Error("boom"));
    await cancelStoredAuthorizations([auth("AUTH_1")]);
    expect(structured()).toEqual([{ http_status: null, status: null, type: null, code: null, classification: "blocked" }]);
  });

  it("the line has EXACTLY these five fields and nothing else", async () => {
    deactivate.mockRejectedValueOnce(decline("m", 404, { type: "api_error", code: "c", bodyStatus: false }));
    await cancelStoredAuthorizations([auth("AUTH_1")]);
    await cancelStoredAuthorizations([auth("AUTH_2")]);
    for (const line of structured()) expect(Object.keys(line).sort()).toEqual(FIELDS);
  });

  it("one line per call: two distinct cards log two lines, a duplicate code is not called and not logged twice", async () => {
    await cancelStoredAuthorizations([auth("AUTH_1"), auth("AUTH_2"), auth("AUTH_1")]);
    expect(structured()).toHaveLength(2);
  });

  it("'already-deactivated' ALSO logs at WARN with its own tag (on a first deletion it is suspicious: the path could be wrong)", async () => {
    deactivate.mockRejectedValue(decline("whatever", 404, { type: "api_error", code: "resource_not_found", bodyStatus: false }));
    await cancelStoredAuthorizations([auth("AUTH_1")]);
    const warns = (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.map(String).join(" "));
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatch(/\[account-deletion\] PAYSTACK_ALREADY_DEACTIVATED \{.*"classification":"already-deactivated".*\}/);
    expect(warns[0]).toMatch(/suspicious/i);
  });

  it("no other classification warns", async () => {
    await cancelStoredAuthorizations([auth("AUTH_1")]);
    deactivate.mockRejectedValue(decline("m", 401, { type: "validation_error", code: "invalid_key" }));
    await cancelStoredAuthorizations([auth("AUTH_2")]);
    expect((console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(0);
  });
});

describe("the logs never carry an authorisation code, a key, an email or the provider's message text", () => {
  const CODE = "AUTH_leak123abc";
  const KEY = "sk_test_leakleakleak";
  const EMAIL = "ada.leak@example.com";
  const MESSAGE = `Authorization ${CODE} for ${EMAIL} is already deactivated (key ${KEY})`;

  it.each([
    ["a documented not-found whose message holds all three", () => decline(MESSAGE, 404, { type: "api_error", code: "resource_not_found", bodyStatus: false })],
    ["a blocking refusal whose message holds all three", () => decline(MESSAGE, 400, { type: "validation_error", code: "invalid_params", bodyStatus: false })],
    ["an unavailable error whose message holds all three", () => new PaystackUnavailableError(MESSAGE, new Error(MESSAGE), 502)],
    ["a plain error whose message holds all three", () => new Error(MESSAGE)],
  ])("%s", async (_name, make) => {
    deactivate.mockRejectedValue(make());
    await cancelStoredAuthorizations([auth(CODE, "pass", "row-1")]);
    const text = allLogged().join("\n");
    expect(text).not.toContain(CODE);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain("is already deactivated (key");
    expect(structured()).toHaveLength(1);
  });

  it("a success whose response body would carry them logs none of it either", async () => {
    deactivate.mockResolvedValue({ httpStatus: 200, status: true, message: MESSAGE, authorization_code: CODE });
    await cancelStoredAuthorizations([auth(CODE)]);
    const text = allLogged().join("\n");
    for (const secret of [CODE, KEY, EMAIL]) expect(text).not.toContain(secret);
    expect(structured()).toEqual([{ http_status: 200, status: true, type: null, code: null, classification: "deactivated" }]);
  });
});
