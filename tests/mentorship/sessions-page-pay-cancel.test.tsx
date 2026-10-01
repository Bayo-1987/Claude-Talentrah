/**
 * send-502 / S15 — an awaiting-payment row gets Pay and Cancel; nothing else does.
 *
 * The owner's finding: a booking listed as awaiting payment with no way to pay it or to get rid of it. The mentee page now
 * offers both on exactly the rows that can still be paid (unpaid, slot ahead), and says plainly what each state is.
 * Rendered under a fixed clock with the same mocks as sessions-page-buckets.test.tsx.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/auth/require-user", () => ({ requireUser: async () => ({ user: { id: "mentee-1" } }) }));
vi.mock("@/app/(app)/mentorship/sessions/review-form", () => ({ ReviewForm: () => null }));
vi.mock("@/lib/mentorship/actions", () => ({
  payForMentorSessionAction: async () => {},
  cancelUnpaidMentorSessionAction: async () => {},
}));
const sessions = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/lib/mentorship/queries", () => ({ sessionsAsMentee: async () => sessions.rows }));

import MentorshipSessionsPage from "@/app/(app)/mentorship/sessions/page";

const row = (id: string, status: string, start: string, end: string) => ({
  id,
  mentorId: "m1",
  menteeId: "mentee-1",
  mentorName: `Mentor ${id}`,
  menteeName: "Me",
  sessionType: "mock_interview",
  scheduledStart: start,
  scheduledEnd: end,
  priceNgn: 20000,
  status,
  meetingLink: null,
});
const FUTURE: [string, string] = ["2026-10-05T10:00:00.000Z", "2026-10-05T11:00:00.000Z"];
const PAST: [string, string] = ["2026-09-17T10:00:00.000Z", "2026-09-17T11:00:00.000Z"];

function section(html: string, heading: string): string | null {
  for (const m of html.matchAll(/<section[^>]*>([\s\S]*?)<\/section>/g)) {
    if (new RegExp(`<h2[^>]*>${heading}</h2>`).test(m[1])) return m[1];
  }
  return null;
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const render = async (searchParams: { error?: string; booked?: string } = {}) => renderToStaticMarkup(await MentorshipSessionsPage({ searchParams: Promise.resolve(searchParams) }));

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));
});
afterAll(() => vi.useRealTimers());

describe("Pay and Cancel on the awaiting-payment rows", () => {
  it("each awaiting-payment row has a Pay button and a Cancel button, as real form submits", async () => {
    sessions.rows = [row("payable", "pending_payment", ...FUTURE)];
    const awaiting = section(await render(), "Awaiting payment");
    expect(awaiting, "no 'Awaiting payment' section").not.toBeNull();
    expect(awaiting).toMatch(/<form[^>]*>[\s\S]*?<button[^>]*type="submit"[^>]*>\s*Pay\b[^<]*<\/button>[\s\S]*?<\/form>/);
    expect(awaiting).toMatch(/<form[^>]*>[\s\S]*?<button[^>]*type="submit"[^>]*>\s*Cancel\b[^<]*<\/button>[\s\S]*?<\/form>/);
  });

  it("the Pay button names what it will charge", async () => {
    sessions.rows = [row("payable", "pending_payment", ...FUTURE)];
    expect(text(section(await render(), "Awaiting payment") ?? "")).toMatch(/Pay ₦20,000/);
  });

  it("no other section offers Pay or Cancel: not Upcoming, not Past", async () => {
    sessions.rows = [
      row("paid", "confirmed", ...FUTURE),
      row("waiting", "awaiting_confirmation", ...FUTURE),
      row("stale", "pending_payment", ...PAST),
      row("done", "completed", ...PAST),
    ];
    const html = await render();
    for (const heading of ["Upcoming", "Past"]) {
      const t = text(section(html, heading) ?? "");
      expect(t, heading).not.toMatch(/\bPay\b/);
      expect(t, heading).not.toMatch(/\bCancel\b/);
    }
  });
});

describe("the states the new migration makes real", () => {
  it("an expired unpaid booking is in Past and says it expired", async () => {
    sessions.rows = [row("gone", "expired_unpaid", ...PAST)];
    expect(text(section(await render(), "Past") ?? "")).toContain("Expired — not paid");
  });

  it("a booking the mentee cancelled is in Past and says so", async () => {
    sessions.rows = [row("cancelled", "cancelled_by_mentee", ...FUTURE)];
    expect(text(section(await render(), "Past") ?? "")).toContain("Cancelled by you");
  });

  it("a payment that arrived too late says a refund is being arranged, in plain words", async () => {
    sessions.rows = [row("late", "payment_needs_refund", ...PAST)];
    const t = text(section(await render(), "Past") ?? "");
    expect(t).toContain("Payment received — refund being arranged");
  });
});

describe("a refused Pay or Cancel is explained, not silent", () => {
  it("shows the error the action redirected with", async () => {
    sessions.rows = [];
    expect(text(await render({ error: "That booking can no longer be paid for." }))).toContain("That booking can no longer be paid for.");
  });
});
