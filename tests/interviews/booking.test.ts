import { afterEach, describe, expect, it, vi, type Mocked } from "vitest";
import { bookInterviewSlot, reportNoneWork, type BookDeps, type NoneWorkDeps, type BookingContext } from "@/lib/interviews/booking";

const ctx: BookingContext = {
  orgName: "Zimcrest",
  jobTitle: "Growth Marketer",
  kind: "video",
  note: "Bring a laptop.",
  durationMinutes: 45,
  offerId: "offer-1",
  jobId: "job-1",
  applicationId: "app-1",
  candidateName: "Joy Akindele",
  candidateEmail: "joy@candidate-mail.example",
  employerEmail: "hiring@zimcrest.example",
};

function makeDeps(overrides: Partial<BookDeps> = {}) {
  const deps = {
    book: vi.fn(async () => ({ ok: true, outcome: "booked", bookingId: "booking-1" as string | null, startsAt: "2026-10-26T09:00:00Z" as string | null })),
    context: vi.fn(async () => ctx as BookingContext | null),
    deliver: vi.fn(async () => true),
    candidateUrl: (offerId: string) => `https://t.test/interviews/${offerId}`,
    employerUrl: (jobId: string, applicationId: string) => `https://t.test/employer/jobs/${jobId}/applicants/${applicationId}/schedule`,
    ...overrides,
  };
  return deps as unknown as Mocked<BookDeps>;
}

afterEach(() => vi.restoreAllMocks());

describe("bookInterviewSlot", () => {
  it("books through the database, then sends a confirmation with a calendar file to BOTH the candidate and the employer who made the offer", async () => {
    const deps = makeDeps();
    const result = await bookInterviewSlot({ userId: "cand-1", slotId: "slot-1", timeZone: "Europe/London" }, deps);
    expect(result).toEqual({ ok: true, startsAt: "2026-10-26T09:00:00Z" });
    expect(deps.book).toHaveBeenCalledWith({ userId: "cand-1", slotId: "slot-1" });
    expect(deps.deliver).toHaveBeenCalledTimes(2);
    const byRecipient = new Map(deps.deliver.mock.calls.map((c) => [c[0].to, c[0]]));
    const toCandidate = byRecipient.get("joy@candidate-mail.example")!;
    const toEmployer = byRecipient.get("hiring@zimcrest.example")!;
    expect(toCandidate.subject).toBe("Interview confirmed: Growth Marketer at Zimcrest");
    expect(toEmployer.subject).toContain("Joy Akindele");
    for (const mail of [toCandidate, toEmployer]) {
      expect(mail.attachments).toHaveLength(1);
      expect(mail.attachments[0].filename).toBe("interview.ics");
      expect(mail.attachments[0].content).toContain("DTSTART:20261026T090000Z");
      expect(mail.attachments[0].content).toContain("DTEND:20261026T094500Z");
    }
  });

  it("the candidate's email shows the time in THEIR zone (London after the clocks went back = GMT), the employer's in Lagos time, both with the UTC time", async () => {
    const deps = makeDeps();
    await bookInterviewSlot({ userId: "cand-1", slotId: "slot-1", timeZone: "Europe/London" }, deps);
    const byRecipient = new Map(deps.deliver.mock.calls.map((c) => [c[0].to, c[0]]));
    expect(byRecipient.get("joy@candidate-mail.example")!.text).toMatch(/09:00 to 09:45 GMT/);
    expect(byRecipient.get("hiring@zimcrest.example")!.text).toMatch(/10:00 to 10:45 GMT\+1/);
    for (const mail of byRecipient.values()) expect(mail.text).toContain("09:00 UTC");
  });

  it.each([
    ["slot_taken", "slot_taken", "That time was just taken"],
    ["offer_closed", "closed", "no longer open"],
    ["already_booked", "already_booked", "already booked"],
    ["too_late", "too_late", "already passed"],
    ["not_owner", "not_found", "couldn't find"],
    ["not_found", "not_found", "couldn't find"],
  ])("the database answer '%s' is '%s' with a plain message, and nobody is emailed", async (outcome, reason, fragment) => {
    const deps = makeDeps({ book: vi.fn(async () => ({ ok: false, outcome, bookingId: null, startsAt: null })) });
    const result = await bookInterviewSlot({ userId: "cand-1", slotId: "slot-1", timeZone: "Africa/Lagos" }, deps);
    expect(result).toMatchObject({ ok: false, reason });
    expect((result as { message: string }).message).toContain(fragment);
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it("a failed confirmation email never un-books: the booking stands and the result is still ok", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps({ deliver: vi.fn(async () => { throw new Error("smtp"); }) });
    expect(await bookInterviewSlot({ userId: "cand-1", slotId: "slot-1", timeZone: "Africa/Lagos" }, deps)).toMatchObject({ ok: true });
  });

  it("a database error is a failed attempt, not a thrown exception", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps({ book: vi.fn(async () => { throw new Error("db"); }) });
    expect(await bookInterviewSlot({ userId: "cand-1", slotId: "slot-1", timeZone: "Africa/Lagos" }, deps)).toMatchObject({ ok: false, reason: "failed" });
  });

  it("confirmations never carry the other person's email address", async () => {
    const deps = makeDeps();
    await bookInterviewSlot({ userId: "cand-1", slotId: "slot-1", timeZone: "Africa/Lagos" }, deps);
    const byRecipient = new Map(deps.deliver.mock.calls.map((c) => [c[0].to, c[0]]));
    expect(byRecipient.get("joy@candidate-mail.example")!.text + byRecipient.get("joy@candidate-mail.example")!.html).not.toContain("hiring@zimcrest.example");
    expect(byRecipient.get("hiring@zimcrest.example")!.text + byRecipient.get("hiring@zimcrest.example")!.html).not.toContain("candidate-mail");
  });
});

