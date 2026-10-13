import { afterEach, describe, expect, it, vi, type Mocked } from "vitest";
import { createInterviewOffer, type OfferDeps, type OfferInput } from "@/lib/interviews/offer";

const NOW = new Date("2026-10-10T12:00:00Z");
const CANDIDATE_EMAIL = "joy.private@candidate-mail.example";

const input: OfferInput = {
  organizationId: "org-1",
  jobId: "job-1",
  applicationId: "app-1",
  userId: "user-1",
  senderEmail: "hiring@zimcrest.example",
  kind: "video",
  note: "Bring a laptop.",
  times: ["2026-10-20T09:00:00Z", "2026-10-21T09:00:00Z"],
  durationMinutes: 45,
  now: NOW,
};

function makeDeps(overrides: Partial<OfferDeps> = {}) {
  const deps = {
    context: vi.fn(async () => ({ orgName: "Zimcrest", jobTitle: "Growth Marketer", candidateEmail: CANDIDATE_EMAIL as string | null, deletionRequestedAt: null as string | null })),
    createOffer: vi.fn(async () => ({ ok: true, outcome: "created", offerId: "offer-1" as string | null, messageId: "msg-1" as string | null })),
    deliver: vi.fn(async () => true),
    freeUnit: vi.fn(async () => {}),
    pickUrl: (offerId: string) => `https://t.test/interviews/${offerId}`,
    ...overrides,
  };
  return deps as unknown as Mocked<OfferDeps>;
}

afterEach(() => vi.restoreAllMocks());

describe("createInterviewOffer", () => {
  it("creates the offer through the database (which spends the shared 20/day unit last) and emails the candidate ONE invitation with the signed-in link", async () => {
    const deps = makeDeps();
    const result = await createInterviewOffer(input, deps);
    expect(result).toEqual({ ok: true, offerId: "offer-1" });
    expect(deps.createOffer).toHaveBeenCalledWith({
      userId: "user-1",
      applicationId: "app-1",
      kind: "video",
      note: "Bring a laptop.",
      slots: [
        { starts_at: "2026-10-20T09:00:00.000Z", duration_minutes: 45 },
        { starts_at: "2026-10-21T09:00:00.000Z", duration_minutes: 45 },
      ],
    });
    expect(deps.deliver).toHaveBeenCalledTimes(1);
    const mail = deps.deliver.mock.calls[0][0];
    expect(mail.to).toBe(CANDIDATE_EMAIL);
    expect(mail.replyTo).toBe("hiring@zimcrest.example");
    expect(mail.text).toContain("https://t.test/interviews/offer-1");
    expect(deps.freeUnit).not.toHaveBeenCalled();
  });

  it("validates the times BEFORE anything is created or claimed", async () => {
    const deps = makeDeps();
    const result = await createInterviewOffer({ ...input, times: ["2026-10-20T09:00:00Z"] }, deps);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(deps.context).not.toHaveBeenCalled();
    expect(deps.createOffer).not.toHaveBeenCalled();
  });

  it("an unknown kind or an over-long note is refused before the database is asked", async () => {
    const deps = makeDeps();
    expect(await createInterviewOffer({ ...input, kind: "carrier pigeon" }, deps)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await createInterviewOffer({ ...input, note: "n".repeat(501) }, deps)).toMatchObject({ ok: false, reason: "invalid" });
    expect(deps.createOffer).not.toHaveBeenCalled();
  });

  it("an applicant who is not on this job and organisation is not_found: nothing created", async () => {
    const deps = makeDeps({ context: vi.fn(async () => null) });
    expect(await createInterviewOffer(input, deps)).toMatchObject({ ok: false, reason: "not_found" });
    expect(deps.createOffer).not.toHaveBeenCalled();
  });

  it("a candidate scheduled for deletion or with no address cannot be invited: nothing created, no unit spent", async () => {
    for (const ctx of [
      { orgName: "O", jobTitle: "J", candidateEmail: CANDIDATE_EMAIL, deletionRequestedAt: "2026-10-01T00:00:00Z" },
      { orgName: "O", jobTitle: "J", candidateEmail: null, deletionRequestedAt: null },
    ]) {
      const deps = makeDeps({ context: vi.fn(async () => ctx) });
      expect(await createInterviewOffer(input, deps)).toMatchObject({ ok: false, reason: "unavailable" });
      expect(deps.createOffer).not.toHaveBeenCalled();
    }
  });

  it("no sender address: refused before the database is asked", async () => {
    const deps = makeDeps();
    expect(await createInterviewOffer({ ...input, senderEmail: null }, deps)).toMatchObject({ ok: false, reason: "no_sender_email" });
    expect(deps.createOffer).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", "not_found"],
    ["job_not_open", "job_not_open"],
    ["application_closed", "application_closed"],
    ["already_open", "already_open"],
    ["rate_limited", "limit"],
    ["bad_slots", "invalid"],
    ["bad_kind", "invalid"],
    ["bad_note", "invalid"],
  ])("the database answer '%s' is refused as '%s' with a plain message and no email", async (outcome, reason) => {
    const deps = makeDeps({ createOffer: vi.fn(async () => ({ ok: false, outcome, offerId: null, messageId: null })) });
    const result = await createInterviewOffer(input, deps);
    expect(result).toMatchObject({ ok: false, reason });
    expect((result as { message: string }).message.length).toBeGreaterThan(10);
    expect(deps.deliver).not.toHaveBeenCalled();
    expect(deps.freeUnit).not.toHaveBeenCalled();
  });

  it("when the invitation email cannot be sent the claimed unit is FREED once, the offer stays (so it can be resent), and the employer is told", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps({ deliver: vi.fn(async () => false) });
    const result = await createInterviewOffer(input, deps);
    expect(result).toMatchObject({ ok: false, reason: "send_failed", offerId: "offer-1" });
    expect(deps.freeUnit).toHaveBeenCalledTimes(1);
    expect(deps.freeUnit).toHaveBeenCalledWith("msg-1");
  });

  it("a delivery that throws is the same as one that fails, and the candidate's address is in no result or log", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps({ deliver: vi.fn(async () => { throw new Error(`smtp refused ${CANDIDATE_EMAIL}`); }) });
    const result = await createInterviewOffer(input, deps);
    expect(result).toMatchObject({ ok: false, reason: "send_failed" });
    expect(JSON.stringify(result)).not.toContain("candidate-mail");
    expect(JSON.stringify(errors.mock.calls)).not.toContain("candidate-mail");
  });

  it("a database error is a failed attempt, never a thrown exception", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps({ createOffer: vi.fn(async () => { throw new Error("connection reset"); }) });
    expect(await createInterviewOffer(input, deps)).toMatchObject({ ok: false, reason: "failed" });
    expect(deps.deliver).not.toHaveBeenCalled();
  });
});
