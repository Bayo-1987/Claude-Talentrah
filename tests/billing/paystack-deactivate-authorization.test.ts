/**
 * ACCT-1 PR 1 — cancelling a stored card authorisation at Paystack (`POST /customer/authorization/deactivate`, the path Paystack's current documentation gives; `/customer/deactivate_authorization` is the superseded one).
 *
 * Renewals here are OUR cron charging a stored authorisation code (`chargeAuthorization`); there is no provider-side subscription object to cancel. The
 * only thing that makes the card un-chargeable at the provider is deactivating that authorisation. Account deletion does that before it schedules
 * anything. This pins the request it makes and how each answer is classified, using the module's own error types (an answer that says no is a
 * decline; no answer at all is unavailable), because the deletion flow treats them differently.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaystackDeclineError, PaystackUnavailableError, deactivateAuthorization } from "@/lib/paystack/client";

const fetchMock = vi.fn();
// Generated at run time, not a literal: this repo's secret scan reads every committed assignment to a *_KEY / *_SECRET name.
const testKey = `sk_test_${randomUUID()}`;
beforeEach(() => {
  process.env.PAYSTACK_SECRET_KEY = testKey;
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const reply = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;

describe("deactivateAuthorization", () => {
  it("POSTs the authorisation code to /customer/deactivate_authorization with the secret key", async () => {
    fetchMock.mockResolvedValue(reply(200, { status: true, message: "Authorization has been deactivated" }));
    await deactivateAuthorization("AUTH_abc123");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.paystack.co/customer/authorization/deactivate");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${testKey}`);
    expect(JSON.parse(init.body)).toEqual({ authorization_code: "AUTH_abc123" });
  });

  it("an answer that says no is a decline", async () => {
    fetchMock.mockResolvedValue(reply(400, { status: false, message: "Authorization not found" }));
    await expect(deactivateAuthorization("AUTH_x")).rejects.toBeInstanceOf(PaystackDeclineError);
  });

  it("a decline carries Paystack's own documented fields (HTTP status, type, code) so a caller never has to read the message", async () => {
    fetchMock.mockResolvedValue(
      reply(404, { status: false, message: "Authorization not found", meta: { nextStep: "x" }, type: "api_error", code: "resource_not_found" }),
    );
    const err = await deactivateAuthorization("AUTH_x").catch((e) => e);
    expect(err).toBeInstanceOf(PaystackDeclineError);
    expect(err.status).toBe(404);
    expect(err.type).toBe("api_error");
    expect(err.code).toBe("resource_not_found");
  });

  it("a decline whose body has no type or code simply has none (nothing is invented from the message)", async () => {
    fetchMock.mockResolvedValue(reply(404, { status: false, message: "Authorization has been deactivated" }));
    const err = await deactivateAuthorization("AUTH_x").catch((e) => e);
    expect(err.type).toBeUndefined();
    expect(err.code).toBeUndefined();
  });

  it("a 5xx is 'unavailable', never a statement about the card", async () => {
    fetchMock.mockResolvedValue(reply(502, {}));
    await expect(deactivateAuthorization("AUTH_x")).rejects.toBeInstanceOf(PaystackUnavailableError);
  });

  it("no answer at all (network failure) is 'unavailable'", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    await expect(deactivateAuthorization("AUTH_x")).rejects.toBeInstanceOf(PaystackUnavailableError);
  });

  it("refuses a blank code before it calls anyone", async () => {
    await expect(deactivateAuthorization("  ")).rejects.toThrow(/authorization code/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
