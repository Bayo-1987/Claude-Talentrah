/**
 * send-502 — the admin alert for a payment that needs refunding.
 *
 * The recipient is read from ADMIN_ALERT_EMAIL, never committed (the repo is public). The one rule that matters: an alert
 * that cannot be sent must NEVER throw, because the caller is payment fulfilment, and a throw there before the transaction is
 * marked success would make Paystack's webhook retry a payment that was already handled. If the variable is unset the failure
 * is logged loudly instead and the ops badge remains the fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
const client = vi.hoisted(() => ({ value: null as null | { emails: { send: typeof send } } }));
vi.mock("@/lib/resend/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/resend/client")>()), getResendClient: () => client.value }));

import { sendAdminAlert } from "@/lib/admin/alert-email";

const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
const saved = process.env.ADMIN_ALERT_EMAIL;

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ data: { id: "x" }, error: null });
  client.value = { emails: { send } };
  errorSpy.mockClear();
});
afterEach(() => {
  if (saved === undefined) delete process.env.ADMIN_ALERT_EMAIL;
  else process.env.ADMIN_ALERT_EMAIL = saved;
});

describe("sendAdminAlert", () => {
  it("sends to the address in ADMIN_ALERT_EMAIL", async () => {
    process.env.ADMIN_ALERT_EMAIL = "ops@example.test";
    const out = await sendAdminAlert({ subject: "Refund needed", text: "body" });
    expect(out).toEqual({ sent: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ to: "ops@example.test", subject: "Refund needed", text: "body" });
  });

  it("unset: logs loudly, sends nothing, does not throw", async () => {
    delete process.env.ADMIN_ALERT_EMAIL;
    const out = await sendAdminAlert({ subject: "Refund needed", text: "body" });
    expect(out).toEqual({ sent: false, reason: "ADMIN_ALERT_EMAIL is not set" });
    expect(send).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls.flat().join(" ")).toMatch(/ADMIN_ALERT_EMAIL/);
  });

  it("blank counts as unset", async () => {
    process.env.ADMIN_ALERT_EMAIL = "   ";
    expect((await sendAdminAlert({ subject: "s", text: "t" })).sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("no mail client configured: logs, does not throw", async () => {
    process.env.ADMIN_ALERT_EMAIL = "ops@example.test";
    client.value = null;
    const out = await sendAdminAlert({ subject: "s", text: "t" });
    expect(out.sent).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("the mail provider throwing is swallowed and logged", async () => {
    process.env.ADMIN_ALERT_EMAIL = "ops@example.test";
    send.mockRejectedValue(new Error("network down"));
    const out = await sendAdminAlert({ subject: "s", text: "t" });
    expect(out.sent).toBe(false);
    expect(errorSpy.mock.calls.flat().join(" ")).toMatch(/network down/);
  });

  it("the mail provider returning an error object is a failure, not a success", async () => {
    process.env.ADMIN_ALERT_EMAIL = "ops@example.test";
    send.mockResolvedValue({ data: null, error: { message: "rejected" } });
    const out = await sendAdminAlert({ subject: "s", text: "t" });
    expect(out.sent).toBe(false);
  });

  it("never writes the recipient address into the log", async () => {
    process.env.ADMIN_ALERT_EMAIL = "ops@example.test";
    send.mockRejectedValue(new Error("boom"));
    await sendAdminAlert({ subject: "s", text: "t" });
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("ops@example.test");
  });
});
