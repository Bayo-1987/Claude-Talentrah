import { afterEach, describe, expect, it, vi, type Mocked } from "vitest";
import { runNewApplicantDigest, type DigestDeps, type DigestRow } from "@/lib/employer/new-applicants/digest";

const row = (n: number, over: Partial<DigestRow> = {}): DigestRow => ({ notificationId: `n${n}`, applicationId: `a${n}`, jobId: "job-1", organizationId: "org-1", isFirst: false, alreadyAnnounced: false, ...over });
const NOW = new Date("2026-10-11T07:05:00Z");

function makeDeps(rows: DigestRow[], overrides: Partial<DigestDeps> = {}) {
  const deps = {
    claim: vi.fn(async () => rows),
    release: vi.fn(async () => {}),
    recipients: vi.fn(async () => [
      { userId: "u-instant", email: "i@x.example", firstName: "I", mode: "instant" },
      { userId: "u-digest", email: "d@x.example", firstName: "D", mode: "digest" },
    ]),
    names: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `Person ${id}`]))),
    jobTitles: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `Title of ${id}`]))),
    send: vi.fn(async () => true),
    ...overrides,
  };
  return deps as unknown as Mocked<DigestDeps>;
}

afterEach(() => vi.restoreAllMocks());

describe("runNewApplicantDigest", () => {
  it("claims everything older than now once and sends ONE email per recipient with every job grouped", async () => {
    const deps = makeDeps([row(1), row(2), row(3, { jobId: "job-2" })]);
    const summary = await runNewApplicantDigest(deps, NOW);
    expect(deps.claim).toHaveBeenCalledWith(NOW);
    expect(summary).toMatchObject({ claimed: 3, emailsSent: 2, emailsFailed: 0, released: 0 });
    expect(deps.send).toHaveBeenCalledTimes(2);
    const mail = deps.send.mock.calls.find((c) => c[0].to === "d@x.example")![0];
    expect(mail.subject).toBe("3 new applicants on Talentrah");
    expect(mail.text).toContain("Title of job-1: 2 new");
    expect(mail.text).toContain("Title of job-2: 1 new");
  });

  it("a member on 'instant' is not told again about the first applicant whose instant email already went out; a member on 'digest' is", async () => {
    const deps = makeDeps([row(1, { isFirst: true, alreadyAnnounced: true }), row(2)]);
    await runNewApplicantDigest(deps, NOW);
    const instant = deps.send.mock.calls.find((c) => c[0].to === "i@x.example")![0];
    const digest = deps.send.mock.calls.find((c) => c[0].to === "d@x.example")![0];
    expect(instant.subject).toBe("1 new applicant on Talentrah");
    expect(digest.subject).toBe("2 new applicants on Talentrah");
  });

  it("if the only rows are announced ones, the 'instant' member gets no digest email at all", async () => {
    const deps = makeDeps([row(1, { isFirst: true, alreadyAnnounced: true })], { recipients: vi.fn(async () => [{ userId: "u", email: "i@x.example", firstName: "I", mode: "instant" }]) });
    const summary = await runNewApplicantDigest(deps, NOW);
    expect(deps.send).not.toHaveBeenCalled();
    expect(summary.emailsSent).toBe(0);
  });

  it("an empty claim sends nothing and asks for nothing else", async () => {
    const deps = makeDeps([]);
    expect(await runNewApplicantDigest(deps, NOW)).toMatchObject({ claimed: 0, emailsSent: 0 });
    expect(deps.recipients).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("an organisation nobody can be emailed for (all 'off', QA or deleting) sends nothing and keeps the rows consumed", async () => {
    const deps = makeDeps([row(1)], { recipients: vi.fn(async () => []) });
    const summary = await runNewApplicantDigest(deps, NOW);
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.release).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ emailsSent: 0, released: 0 });
  });

  it("every send for an organisation failed: ITS rows are released for the next run, other organisations' rows are not", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rows = [row(1), row(2, { organizationId: "org-2", jobId: "job-9" })];
    const deps = makeDeps(rows, {
      send: vi.fn(async ({ text }: { text: string }) => !text.includes("Title of job-1")),
    });
    const summary = await runNewApplicantDigest(deps, NOW);
    expect(deps.release).toHaveBeenCalledTimes(1);
    expect(deps.release).toHaveBeenCalledWith(["n1"]);
    expect(summary).toMatchObject({ released: 1 });
  });

  it("one of an organisation's recipients got it: nothing is released (nobody gets it twice)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps([row(1)], { send: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false) });
    const summary = await runNewApplicantDigest(deps, NOW);
    expect(deps.release).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ emailsSent: 1, emailsFailed: 1 });
  });

  it("a throwing dependency never throws out of the run: it is counted and the rows are released", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps([row(1)], { names: vi.fn(async () => { throw new Error("db"); }) });
    const summary = await runNewApplicantDigest(deps, NOW);
    expect(summary.ok).toBe(false);
    expect(deps.release).toHaveBeenCalledWith(["n1"]);
  });
});
