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
const decline = (message: string, status: number, details: { type?: string; code?: string } = {}) => new PaystackDeclineError(message, status, details);

beforeEach(() => {
  deactivate.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

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
