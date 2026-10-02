/**
 * send-502 — what the operator is told when a mentor payment needs refunding. The alert carries what a person needs to act
 * (the Paystack reference to refund, the amount, the session) and where to resolve it, and never throws.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const alert = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin/alert-email", () => ({ sendAdminAlert: alert }));
const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

import { alertPaymentNeedsRefund } from "@/lib/mentorship/refund-alert";

const args = { reference: "mentor_session_abc123", amountNgn: 25000, sessionId: "53060360-baec-4374-9f94-1d073f4ad8f6" };

beforeEach(() => {
  alert.mockReset();
  alert.mockResolvedValue({ sent: true });
  errorSpy.mockClear();
});

describe("alertPaymentNeedsRefund", () => {
  it("logs a loud NEEDS REFUND line carrying the reference", async () => {
    await alertPaymentNeedsRefund(args);
    expect(errorSpy.mock.calls.flat().join(" ")).toMatch(/NEEDS REFUND[\s\S]*mentor_session_abc123/);
  });

  it("emails the reference, the amount, the session and the admin ops page", async () => {
    await alertPaymentNeedsRefund(args);
    const msg = alert.mock.calls[0][0] as { subject: string; text: string };
    expect(msg.subject).toMatch(/refund/i);
    expect(msg.text).toContain("mentor_session_abc123");
    expect(msg.text).toContain("25,000");
    expect(msg.text).toContain(args.sessionId);
    expect(msg.text).toMatch(/\/admin\/ops/);
  });

  it("never throws, even if the alert itself throws", async () => {
    alert.mockRejectedValue(new Error("mail down"));
    await expect(alertPaymentNeedsRefund(args)).resolves.toBeUndefined();
  });
});
