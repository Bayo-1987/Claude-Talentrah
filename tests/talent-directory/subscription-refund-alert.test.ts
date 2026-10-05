/**
 * A Talent Directory payment that was taken but cannot be activated (0228: another subscription holds the organisation's one active slot, or the
 * pending row or its plan is gone) is recorded as needs_refund in payment_transactions, and the operator is emailed so someone refunds it in Paystack.
 *
 * Only the mail client is mocked: the real alertSubscriptionPaymentNeedsRefund and the real sendAdminAlert run, so what is asserted is what would
 * actually reach the operator's address, not that a function was called. fulfillPayment -> this alert is pinned in subscription-lifecycle.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/resend/client", () => ({ getResendClient: () => ({ emails: { send } }) }));
const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

import { alertSubscriptionPaymentNeedsRefund } from "@/lib/mentorship/refund-alert";

const saved = process.env.ADMIN_ALERT_EMAIL;
const args = { reference: "td_sub_ref_9f2c41", amountNgn: 200000, reason: "already_active" };

beforeEach(() => {
  process.env.ADMIN_ALERT_EMAIL = "operator@example.test";
  send.mockReset();
  send.mockResolvedValue({ error: null });
  errorSpy.mockClear();
});
afterEach(() => {
  if (saved !== undefined) process.env.ADMIN_ALERT_EMAIL = saved;
  else delete process.env.ADMIN_ALERT_EMAIL;
});

describe("alertSubscriptionPaymentNeedsRefund", () => {
  it("emails the admin alert address with the Paystack reference, the amount and the reason", async () => {
    await alertSubscriptionPaymentNeedsRefund(args);
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0] as { to: string; subject: string; text: string };
    expect(mail.to).toBe("operator@example.test");
    expect(mail.subject).toMatch(/refund needed/i);
    expect(mail.subject).toContain("200,000");
    expect(mail.text).toContain("td_sub_ref_9f2c41");
    expect(mail.text).toContain("200,000");
    expect(mail.text).toContain("already_active");
    expect(mail.text).toMatch(/needs_refund/);
  });

  it("logs a loud NEEDS REFUND line carrying the reference, so the log alone is enough to act on", async () => {
    await alertSubscriptionPaymentNeedsRefund(args);
    expect(errorSpy.mock.calls.flat().join("\n")).toMatch(/NEEDS REFUND[\s\S]*td_sub_ref_9f2c41[\s\S]*already_active/);
  });

  it("with ADMIN_ALERT_EMAIL unset: sends nothing, still logs the reference, resolves", async () => {
    delete process.env.ADMIN_ALERT_EMAIL;
    await expect(alertSubscriptionPaymentNeedsRefund(args)).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    const logged = errorSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/NEEDS REFUND[\s\S]*td_sub_ref_9f2c41/);
    expect(logged).toMatch(/ADMIN_ALERT_EMAIL is not set/);
  });

  it("never throws when the mail provider refuses or the client throws (the payment webhook must not be made to retry)", async () => {
    send.mockResolvedValue({ error: { message: "mail down" } });
    await expect(alertSubscriptionPaymentNeedsRefund(args)).resolves.toBeUndefined();
    send.mockRejectedValue(new Error("network"));
    await expect(alertSubscriptionPaymentNeedsRefund(args)).resolves.toBeUndefined();
  });
});
