/**
 * Who may be emailed, in one place (EMP-1 / E3; written so ACCT-1 can rely on it).
 *
 * TODAY'S REALITY: `profiles` has no deactivated/deleted/unsubscribed column. A deleted account is a profile row that
 * is GONE (the caller never gets a row for it), so "deleted" is real now. The other reasons read optional fields the
 * account work will add, so that when it lands a deactivated or unsubscribed person is skipped here without anyone
 * remembering to edit every sender. Until then those fields are simply absent and the person is eligible.
 */
import { describe, expect, it } from "vitest";
import { recipientSkipReason, selectEmailableRecipients } from "@/lib/email/recipient-eligibility";

const ok = { id: "u1", email: "ada@acme.test", first_name: "Ada" };

describe("recipientSkipReason", () => {
  it("a normal profile with an email is eligible", () => {
    expect(recipientSkipReason(ok)).toBeNull();
  });

  it("no email on file", () => {
    expect(recipientSkipReason({ ...ok, email: null })).toBe("no_email");
    expect(recipientSkipReason({ ...ok, email: "   " })).toBe("no_email");
  });

  it("a deleted account", () => {
    expect(recipientSkipReason({ ...ok, deleted_at: "2026-10-01T00:00:00Z" })).toBe("deleted");
  });

  it("a deactivated account", () => {
    expect(recipientSkipReason({ ...ok, deactivated_at: "2026-10-01T00:00:00Z" })).toBe("deactivated");
  });

  it("an unsubscribed person", () => {
    expect(recipientSkipReason({ ...ok, email_unsubscribed_at: "2026-10-01T00:00:00Z" })).toBe("unsubscribed");
  });

  it("an explicit null on those fields means 'not' (a column that exists and is empty)", () => {
    expect(recipientSkipReason({ ...ok, deleted_at: null, deactivated_at: null, email_unsubscribed_at: null })).toBeNull();
  });
});

describe("selectEmailableRecipients", () => {
  it("keeps the eligible, reports why each other was skipped, and treats a missing profile row as deleted", () => {
    const wanted = ["u1", "u2", "u3", "u4", "u5"];
    const profiles = [
      ok,
      { id: "u2", email: "b@acme.test", first_name: null, deactivated_at: "2026-10-01T00:00:00Z" },
      { id: "u3", email: null, first_name: null },
      { id: "u4", email: "d@acme.test", first_name: "D", email_unsubscribed_at: "2026-10-01T00:00:00Z" },
      // u5 has no profile row at all: the account is gone.
    ];
    const out = selectEmailableRecipients(wanted, profiles);
    expect(out.recipients.map((r) => r.email)).toEqual(["ada@acme.test"]);
    expect(out.skipped).toEqual([
      { userId: "u2", reason: "deactivated" },
      { userId: "u3", reason: "no_email" },
      { userId: "u4", reason: "unsubscribed" },
      { userId: "u5", reason: "deleted" },
    ]);
  });
});
