/**
 * send-499 — which time zone a server-side email renders its date in, pinned.
 *
 * A transactional email is rendered on the server with no viewer to ask, and the schema has no per-user time-zone preference,
 * so the house rule applies: WAT (Africa/Lagos), labelled "WAT", never the server's zone and never UTC. The same instant must
 * render the same line wherever the deployment happens to run, and the line carries no seconds.
 */
import { afterEach, describe, expect, it } from "vitest";
import { buildSessionConfirmedEmail, buildSessionReminderEmail } from "@/lib/notifications/mentorship/template";

const ctx = {
  sessionId: "s1",
  sessionType: "mock_interview" as const,
  // 09:00:30 UTC = 10:00:30 WAT: the seconds must be dropped, the hour shifted by WAT's +1.
  scheduledStart: "2026-10-05T09:00:30.000Z",
  scheduledEnd: "2026-10-05T10:00:30.000Z",
  meetingLink: "https://meet.example.test/abc",
  mentor: { name: "Ada Mentor", email: "mentor@example.test" },
  mentee: { name: "Tunde Mentee", email: "mentee@example.test" },
};

const savedTz = process.env.TZ;
afterEach(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

describe("the confirmation email's date line", () => {
  it("is exactly '5 Oct 2026, 10:00 WAT' (house format, WAT, no seconds)", () => {
    const { text } = buildSessionConfirmedEmail(ctx, "mentee");
    const line = text.split("\n").find((l) => l.startsWith("When:"));
    expect(line).toBe("When: 5 Oct 2026, 10:00 WAT");
  });

  it("is the same line in the HTML body", () => {
    expect(buildSessionConfirmedEmail(ctx, "mentor").html).toContain("5 Oct 2026, 10:00 WAT");
  });

  it("does not depend on the server's time zone", () => {
    for (const tz of ["UTC", "America/Toronto", "Pacific/Auckland"]) {
      process.env.TZ = tz;
      expect(buildSessionConfirmedEmail(ctx, "mentee").text, tz).toContain("When: 5 Oct 2026, 10:00 WAT");
    }
  });

  it("the reminder uses the same line", () => {
    expect(buildSessionReminderEmail(ctx, "mentee").text).toContain("5 Oct 2026, 10:00 WAT");
  });
});
