/**
 * send-497 / S15 — the MENTOR's sessions page follows the same rule as the mentee's: an unpaid booking is not "upcoming".
 *
 * It used to show every session that was not awaiting confirmation under "Everything else", so a mentor saw the owner's
 * 17 Sep unpaid booking beside real ones. Same fixed-clock render as the mentee page's test, and the same plain label:
 * until the expiry PR the row is still `pending_payment` and its slot is still held, so nothing may say expired/released.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/auth/require-user", () => ({ requireUser: async () => ({ user: { id: "mentor-1" } }) }));
vi.mock("@/lib/mentorship/actions", () => ({ confirmMentorSessionAction: async () => {} }));

const sessions = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/lib/mentorship/queries", () => ({ sessionsAsMentor: async () => sessions.rows }));

import MentorSessionsPage from "@/app/(app)/mentorship/sessions/mentor/page";

const row = (id: string, status: string, start: string, end: string, menteeName: string) => ({
  id,
  mentorId: "mentor-1",
  menteeId: "m",
  mentorName: "Me",
  menteeName,
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
    if (new RegExp(`<h2[^>]*>${heading}</h2>`).test(m[1])) return m[1].replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
  }
  return null;
}
const render = async () => renderToStaticMarkup(await MentorSessionsPage());

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));
});
afterAll(() => vi.useRealTimers());

describe("the mentor's sessions page", () => {
  it("keeps a stale unpaid booking out of Upcoming and in Past, with the plain label", async () => {
    sessions.rows = [
      row("stale", "pending_payment", ...PAST, "Stale Unpaid"),
      row("paid", "confirmed", ...FUTURE, "Paid Future"),
    ];
    const html = await render();
    const upcoming = section(html, "Upcoming");
    const past = section(html, "Past");
    expect(upcoming).toContain("Paid Future");
    expect(upcoming).not.toContain("Stale Unpaid");
    expect(past).toContain("Stale Unpaid");
    expect(past).toContain("Not paid — the slot has passed");
    expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(/expire|releas/i);
  });

  it("lists an unpaid booking that can still be paid under 'Awaiting payment', not Upcoming", async () => {
    sessions.rows = [row("payable", "pending_payment", ...FUTURE, "Payable Soon")];
    const html = await render();
    const awaiting = section(html, "Awaiting payment");
    expect(awaiting).toContain("Payable Soon");
    expect(awaiting).toContain("Awaiting the mentee's payment");
    expect(section(html, "Upcoming")).toBeNull();
  });

  it("still puts a paid session waiting on the mentor under 'Needs your confirmation', with its Confirm button", async () => {
    sessions.rows = [row("needs", "awaiting_confirmation", ...FUTURE, "Needs Me")];
    const html = await render();
    expect(section(html, "Needs your confirmation")).toContain("Needs Me");
    expect(html).toContain(">Confirm<");
  });

  it("a paid session waiting on the mentor whose slot has passed is past, not 'Needs your confirmation'", async () => {
    sessions.rows = [row("late", "awaiting_confirmation", ...PAST, "Too Late")];
    const html = await render();
    expect(section(html, "Needs your confirmation")).toBeNull();
    expect(section(html, "Past")).toContain("Too Late");
  });

  it("says nothing is booked when there are no sessions at all (unchanged)", async () => {
    sessions.rows = [];
    expect((await render()).replace(/<[^>]+>/g, " ")).toContain("No sessions booked with you yet.");
  });
});
