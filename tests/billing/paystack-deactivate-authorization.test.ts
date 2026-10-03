/**
 * ACCT-1 PR 1 — cancelling a stored card authorisation at Paystack (`POST /customer/deactivate_authorization`).
 *
 * Renewals here are OUR cron charging a stored authorisation code (`chargeAuthorization`); there is no provider-side subscription object to cancel. The
 * only thing that makes the card un-chargeable at the provider is deactivating that authorisation. Account deletion does that before it schedules
 * anything. This pins the request it makes and how each answer is classified, using the module's own error types (an answer that says no is a
 * decline; no answer at all is unavailable), because the deletion flow treats them differently.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaystackDeclineError, PaystackUnavailableError, deactivateAuthorization } from "@/lib/paystack/client";

const fetchMock = vi.fn();
beforeEach(() => {
  process.env.PAYSTACK_SECRET_KEY = "sk_test_not_a_real_key";
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
    expect(url).toBe("https://api.paystack.co/customer/deactivate_authorization");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer sk_test_not_a_real_key");
    expect(JSON.parse(init.body)).toEqual({ authorization_code: "AUTH_abc123" });
  });

  it("an answer that says no is a decline", async () => {
    fetchMock.mockResolvedValue(reply(400, { status: false, message: "Authorization not found" }));
    await expect(deactivateAuthorization("AUTH_x")).rejects.toBeInstanceOf(PaystackDeclineError);
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
