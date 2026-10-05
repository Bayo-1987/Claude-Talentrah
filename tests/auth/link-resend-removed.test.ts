/**
 * Signing up is confirmed with a code now (S1-101, #748), and the check-email page for signup has its own resend (resendSignupCodeAction). The old action that
 * re-sent the confirmation LINK, from an address handed to it by the page, had no caller left and is gone. This keeps it gone: a second way to send a signup
 * email, taking its address from the caller instead of the pending-signup cookie, is exactly what the code page was built not to have.
 */
import { describe, expect, it } from "vitest";

describe("the signup email's resend paths", () => {
  it("the old link-resend action is not exported any more", async () => {
    const actions = await import("@/lib/auth/actions");
    expect(Object.keys(actions)).not.toContain("resendSignupConfirmationAction");
  });

  it("the code page's resend is", async () => {
    const actions = await import("@/lib/auth/actions");
    expect(Object.keys(actions)).toContain("resendSignupCodeAction");
  });
});