describe("reportNoneWork (none of these times work)", () => {
  const nwDeps = (overrides: Partial<NoneWorkDeps> = {}) =>
    ({
      load: vi.fn(async () => ({ state: "open", creatorUserId: "emp-1", creatorEmail: "hiring@zimcrest.example" as string | null, candidateName: "Joy Akindele", jobTitle: "Growth Marketer", jobId: "job-1", applicationId: "app-1" })),
      alreadyReported: vi.fn(async () => false),
      note: vi.fn(async () => {}),
      deliver: vi.fn(async () => true),
      scheduleUrl: (jobId: string, applicationId: string) => `https://t.test/employer/jobs/${jobId}/applicants/${applicationId}/schedule`,
      ...overrides,
    }) as unknown as Mocked<NoneWorkDeps>;

  it("notes it for the employer who made the offer and emails them once; it uses no allowance (there is no counting dependency at all)", async () => {
    const deps = nwDeps();
    expect(await reportNoneWork({ userId: "cand-1", offerId: "offer-1" }, deps)).toEqual({ ok: true });
    expect(deps.load).toHaveBeenCalledWith({ userId: "cand-1", offerId: "offer-1" });
    expect(deps.note).toHaveBeenCalledTimes(1);
    expect(deps.deliver).toHaveBeenCalledTimes(1);
    expect(deps.deliver.mock.calls[0][0].to).toBe("hiring@zimcrest.example");
  });

  it("an offer that is not theirs (or does not exist) is not_found: nothing is sent", async () => {
    const deps = nwDeps({ load: vi.fn(async () => null) });
    expect(await reportNoneWork({ userId: "cand-1", offerId: "x" }, deps)).toMatchObject({ ok: false, reason: "not_found" });
    expect(deps.deliver).not.toHaveBeenCalled();
    expect(deps.note).not.toHaveBeenCalled();
  });

  it("an offer that is no longer open is refused without telling the employer anything", async () => {
    const deps = nwDeps({ load: vi.fn(async () => ({ state: "booked", creatorUserId: "e", creatorEmail: "h@x.example", candidateName: "J", jobTitle: "T", jobId: "j", applicationId: "a" })) });
    expect(await reportNoneWork({ userId: "cand-1", offerId: "offer-1" }, deps)).toMatchObject({ ok: false, reason: "closed" });
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it("saying it twice tells the employer once", async () => {
    const deps = nwDeps({ alreadyReported: vi.fn(async () => true) });
    expect(await reportNoneWork({ userId: "cand-1", offerId: "offer-1" }, deps)).toEqual({ ok: true });
    expect(deps.note).not.toHaveBeenCalled();
    expect(deps.deliver).not.toHaveBeenCalled();
  });
});
