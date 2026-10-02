/**
 * The scholarship-deadline-alert email itself.
 *
 * Two things are pinned here:
 *
 *   ONE SCHOLARSHIP PER EMAIL, NEVER BUNDLED — the whole reason this send
 *   exists separately from the job digest (see template.ts's own header).
 *
 *   ESCAPING — program name and provider come from ingested/admin-entered
 *   scholarship data, interpolated into HTML landing in someone's inbox.
 */
import { describe, expect, it } from "vitest";
import { buildScholarshipDeadlineEmail } from "@/lib/scholarship-deadline-alerts/template";
import type { DeadlineAlertCandidate } from "@/lib/scholarship-deadline-alerts/select";

const candidate = (over: Partial<DeadlineAlertCandidate> = {}): DeadlineAlertCandidate => ({
  saveId: "save-1",
  userId: "user-1",
  status: "saved",
  deadlineReminderSentAt: null,
  scholarshipId: "sch-1",
  programName: "DAAD EPOS Scholarship",
  provider: "DAAD",
  applicationDeadline: "2026-10-01",
  closeTime: null,
  closeTz: null,
  deadlineVerifiedAt: "2026-09-01T00:00:00.000Z",
  officialUrl: "https://www.daad.de/en/",
  moderationStatus: "verified",
  ...over,
});

const build = (over: Partial<DeadlineAlertCandidate> = {}) =>
  buildScholarshipDeadlineEmail({
    firstName: "Ada",
    candidate: candidate(over),
    unsubscribeToken: "tok-123",
  });

/*
 * CHANGED DELIBERATELY (send-511). An email is read hours after it is sent, so relative wording ("today", "tomorrow", "in 3 days") goes stale. The
 * subject and body state the ABSOLUTE deadline instead: with a zone "Closes 6 Oct 2026, 11:00 UTC"; without one "Deadline 2 Oct 2026, time zone not
 * stated. To be safe, apply by 1 Oct."
 */
describe("subject and lead state an absolute deadline", () => {
  it("with a zone and a time: the instant, in that zone", () => {
    const email = build({ applicationDeadline: "2026-10-06", closeTime: "11:00", closeTz: "UTC" });
    expect(email.subject).toBe("Closes 6 Oct 2026, 11:00 UTC: DAAD EPOS Scholarship");
    expect(email.text).toContain("Closes 6 Oct 2026, 11:00 UTC");
  });

  it("without a zone: the date, the caution, and the day to apply by", () => {
    const email = build({ applicationDeadline: "2026-10-02" });
    expect(email.subject).toBe("Deadline 2 Oct 2026: DAAD EPOS Scholarship");
    expect(email.text).toContain("Deadline 2 Oct 2026, time zone not stated. To be safe, apply by 1 Oct.");
    expect(email.html).toContain("Deadline 2 Oct 2026, time zone not stated. To be safe, apply by 1 Oct.");
  });

  it("never says 'today', 'tomorrow' or 'days left', for any shape of deadline, in the subject, text or html", () => {
    const shapes: Array<Partial<DeadlineAlertCandidate>> = [
      { applicationDeadline: "2026-10-02" },
      { applicationDeadline: "2026-10-06", closeTime: "11:00", closeTz: "UTC" },
      { applicationDeadline: "2026-10-06", closeTime: "13:00", closeTz: "America/Los_Angeles" },
      { applicationDeadline: "2026-10-06", closeTime: null, closeTz: "Africa/Lagos" },
      { applicationDeadline: "2027-01-01" },
    ];
    for (const shape of shapes) {
      const email = build(shape);
      for (const part of [email.subject, email.text, email.html]) {
        expect(part, JSON.stringify(shape)).not.toMatch(/today|tomorrow|days? left|in \d+ days?/i);
      }
    }
  });
});

describe("content", () => {
  it("links to the scholarship's own Talentrah page and its official source, both", () => {
    const email = build();
    expect(email.text).toContain("/scholarships/sch-1");
    expect(email.text).toContain("https://www.daad.de/en/");
    expect(email.html).toContain("/scholarships/sch-1");
    expect(email.html).toContain("https://www.daad.de/en/");
  });

  it("names the exact deadline date", () => {
    const email = build({ applicationDeadline: "2026-10-01" });
    // House format (send-499): day, short month, year; was the US-order "October 1, 2026".
    expect(email.text).toContain("1 Oct 2026");
    expect(email.text).not.toContain("October 1, 2026");
  });

  it("carries a working unsubscribe link scoped to this preference, not the digest's default", () => {
    const email = build();
    expect(email.text).toContain("pref=scholarship_deadline_alert");
    expect(email.html).toContain("pref=scholarship_deadline_alert");
  });

  it("is neutral/informational voice, not signed 'Farah'", () => {
    const email = build();
    expect(email.text).not.toContain("Farah");
    expect(email.html).not.toContain("Farah");
  });

  it("greets by first name, and falls back gracefully when there is none", () => {
    const withName = buildScholarshipDeadlineEmail({
      firstName: "Ada",
      candidate: candidate(),
      unsubscribeToken: "tok",
    });
    expect(withName.text.startsWith("Hi Ada,")).toBe(true);

    const noName = buildScholarshipDeadlineEmail({
      firstName: null,
      candidate: candidate(),
      unsubscribeToken: "tok",
    });
    expect(noName.text.startsWith("Hi,")).toBe(true);
  });
});

describe("escaping", () => {
  it("escapes an attacker-adjacent program name in the HTML body", () => {
    const email = build({ programName: `<script>alert(1)</script> Fund` });
    expect(email.html).not.toContain("<script>alert(1)</script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
});

describe("defends against a candidate that should never reach it", () => {
  it("throws rather than rendering a null deadline — selectDeadlineAlertCandidates should have excluded it", () => {
    expect(() => build({ applicationDeadline: null })).toThrow(/should have excluded it/);
  });
});
