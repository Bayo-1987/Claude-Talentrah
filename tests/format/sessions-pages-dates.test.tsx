/**
 * send-499 — the mentorship sessions pages show the house date format, not the runtime's locale.
 *
 * They were the last allowlisted `toLocaleString()` sites: `new Date(x).toLocaleString()` printed "10/5/2026, 10:00:00 AM" on a US
 * server and "05/10/2026, 10:00:00" on a UK one (5 October or 10 May?), with seconds. Both pages now print "5 Oct 2026, 10:00 WAT".
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/auth/require-user", () => ({ requireUser: async () => ({ user: { id: "u1" } }) }));
vi.mock("@/app/(app)/mentorship/sessions/review-form", () => ({ ReviewForm: () => null }));
vi.mock("@/lib/mentorship/actions", () => ({ confirmMentorSessionAction: async () => {} }));
const rows = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("@/lib/mentorship/queries", () => ({ sessionsAsMentee: async () => rows.list, sessionsAsMentor: async () => rows.list }));

import MenteePage from "@/app/(app)/mentorship/sessions/page";
import MentorPage from "@/app/(app)/mentorship/sessions/mentor/page";

// 09:00:30 UTC is 10:00:30 WAT: seconds dropped, hour shifted.
const row = (status: string) => ({
  id: "s1", mentorId: "m1", menteeId: "u1", mentorName: "Ada", menteeName: "Tunde", sessionType: "mock_interview",
  scheduledStart: "2026-10-05T09:00:30.000Z", scheduledEnd: "2026-10-05T10:00:30.000Z", priceNgn: 20000, status, meetingLink: null,
  createdAt: "2026-10-01T11:00:00.000Z",
});
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));
});
afterAll(() => vi.useRealTimers());

describe("sessions pages: dates in the house format", () => {
  it("the mentee's page", async () => {
    rows.list = [row("confirmed")];
    const html = text(renderToStaticMarkup(await MenteePage({ searchParams: Promise.resolve({}) })));
    expect(html).toContain("5 Oct 2026, 10:00 WAT");
    expect(html).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
  });

  it("the mentor's page", async () => {
    rows.list = [row("confirmed")];
    const html = text(renderToStaticMarkup(await MentorPage()));
    expect(html).toContain("5 Oct 2026, 10:00 WAT");
    expect(html).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
  });
});
