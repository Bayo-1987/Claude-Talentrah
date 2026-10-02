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

const build = (over: Partial<DeadlineAlertCandidate> = {}, daysOut = 5) =>
  buildScholarshipDeadlineEmail({
    firstName: "Ada",
    candidate: candidate(over),
    daysOut,
    unsubscribeToken: "tok-123",
  });

describe("subject line reflects urgency", () => {
  it("says 'today' when the deadline closes today", () => {
    const email = build({}, 0);
    expect(email.subject).toContain("Today's the deadline");
    expect(email.subject).toContain("DAAD EPOS Scholarship");
  });

  it("says a day count otherwise", () => {
    const email = build({}, 3);
    expect(email.subject).toBe("Closes in 3 days: DAAD EPOS Scholarship");
  });

  it("says 'tomorrow' for a 1-day-out deadline, not 'in 1 days'", () => {
    const email = build({}, 1);
    expect(email.subject).toContain("Closes tomorrow");
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

  it("names the exact deadline date, not just a relative count", () => {
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
      daysOut: 5,
      unsubscribeToken: "tok",
    });
    expect(withName.text.startsWith("Hi Ada,")).toBe(true);

    const noName = buildScholarshipDeadlineEmail({
      firstName: null,
      candidate: candidate(),
      daysOut: 5,
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
