/**
 * send-497 / S15 — the real sessions page, rendered under a fixed clock, with the owner's case in it.
 *
 * Ties tests/mentorship/session-buckets.test.ts to the page: a future edit that stops using the bucketing fails here.
 * `requireUser` and the session query are mocked; nothing else is.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/auth/require-user", () => ({ requireUser: async () => ({ user: { id: "mentee-1" } }) }));
vi.mock("@/app/(app)/mentorship/sessions/review-form", () => ({ ReviewForm: () => null }));

const sessions = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/lib/mentorship/queries", () => ({ sessionsAsMentee: async () => sessions.rows }));

import MentorshipSessionsPage from "@/app/(app)/mentorship/sessions/page";

const row = (id: string, status: string, start: string, end: string, mentorName = `Mentor ${id}`) => ({
  id,
  mentorId: "m1",
  menteeId: "mentee-1",
  mentorName,
  menteeName: "Me",
  sessionType: "mock_interview",
  scheduledStart: start,
  scheduledEnd: end,
  priceNgn: 20000,
  status,
  meetingLink: null,
});

/** The text of the <section> whose <h2> is `heading`, or null when there is no such section. */
function section(html: string, heading: string): string | null {
  for (const m of html.matchAll(/<section[^>]*>([\s\S]*?)<\/section>/g)) {
    if (new RegExp(`<h2[^>]*>${heading}</h2>`).test(m[1])) return m[1].replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
  }
  return null;
}

async function render(): Promise<string> {
  return renderToStaticMarkup(await MentorshipSessionsPage({ searchParams: Promise.resolve({}) }));
}

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));
});
afterAll(() => vi.useRealTimers());

describe("the sessions page, with the owner's stale unpaid booking among others", () => {
  it("keeps the 17 Sep unpaid mock interview OUT of Upcoming and in Past, marked as expired", async () => {
    sessions.rows = [
      row("stale", "pending_payment", "2026-09-17T10:00:00.000Z", "2026-09-17T11:00:00.000Z", "Stale Unpaid"),
      row("paid", "confirmed", "2026-10-05T10:00:00.000Z", "2026-10-05T11:00:00.000Z", "Paid Future"),
    ];
    const html = await render();
    const upcoming = section(html, "Upcoming");
    const past = section(html, "Past");
    expect(upcoming, "no Upcoming section").not.toBeNull();
    expect(upcoming).toContain("Paid Future");
    expect(upcoming, "an unpaid, already-started booking must not be 'Upcoming'").not.toContain("Stale Unpaid");
    expect(upcoming).not.toMatch(/Awaiting payment/);
    expect(past).toContain("Stale Unpaid");
    expect(past).toContain("Expired — not paid");
    expect(past).not.toContain("Awaiting payment");
  });

  it("puts an unpaid booking that can still be paid in its own 'Awaiting payment' section, not Upcoming", async () => {
    sessions.rows = [
      row("payable", "pending_payment", "2026-10-05T10:00:00.000Z", "2026-10-05T11:00:00.000Z", "Payable Soon"),
      row("paid", "awaiting_confirmation", "2026-10-06T10:00:00.000Z", "2026-10-06T11:00:00.000Z", "Paid Waiting"),
    ];
    const html = await render();
    const awaiting = section(html, "Awaiting payment");
    expect(awaiting, "no 'Awaiting payment' section").not.toBeNull();
    expect(awaiting).toContain("Payable Soon");
    const upcoming = section(html, "Upcoming");
    expect(upcoming).toContain("Paid Waiting");
    expect(upcoming).toContain("Waiting on the mentor to confirm");
    expect(upcoming).not.toContain("Payable Soon");
  });

  it("shows no 'Awaiting payment' section when there is nothing to pay", async () => {
    sessions.rows = [row("paid", "confirmed", "2026-10-05T10:00:00.000Z", "2026-10-05T11:00:00.000Z")];
    expect(section(await render(), "Awaiting payment")).toBeNull();
  });

  it("says 'No upcoming sessions.' when the only sessions are unpaid or past", async () => {
    sessions.rows = [row("stale", "pending_payment", "2026-09-17T10:00:00.000Z", "2026-09-17T11:00:00.000Z")];
    expect(section(await render(), "Upcoming")).toContain("No upcoming sessions.");
  });
});
