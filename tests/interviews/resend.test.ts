import { afterEach, describe, expect, it, vi, type Mocked } from "vitest";
import { resendInterviewInvitation, type ResendDeps } from "@/lib/interviews/offer";

const input = { organizationId: "org-1", jobId: "job-1", applicationId: "app-1", userId: "user-1", senderEmail: "hiring@zimcrest.example" };
const open = { offerId: "offer-1", kind: "video", note: null as string | null, slotCount: 3, durationMinutes: 45, orgName: "Zimcrest", jobTitle: "Growth Marketer", candidateEmail: "joy@candidate-mail.example" as string | null, deletionRequestedAt: null as string | null };

function makeDeps(overrides: Partial<ResendDeps> = {}) {
  return {
    load: vi.fn(async () => open as typeof open | null),
    claimUnit: vi.fn(async () => "unit-1" as string | null),
    deliver: vi.fn(async () => true),
    freeUnit: vi.fn(async () => {}),
    pickUrl: (id: string) => `https://t.test/interviews/${id}`,
    ...overrides,
  } as unknown as Mocked<ResendDeps>;
}
afterEach(() => vi.restoreAllMocks());

describe("resendInterviewInvitation", () => {
  it("claims ONE unit, sends the invitation for the open offer, keeps the unit", async () => {
    const deps = makeDeps();
    expect(await resendInterviewInvitation(input, deps)).toEqual({ ok: true });
    expect(deps.claimUnit).toHaveBeenCalledTimes(1);
    expect(deps.deliver).toHaveBeenCalledTimes(1);
    expect(deps.deliver.mock.calls[0][0].text).toContain("https://t.test/interviews/offer-1");
    expect(deps.freeUnit).not.toHaveBeenCalled();
  });
  it("no open offer: nothing is claimed or sent", async () => {
    const deps = makeDeps({ load: vi.fn(async () => null) });
    expect(await resendInterviewInvitation(input, deps)).toMatchObject({ ok: false, reason: "not_found" });
    expect(deps.claimUnit).not.toHaveBeenCalled();
  });
  it("a full day refuses and sends nothing", async () => {
    const deps = makeDeps({ claimUnit: vi.fn(async () => null) });
    expect(await resendInterviewInvitation(input, deps)).toMatchObject({ ok: false, reason: "limit" });
    expect(deps.deliver).not.toHaveBeenCalled();
  });
  it("a failed send hands the unit back once", async () => {
    const deps = makeDeps({ deliver: vi.fn(async () => false) });
    expect(await resendInterviewInvitation(input, deps)).toMatchObject({ ok: false, reason: "send_failed" });
    expect(deps.freeUnit).toHaveBeenCalledTimes(1);
    expect(deps.freeUnit).toHaveBeenCalledWith("unit-1");
  });
  it("a deleting candidate, no address, or no sender address is refused before a unit is claimed", async () => {
    for (const [o, i] of [[{ ...open, deletionRequestedAt: "2026-10-01T00:00:00Z" }, input], [{ ...open, candidateEmail: null }, input], [open, { ...input, senderEmail: null }]] as const) {
      const deps = makeDeps({ load: vi.fn(async () => o) });
      expect(await resendInterviewInvitation(i, deps)).toMatchObject({ ok: false });
      expect(deps.claimUnit).not.toHaveBeenCalled();
    }
  });
});
