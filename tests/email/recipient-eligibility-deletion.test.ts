/**
 * ACCT-1 PR 1 — recipient eligibility learns about accounts scheduled for deletion.
 *
 * `src/lib/email/recipient-eligibility.ts` is the one file that answers "may this profile be emailed". It already skipped a missing profile
 * and a blank address; ACCT-1 adds the third reason: the owner confirmed deletion (`profiles.deletion_requested_at` is set). The send-time
 * guard in the Resend client (tests/lib/email/resend-deletion-guard.test.ts) is the backstop that covers every sender; this is the answer a sender
 * can ask BEFORE it does work (claims a reminder, builds a digest) for someone who will never be mailed.
 */
import { describe, expect, it } from "vitest";
import { recipientSkipReason, selectEmailableRecipients } from "@/lib/email/recipient-eligibility";

const ok = { id: "u1", email: "ada@acme.test", first_name: "Ada" };
const pending = { id: "u2", email: "bo@acme.test", first_name: "Bo", deletion_requested_at: "2026-10-02T12:00:00Z" };

describe("recipientSkipReason, with the deletion flag", () => {
  it("a profile scheduled for deletion is skipped, whatever else is true of it", () => {
    expect(recipientSkipReason(pending)).toBe("deleted_pending");
  });

  it("an explicit null flag is the normal case: eligible", () => {
    expect(recipientSkipReason({ ...ok, deletion_requested_at: null })).toBeNull();
  });

  it("the flag is checked before the address, so a pending account with no email still reports why it is really out", () => {
    expect(recipientSkipReason({ ...pending, email: null })).toBe("deleted_pending");
  });

  it("a restored account (flag cleared again) is eligible", () => {
    expect(recipientSkipReason({ ...pending, deletion_requested_at: null })).toBeNull();
  });
});

describe("selectEmailableRecipients, with the deletion flag", () => {
  it("drops a pending owner and keeps the other, and says which is which", () => {
    const out = selectEmailableRecipients(["u1", "u2"], [ok, pending]);
    expect(out.recipients.map((r) => r.userId)).toEqual(["u1"]);
    expect(out.skipped).toEqual([{ userId: "u2", reason: "deleted_pending" }]);
  });

  it("with only a pending owner there is nobody to mail, and the reason is deleted_pending (not 'no owner found')", () => {
    const out = selectEmailableRecipients(["u2"], [pending]);
    expect(out.recipients).toEqual([]);
    expect(out.skipped).toEqual([{ userId: "u2", reason: "deleted_pending" }]);
  });

  it("a caller that falls back to the creator can do so by asking again with the creator's id", () => {
    const creator = { id: "u3", email: "cy@acme.test", first_name: "Cy" };
    const owners = selectEmailableRecipients(["u2"], [pending, creator]);
    expect(owners.recipients).toEqual([]);
    const fallback = selectEmailableRecipients(["u3"], [pending, creator]);
    expect(fallback.recipients.map((r) => r.userId)).toEqual(["u3"]);
  });
});
