/**
 * send-466 — what gets a "closes in N days" reminder, and what stays silent.
 *
 * Every boundary here matters for a reason spelled out in select.ts's own
 * header: the deadline-verification bar and the moderation gate exist because
 * this job runs on the service-role client, which bypasses both the RLS
 * policy that gates public visibility and the only existing place this
 * codebase treats a deadline as trustworthy. Getting either wrong means
 * emailing someone a fact the rest of the app would not stand behind.
 */
import { describe, expect, it } from "vitest";
import {
  SCHOLARSHIP_DEADLINE_REMINDER_DAYS,
  selectDeadlineAlertCandidates,
  type DeadlineAlertCandidate,
} from "@/lib/scholarship-deadline-alerts/select";

const NOW = new Date("2026-09-26T09:00:00.000Z"); // "today" = 2026-09-26

function daysFromNow(days: number): string {
  const d = new Date(Date.UTC(2026, 8, 26)); // 2026-09-26
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

let n = 0;
const candidate = (over: Partial<DeadlineAlertCandidate> = {}): DeadlineAlertCandidate => ({
  saveId: `save-${n++}`,
  userId: `user-${n}`,
  status: "saved",
  deadlineReminderSentAt: null,
  scholarshipId: `scholarship-${n}`,
  programName: `Fully Funded Programme ${n}`,
  provider: "Some University",
  applicationDeadline: daysFromNow(3),
  closeTime: null,
  closeTz: null,
  deadlineVerifiedAt: "2026-09-01T00:00:00.000Z",
  officialUrl: "https://example.edu/apply",
  moderationStatus: "verified",
  ...over,
});

describe("the deadline-verification bar (matches ingest.ts's own auto-publish gate)", () => {
  it("excludes a scholarship with no application_deadline", () => {
    expect(selectDeadlineAlertCandidates([candidate({ applicationDeadline: null })], NOW)).toEqual([]);
  });

  it("excludes a scholarship whose deadline was never independently verified", () => {
    expect(
      selectDeadlineAlertCandidates([candidate({ deadlineVerifiedAt: null })], NOW),
    ).toEqual([]);
  });

  it("includes a scholarship with a verified deadline, otherwise eligible", () => {
    const c = candidate();
    expect(selectDeadlineAlertCandidates([c], NOW)).toEqual([c]);
  });
});

describe("the public-visibility gate, done by hand for the service-role query", () => {
  it("excludes a scholarship that is not (or no longer) verified", () => {
    for (const moderationStatus of ["pending", "rejected"] as const) {
      expect(selectDeadlineAlertCandidates([candidate({ moderationStatus })], NOW)).toEqual([]);
    }
  });
});

describe("the reminder window", () => {
  /*
   * CHANGED DELIBERATELY (send-508, S3-21a). The window is now measured to the closing INSTANT, and a deadline with no zone stated runs to the
   * end of its day at UTC-12 (12:00 UTC the next day), so a deadline DATE N days out closes N days and 27 hours from 09:00 UTC. The reminder
   * ("closes in N days", N whole days left) therefore starts one calendar day later than it did against the bare date; the exact edge,
   * to the minute, is in tests/scholarships/close-instant-call-sites.test.ts. These keep the date-shaped fixtures but state the new edge.
   */
  it(`excludes a no-zone deadline ${SCHOLARSHIP_DEADLINE_REMINDER_DAYS} days out by date (it closes in more than ${SCHOLARSHIP_DEADLINE_REMINDER_DAYS} days)`, () => {
    const c = candidate({ applicationDeadline: daysFromNow(SCHOLARSHIP_DEADLINE_REMINDER_DAYS) });
    expect(selectDeadlineAlertCandidates([c], NOW)).toEqual([]);
  });

  it(`includes a no-zone deadline ${SCHOLARSHIP_DEADLINE_REMINDER_DAYS - 1} days out by date (the last full day inside the window)`, () => {
    const c = candidate({ applicationDeadline: daysFromNow(SCHOLARSHIP_DEADLINE_REMINDER_DAYS - 1) });
    expect(selectDeadlineAlertCandidates([c], NOW)).toEqual([c]);
  });

  it("includes every date inside the window, from today through the boundary", () => {
    for (let d = 0; d <= SCHOLARSHIP_DEADLINE_REMINDER_DAYS - 1; d++) {
      const c = candidate({ applicationDeadline: daysFromNow(d) });
      expect(selectDeadlineAlertCandidates([c], NOW), `day ${d} should qualify`).toEqual([c]);
    }
  });

  it("includes a deadline that closes today — the most urgent case, not one to suppress", () => {
    const c = candidate({ applicationDeadline: daysFromNow(0) });
    expect(selectDeadlineAlertCandidates([c], NOW)).toEqual([c]);
  });

  it("excludes a deadline already in the past", () => {
    const c = candidate({ applicationDeadline: daysFromNow(-2) });
    expect(selectDeadlineAlertCandidates([c], NOW)).toEqual([]);
  });

  /*
   * CHANGED DELIBERATELY (send-508, S3-21a). Yesterday's date used to be "already passed". With no zone stated a deadline now runs to the end
   * of that day at UTC-12, i.e. 12:00 UTC the next day, so at 09:00 UTC on the 26th the 25th's deadline is still open for three hours and
   * the most urgent reminder ("closes today") is still true. After 12:00 UTC it is closed. The exact instant is pinned per zone in
   * tests/scholarships/close-instant-call-sites.test.ts.
   */
  it("a no-zone deadline of yesterday is still alertable until 12:00 UTC today, and not after", () => {
    const c = candidate({ applicationDeadline: daysFromNow(-1) });
    expect(selectDeadlineAlertCandidates([c], NOW)).toEqual([c]);
    expect(selectDeadlineAlertCandidates([c], new Date("2026-09-26T11:59:00.000Z"))).toEqual([c]);
    expect(selectDeadlineAlertCandidates([c], new Date("2026-09-26T12:00:00.000Z"))).toEqual([]);
  });
});

describe("what \"still intends to apply\" means", () => {
  it("includes 'saved' and 'applying'", () => {
    const saved = candidate({ status: "saved" });
    const applying = candidate({ status: "applying" });
    expect(selectDeadlineAlertCandidates([saved, applying], NOW)).toEqual([saved, applying]);
  });

  it("excludes 'submitted' — already applied, a reminder is stale news", () => {
    expect(selectDeadlineAlertCandidates([candidate({ status: "submitted" })], NOW)).toEqual([]);
  });

  it("excludes 'outcome' — the process already concluded", () => {
    expect(selectDeadlineAlertCandidates([candidate({ status: "outcome" })], NOW)).toEqual([]);
  });
});

describe("dedup — the same save is never selected twice", () => {
  it("excludes a save that has already been reminded, even though everything else qualifies", () => {
    const c = candidate({ deadlineReminderSentAt: "2026-09-25T08:00:00.000Z" });
    expect(selectDeadlineAlertCandidates([c], NOW)).toEqual([]);
  });

  it("running selection twice in a row for the same save (without the sender marking it sent) selects it both times — the guard is the stored column, not this function's own memory", () => {
    const c = candidate();
    expect(selectDeadlineAlertCandidates([c], NOW)).toEqual([c]);
    expect(selectDeadlineAlertCandidates([c], NOW)).toEqual([c]);
  });

  it("once the sender's own dedup marker is set, a second run (the next day's cron) excludes it", () => {
    const firstRun = candidate();
    expect(selectDeadlineAlertCandidates([firstRun], NOW)).toEqual([firstRun]);

    // Simulates what sendScholarshipDeadlineAlerts does after a successful
    // send: stamp deadline_reminder_sent_at, then the next run reads it back.
    const afterSend = { ...firstRun, deadlineReminderSentAt: new Date().toISOString() };
    expect(selectDeadlineAlertCandidates([afterSend], NOW)).toEqual([]);
  });
});

describe("carries extra fields through unmodified (generic over T, matching digest/select.ts's filterListablePostings)", () => {
  it("preserves caller-added fields like email/firstName on the objects that pass", () => {
    const enriched = { ...candidate(), email: "ada@example.com", firstName: "Ada" };
    const out = selectDeadlineAlertCandidates([enriched], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].email).toBe("ada@example.com");
    expect(out[0].firstName).toBe("Ada");
  });
});
