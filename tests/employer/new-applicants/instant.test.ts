import { afterEach, describe, expect, it, vi, type Mocked } from "vitest";
import { notifyFirstApplicant, type InstantDeps } from "@/lib/employer/new-applicants/instant";

function makeDeps(overrides: Partial<InstantDeps> = {}) {
  const deps = {
    claim: vi.fn(async () => ({ jobId: "job-1", organizationId: "org-1" }) as { jobId: string; organizationId: string } | null),
    recipients: vi.fn(async () => [
      { userId: "u1", email: "a@zimcrest.example", firstName: "Tolu", mode: "instant" },
      { userId: "u2", email: "b@zimcrest.example", firstName: "Ada", mode: "digest" },
    ]),
    context: vi.fn(async () => ({ applicantName: "Joy Akindele", jobTitle: "Growth Marketer" }) as { applicantName: string; jobTitle: string } | null),
    send: vi.fn(async () => true),
    release: vi.fn(async () => {}),
    ...overrides,
  };
  return deps as unknown as Mocked<InstantDeps>;
}

afterEach(() => vi.restoreAllMocks());

describe("notifyFirstApplicant", () => {
  it("claims the instant email once, emails ONLY the members on 'instant', and keeps the claim", async () => {
    const deps = makeDeps();
    expect(await notifyFirstApplicant("app-1", deps)).toEqual({ status: "sent", sent: 1 });
    expect(deps.claim).toHaveBeenCalledWith("app-1");
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.send.mock.calls[0][0].to).toBe("a@zimcrest.example");
    expect(deps.send.mock.calls[0][0].text).toContain("Joy Akindele applied for Growth Marketer.");
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("not the first applicant (or a QA applicant, or already announced): the claim returns nothing and nothing else happens", async () => {
    const deps = makeDeps({ claim: vi.fn(async () => null) });
    expect(await notifyFirstApplicant("app-1", deps)).toEqual({ status: "not_first", sent: 0 });
    expect(deps.recipients).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("nobody is on 'instant': nothing sent, the claim stays (the digest will carry it for the others)", async () => {
    const deps = makeDeps({ recipients: vi.fn(async () => [{ userId: "u2", email: "b@x.example", firstName: "Ada", mode: "digest" }]) });
    expect(await notifyFirstApplicant("app-1", deps)).toEqual({ status: "no_recipients", sent: 0 });
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("every send failed: the claim is RELEASED so the next digest carries it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps({ send: vi.fn(async () => false) });
    expect(await notifyFirstApplicant("app-1", deps)).toEqual({ status: "failed", sent: 0 });
    expect(deps.release).toHaveBeenCalledTimes(1);
    expect(deps.release).toHaveBeenCalledWith("app-1");
  });

  it("one of two instant recipients got it: the claim is kept (nobody gets it twice)", async () => {
    const deps = makeDeps({
      recipients: vi.fn(async () => [
        { userId: "u1", email: "a@x.example", firstName: "A", mode: "instant" },
        { userId: "u3", email: "c@x.example", firstName: "C", mode: "instant" },
      ]),
      send: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    });
    expect(await notifyFirstApplicant("app-1", deps)).toEqual({ status: "sent", sent: 1 });
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("missing context releases the claim and never throws; a throwing send counts as failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const noContext = makeDeps({ context: vi.fn(async () => null) });
    expect(await notifyFirstApplicant("app-1", noContext)).toMatchObject({ status: "failed" });
    expect(noContext.release).toHaveBeenCalledTimes(1);
    const throwing = makeDeps({ send: vi.fn(async () => { throw new Error("smtp"); }) });
    expect(await notifyFirstApplicant("app-1", throwing)).toMatchObject({ status: "failed" });
    const claimThrows = makeDeps({ claim: vi.fn(async () => { throw new Error("db"); }) });
    expect(await notifyFirstApplicant("app-1", claimThrows)).toMatchObject({ status: "failed" });
  });
});
