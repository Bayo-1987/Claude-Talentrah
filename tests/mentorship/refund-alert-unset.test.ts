/**
 * send-502 — the PREVIEW situation: ADMIN_ALERT_EMAIL has no value (it is set on Production only).
 *
 * Nothing is mocked except the mail client, which must never be reached. The refund alert must log loudly, keep the line that
 * names the reference (so the badge/log path is enough to act on), send nothing, and resolve instead of throwing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/resend/client", () => ({ getResendClient: () => ({ emails: { send } }) }));

import { alertPaymentNeedsRefund } from "@/lib/mentorship/refund-alert";

const saved = process.env.ADMIN_ALERT_EMAIL;
const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  delete process.env.ADMIN_ALERT_EMAIL;
  send.mockReset();
  errorSpy.mockClear();
});
afterEach(() => {
  if (saved !== undefined) process.env.ADMIN_ALERT_EMAIL = saved;
});

describe("refund alert with ADMIN_ALERT_EMAIL unset (a preview deployment)", () => {
  it("resolves, sends nothing, and says so loudly", async () => {
    await expect(alertPaymentNeedsRefund({ reference: "mentor_session_ref1", amountNgn: 25000, sessionId: "sess-1" })).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    const logged = errorSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/NEEDS REFUND[\s\S]*mentor_session_ref1/);
    expect(logged).toMatch(/ADMIN_ALERT_EMAIL is not set/);
  });
});
