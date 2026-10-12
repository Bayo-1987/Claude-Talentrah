import { afterEach, describe, expect, it, vi, type Mocked } from "vitest";
import { runInterviewNotices, type NoticeBooking, type NoticeContext, type NoticeDeps } from "@/lib/interviews/notices";

const NOW = new Date("2026-10-25T09:00:00Z");
const booking = (n: number): NoticeBooking => ({ bookingId: `b${n}`, applicationId: `a${n}`, jobId: "job-1", organizationId: "org-1", startsAt: "2026-10-26T09:00:00Z", durationMinutes: 45 });
const ctx: NoticeContext = { orgName: "Zimcrest", jobTitle: "Growth Marketer", offerId: "offer-1", candidateName: "Joy Akindele", candidateEmail: "joy@candidate-mail.example", employerEmail: "hiring@zimcrest.example" };

function makeDeps(overrides: Partial<NoticeDeps> = {}) {
  return {
    sweep: vi.fn(async () => ({ cancelled: 0, expired: 0 })),
    claimCancellations: vi.fn(async () => [] as NoticeBooking[]),
    releaseCancellation: vi.fn(async () => {}),
    claimReminders: vi.fn(async () => [] as NoticeBooking[]),
    releaseReminder: vi.fn(async () => {}),
    context: vi.fn(async () => ctx as NoticeContext | null),
    send: vi.fn(async () => true),
    candidateUrl: (id: string) => `https://t.test/interviews/${id}`,
    employerUrl: (j: string, a: string) => `https://t.test/employer/jobs/${j}/applicants/${a}/schedule`,
    ...overrides,
  } as unknown as Mocked<NoticeDeps>;
}
afterEach(() => vi.restoreAllMocks());

describe("runInterviewNotices: cancellation emails", () => {
  it("sends ONE neutral email to the CANDIDATE only, with no reason, for each claimed cancellation", async () => {
    const deps = makeDeps({ claimCancellations: vi.fn(async () => [booking(1)]) });
    const summary = await runInterviewNotices(deps, NOW);
    expect(summary).toMatchObject({ ok: true, cancellationsClaimed: 1, cancellationsSent: 1, cancellationsReleased: 0 });
    expect(deps.send).toHaveBeenCalledTimes(1);
    const mail = deps.send.mock.calls[0][0];
    expect(mail.to).toBe("joy@candidate-mail.example");
    expect(mail.text + mail.subject).not.toMatch(/fit|reject|unfortunately|decid|because|reason/i);
    expect(mail.text).toContain("has been cancelled");
  });

  it("a failed send releases the claim for the next run and the run reports not ok", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const deps = makeDeps({ claimCancellations: vi.fn(async () => [booking(1)]), send: vi.fn(async () => false) });
    const summary = await runInterviewNotices(deps, NOW);
    expect(deps.releaseCancellation).toHaveBeenCalledWith("b1");
    expect(summary).toMatchObject({ ok: false, cancellationsReleased: 1, cancellationsSent: 0 });
  });

  it("a candidate with no address (deleting) is not emailed and nothing is released (there is nothing to retry)", async () => {
    const deps = makeDeps({ claimCancellations: vi.fn(async () => [booking(1)]), context: vi.fn(async () => ({ ...ctx, candidateEmail: null })) });
    const summary = await runInterviewNotices(deps, NOW);
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.releaseCancellation).not.toHaveBeenCalled();
    expect(summary.ok).toBe(true);
  });

  it("never emails the employer about a cancellation (the employer acted)", async () => {
    const deps = makeDeps({ claimCancellations: vi.fn(async () => [booking(1), booking(2)]) });
    await runInterviewNotices(deps, NOW);
    expect(deps.send.mock.calls.map((c) => c[0].to)).not.toContain("hiring@zimcrest.example");
  });
});

describe("runInterviewNotices: reminders", () => {
  it("asks for bookings 23 to 25 hours ahead and sends ONE reminder to the candidate and ONE to the member who made the offer", async () => {
    const deps = makeDeps({ claimReminders: vi.fn(async () => [booking(1)]) });
    const summary = await runInterviewNotices(deps, NOW);
    const [from, to] = deps.claimReminders.mock.calls[0];
    expect(from.toISOString()).toBe("2026-10-26T08:00:00.000Z");
    expect(to.toISOString()).toBe("2026-10-26T10:00:00.000Z");
    expect(summary).toMatchObject({ ok: true, remindersClaimed: 1, remindersSent: 2, remindersReleased: 0 });
    const byTo = new Map(deps.send.mock.calls.map((c) => [c[0].to, c[0]]));
    expect(byTo.get("joy@candidate-mail.example")!.subject).toBe("Reminder: your interview with Zimcrest is tomorrow");
    expect(byTo.get("hiring@zimcrest.example")!.subject).toBe("Reminder: your interview with Joy Akindele is tomorrow");
    for (const mail of byTo.values()) expect(mail.text).toContain("09:00 UTC");
    expect(byTo.get("joy@candidate-mail.example")!.text).not.toContain("hiring@zimcrest.example");
    expect(byTo.get("hiring@zimcrest.example")!.text).not.toContain("candidate-mail");
  });

  it("if NEITHER reminder went out the mark is released; if one did it is kept (nobody is reminded twice)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const none = makeDeps({ claimReminders: vi.fn(async () => [booking(1)]), send: vi.fn(async () => false) });
    expect(await runInterviewNotices(none, NOW)).toMatchObject({ ok: false, remindersReleased: 1 });
    expect(none.releaseReminder).toHaveBeenCalledWith("b1");
    const one = makeDeps({ claimReminders: vi.fn(async () => [booking(1)]), send: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false) });
    expect(await runInterviewNotices(one, NOW)).toMatchObject({ ok: true, remindersSent: 1, remindersReleased: 0 });
    expect(one.releaseReminder).not.toHaveBeenCalled();
  });

  it("a deleted employer member or candidate is simply not mailed; the other still is", async () => {
    const deps = makeDeps({ claimReminders: vi.fn(async () => [booking(1)]), context: vi.fn(async () => ({ ...ctx, employerEmail: null })) });
    const summary = await runInterviewNotices(deps, NOW);
    expect(deps.send.mock.calls.map((c) => c[0].to)).toEqual(["joy@candidate-mail.example"]);
    expect(summary.remindersSent).toBe(1);
  });
});

describe("runInterviewNotices: robustness", () => {
  it("a failing backstop sweep is reported but the notices still go out", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const deps = makeDeps({ sweep: vi.fn(async () => { throw new Error("db"); }), claimReminders: vi.fn(async () => [booking(1)]) });
    const summary = await runInterviewNotices(deps, NOW);
    expect(summary.ok).toBe(false);
    expect(summary.remindersSent).toBe(2);
  });

  it("reports the backstop counts", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const deps = makeDeps({ sweep: vi.fn(async () => ({ cancelled: 2, expired: 3 })) });
    expect(await runInterviewNotices(deps, NOW)).toMatchObject({ cancelledByBackstop: 2, expired: 3 });
  });

  it("the whole run never throws, even when every dependency does", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const boom = async () => { throw new Error("boom"); };
    const deps = makeDeps({ sweep: boom, claimCancellations: boom, claimReminders: boom });
    expect(await runInterviewNotices(deps, NOW)).toMatchObject({ ok: false });
  });
});
