import { afterEach, describe, expect, it, vi } from "vitest";
import { sendApplicantMessage, type SendDeps } from "@/lib/employer/applicant-messages/send";

const CANDIDATE_EMAIL = "joy.private@candidate-mail.example";
const SENDER_EMAIL = "hiring@zimcrest.example";

const input = {
  organizationId: "org-1",
  jobId: "job-1",
  applicationId: "app-1",
  senderUserId: "user-1",
  senderEmail: SENDER_EMAIL,
  kind: "invite_interview" as const,
  subject: "  Interview for Growth Marketer  ",
  body: "Hi Joy,\n\nCould we talk?",
};

function makeDeps(overrides: Partial<SendDeps> = {}) {
  const deps = {
    loadRecipient: vi.fn(async () => ({ userId: "cand-1", email: CANDIDATE_EMAIL, firstName: "Joy", deletionRequestedAt: null as string | null, jobTitle: "Growth Marketer", orgName: "Zimcrest" })),
    claim: vi.fn(async () => "msg-1" as string | null),
    deliver: vi.fn(async () => true),
    markSent: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    notifyCandidate: vi.fn(async () => {}),
    countToday: vi.fn(async () => 3),
    ...overrides,
  };
  return deps satisfies SendDeps;
}

afterEach(() => vi.restoreAllMocks());

