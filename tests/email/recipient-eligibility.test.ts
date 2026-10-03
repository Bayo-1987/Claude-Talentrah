/**
 * Who may be emailed, in one place (EMP-1 / E3; ACCT-1 extends it).
 *
 * THE CONTRACT TODAY IS EXACTLY TWO CONDITIONS: the profile exists, and its email is not blank. Nothing else is
 * pretended. This pins that, including the negative: a field this code does not know about changes nothing.
 *
 * Why no opt-out applies (checked, not assumed). `email_preferences` holds per-STREAM opt-outs for optional mail (the
 * weekly digest, the proactive match alert, the scholarship deadline alert, the win-back email, the employer-resume-
 * view notice, the auto-apply digest). The transactional sends (verification reminders, hired-moment, talent-directory
 * contact email, mentorship reminders) are deliberately not gated on it, each says so in its own header, and the
 * privacy page promises that opting out of the digest still leaves "messages about your account". The closing-date
 * reminder is a transactional note about the employer's own posting, so it follows them.
 */
import { describe, expect, it } from "vitest";
import { recipientSkipReason, selectEmailableRecipients } from "@/lib/email/recipient-eligibility";

const ok = { id: "u1", email: "ada@acme.test", first_name: "Ada" };

describe("recipientSkipReason", () => {
  it("a profile with an email is eligible", () => {
    expect(recipientSkipReason(ok)).toBeNull();
  });

  it("a blank email is not", () => {
    expect(recipientSkipReason({ ...ok, email: null })).toBe("no_email");
    expect(recipientSkipReason({ ...ok, email: "" })).toBe("no_email");
    expect(recipientSkipReason({ ...ok, email: "   " })).toBe("no_email");
  });

  it("PINS THE CONTRACT: fields that do not exist yet (deactivated, deleted, unsubscribed) are not read", () => {
    const future = {
      ...ok,
      deactivated_at: "2026-10-01T00:00:00Z",
      deleted_at: "2026-10-01T00:00:00Z",
      email_unsubscribed_at: "2026-10-01T00:00:00Z",
    };
    expect(recipientSkipReason(future as never)).toBeNull();
  });
});

describe("selectEmailableRecipients", () => {
  it("keeps the eligible, and says why each other was skipped; a wanted id with no profile row is a deleted account", () => {
    const profiles = [
      ok,
      { id: "u3", email: null, first_name: null },
      { id: "u2", email: "b@acme.test", first_name: null },
    ];
    const out = selectEmailableRecipients(["u1", "u2", "u3", "u4"], profiles);
    expect(out.recipients.map((r) => r.email)).toEqual(["ada@acme.test", "b@acme.test"]);
    expect(out.skipped).toEqual([
      { userId: "u3", reason: "no_email" },
      { userId: "u4", reason: "deleted" },
    ]);
  });

  it("returns each person once even when the same id is wanted twice, and trims the address", () => {
    const out = selectEmailableRecipients(["u1", "u1"], [{ ...ok, email: " ada@acme.test " }]);
    expect(out.recipients).toEqual([{ userId: "u1", email: "ada@acme.test", firstName: "Ada" }]);
  });
});
