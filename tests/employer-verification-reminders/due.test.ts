/**
 * dueVerificationReminder — the pure timing rule behind Stage 7's "still
 * unverified" reminder: 48h, then 7d, then never again.
 */
import { describe, expect, it } from "vitest";
import { dueVerificationReminder } from "@/lib/employer-verification-reminders/due";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const posted = new Date("2026-08-25T11:50:24.897Z"); // Fatishcakes' real posted_at

function elapsedFrom(hours: number): Date {
  return new Date(posted.getTime() + hours * HOUR);
}

describe("before either threshold", () => {
  it("is not due at all right after posting", () => {
    expect(
      dueVerificationReminder({
        now: elapsedFrom(1),
        earliestUnverifiedPostedAt: posted,
        reminder48hSentAt: null,
        reminder7dSentAt: null,
      }),
    ).toBeNull();
  });

  it("is still not due just under 48 hours", () => {
    expect(
      dueVerificationReminder({
        now: elapsedFrom(47.9),
        earliestUnverifiedPostedAt: posted,
        reminder48hSentAt: null,
        reminder7dSentAt: null,
      }),
    ).toBeNull();
  });
});

describe("the 48h reminder", () => {
  it("is due at exactly 48 hours if never sent", () => {
    expect(
      dueVerificationReminder({
        now: elapsedFrom(48),
        earliestUnverifiedPostedAt: posted,
        reminder48hSentAt: null,
        reminder7dSentAt: null,
      }),
    ).toBe("48h");
  });

  it("is not due again once sent, even still short of 7 days", () => {
    expect(
      dueVerificationReminder({
        now: elapsedFrom(72),
        earliestUnverifiedPostedAt: posted,
        reminder48hSentAt: elapsedFrom(48),
        reminder7dSentAt: null,
      }),
    ).toBeNull();
  });
});

describe("the 7d reminder", () => {
  it("is due at exactly 7 days if the 48h one already went out", () => {
    expect(
      dueVerificationReminder({
        now: elapsedFrom(7 * 24),
        earliestUnverifiedPostedAt: posted,
        reminder48hSentAt: elapsedFrom(48),
        reminder7dSentAt: null,
      }),
    ).toBe("7d");
  });

  it("is due at 7 days even if the 48h one was somehow never sent", () => {
    // A cron that only started running after the window passed — the 7d
    // reminder is still the right one to send, not a stale 48h.
    expect(
      dueVerificationReminder({
        now: elapsedFrom(7 * 24),
        earliestUnverifiedPostedAt: posted,
        reminder48hSentAt: null,
        reminder7dSentAt: null,
      }),
    ).toBe("7d");
  });

  it("is not due again once sent", () => {
    expect(
      dueVerificationReminder({
        now: elapsedFrom(30 * 24),
        earliestUnverifiedPostedAt: posted,
        reminder48hSentAt: elapsedFrom(48),
        reminder7dSentAt: elapsedFrom(7 * 24),
      }),
    ).toBeNull();
  });
});

describe("then stop — an org unverified for months never gets a third", () => {
  it("stays null indefinitely once both have gone out", () => {
    const bothSent = {
      reminder48hSentAt: elapsedFrom(48),
      reminder7dSentAt: elapsedFrom(7 * 24),
    };
    for (const days of [30, 90, 365]) {
      expect(
        dueVerificationReminder({
          now: new Date(posted.getTime() + days * DAY),
          earliestUnverifiedPostedAt: posted,
          ...bothSent,
        }),
      ).toBeNull();
    }
  });
});