describe("sendApplicantMessage", () => {
  it("claims a slot, delivers once to the candidate with Reply-To = the sender, marks it sent, and reports what is left today", async () => {
    const deps = makeDeps();
    const result = await sendApplicantMessage(input, deps);
    expect(result).toEqual({ ok: true, remaining: 17 });
    expect(deps.claim).toHaveBeenCalledTimes(1);
    expect(deps.claim).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1", applicationId: "app-1", jobId: "job-1", senderUserId: "user-1", kind: "invite_interview", subject: "Interview for Growth Marketer", body: "Hi Joy,\n\nCould we talk?" }));
    expect(deps.deliver).toHaveBeenCalledTimes(1);
    const sent = deps.deliver.mock.calls[0][0];
    expect(sent.to).toBe(CANDIDATE_EMAIL);
    expect(sent.replyTo).toBe(SENDER_EMAIL);
    expect(sent.fromName).toContain("Zimcrest");
    expect(sent.subject).toBe("Interview for Growth Marketer");
    expect(sent.text).toContain("Sent by Talentrah on behalf of Zimcrest");
    expect(deps.markSent).toHaveBeenCalledWith("msg-1");
    expect(deps.markFailed).not.toHaveBeenCalled();
  });

  it("the result never carries the candidate's address, in any field", async () => {
    const ok = await sendApplicantMessage(input, makeDeps());
    expect(JSON.stringify(ok)).not.toContain("candidate-mail");
    const failed = await sendApplicantMessage(input, makeDeps({ deliver: vi.fn(async () => false) }));
    expect(JSON.stringify(failed)).not.toContain("candidate-mail");
  });

  it("nothing is logged with the candidate's address when delivery fails or throws", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    await sendApplicantMessage(input, makeDeps({ deliver: vi.fn(async () => false) }));
    await sendApplicantMessage(input, makeDeps({ deliver: vi.fn(async () => { throw new Error(`smtp refused ${CANDIDATE_EMAIL}`); }) }));
    const logged = JSON.stringify([...errors.mock.calls, ...warns.mock.calls]);
    expect(logged).not.toContain("candidate-mail");
  });

  it("refuses an invalid message before anything is claimed or sent", async () => {
    const deps = makeDeps();
    const result = await sendApplicantMessage({ ...input, subject: "   " }, deps);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(deps.loadRecipient).not.toHaveBeenCalled();
    expect(deps.claim).not.toHaveBeenCalled();
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it("an application that is not on this job and organisation is 'not_found': nothing claimed, nothing sent", async () => {
    const deps = makeDeps({ loadRecipient: vi.fn(async () => null) });
    const result = await sendApplicantMessage(input, deps);
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    expect(deps.claim).not.toHaveBeenCalled();
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it("a candidate scheduled for deletion, or with no address, is 'unavailable': no slot is used and nothing is sent", async () => {
    for (const recipient of [
      { userId: "c", email: CANDIDATE_EMAIL, firstName: "Joy", deletionRequestedAt: "2026-10-01T00:00:00Z", jobTitle: "J", orgName: "O" },
      { userId: "c", email: null, firstName: "Joy", deletionRequestedAt: null, jobTitle: "J", orgName: "O" },
      { userId: "c", email: "   ", firstName: "Joy", deletionRequestedAt: null, jobTitle: "J", orgName: "O" },
    ]) {
      const deps = makeDeps({ loadRecipient: vi.fn(async () => recipient) });
      const result = await sendApplicantMessage(input, deps);
      expect(result).toMatchObject({ ok: false, reason: "unavailable" });
      expect(deps.claim).not.toHaveBeenCalled();
      expect(deps.deliver).not.toHaveBeenCalled();
    }
  });

  it("when the day is full the claim returns nothing and no email goes out", async () => {
    const deps = makeDeps({ claim: vi.fn(async () => null) });
    const result = await sendApplicantMessage(input, deps);
    expect(result).toMatchObject({ ok: false, reason: "limit" });
    expect(deps.deliver).not.toHaveBeenCalled();
    expect(deps.markSent).not.toHaveBeenCalled();
  });

  it("a database error while claiming is a failed send, NOT 'the day is full', and nothing is delivered", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps({ claim: vi.fn(async () => { throw new Error("connection reset"); }) });
    const result = await sendApplicantMessage(input, deps);
    expect(result).toMatchObject({ ok: false, reason: "send_failed" });
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it("a failed delivery gives the slot back ONCE (marked failed) and is never marked sent", async () => {
    const deps = makeDeps({ deliver: vi.fn(async () => false) });
    const result = await sendApplicantMessage(input, deps);
    expect(result).toMatchObject({ ok: false, reason: "send_failed" });
    expect(deps.markFailed).toHaveBeenCalledTimes(1);
    expect(deps.markFailed).toHaveBeenCalledWith("msg-1", expect.any(String));
    expect(deps.markSent).not.toHaveBeenCalled();
    expect(deps.notifyCandidate).not.toHaveBeenCalled();
  });

  it("a delivery that throws is the same as one that fails: the function itself never throws", async () => {
    const deps = makeDeps({ deliver: vi.fn(async () => { throw new Error("boom"); }) });
    const result = await sendApplicantMessage(input, deps);
    expect(result).toMatchObject({ ok: false, reason: "send_failed" });
    expect(deps.markFailed).toHaveBeenCalledTimes(1);
  });

  it("no sender address means no Reply-To to give the candidate: refused before a slot is used", async () => {
    const deps = makeDeps();
    const result = await sendApplicantMessage({ ...input, senderEmail: null }, deps);
    expect(result).toMatchObject({ ok: false, reason: "no_sender_email" });
    expect(deps.claim).not.toHaveBeenCalled();
  });

  it("the candidate gets an in-app note on success; a failure to write it does not undo the send", async () => {
    const deps = makeDeps({ notifyCandidate: vi.fn(async () => { throw new Error("db blip"); }) });
    const result = await sendApplicantMessage(input, deps);
    expect(result.ok).toBe(true);
    expect(deps.notifyCandidate).toHaveBeenCalledTimes(1);
    expect(deps.markFailed).not.toHaveBeenCalled();
  });

  it("the in-app note says who wrote and what about, without the message body", async () => {
    const deps = makeDeps();
    await sendApplicantMessage(input, deps);
    const note = deps.notifyCandidate.mock.calls[0][0];
    expect(note.userId).toBe("cand-1");
    expect(note.title + note.body).toContain("Zimcrest");
    expect(note.body).not.toContain("Could we talk");
  });

  it("an organisation-name that tries to break out of the From display name cannot", async () => {
    const deps = makeDeps({ loadRecipient: vi.fn(async () => ({ userId: "c", email: CANDIDATE_EMAIL, firstName: "Joy", deletionRequestedAt: null, jobTitle: "J", orgName: 'Evil" <ceo@bank.example>\r\nBcc: x@y.example' })) });
    await sendApplicantMessage(input, deps);
    const { fromName } = deps.deliver.mock.calls[0][0];
    expect(fromName).not.toMatch(/[<>"\r\n]/);
  });
});
