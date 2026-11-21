/**
 * The job page's "explore more" links are decoration. relevantJobLandingLinks backs them with one database call (job_landing_facet_counts); when that call failed,
 * the helper threw and the page awaited it, so a database stall took down the whole job page (production: 4 requests with "canceling statement due to statement
 * timeout" on 18, 19 and 21 Nov, plus 2 earlier ones with an empty message, all /jobs/[id] with the landing-page-links stack).
 *
 * relevantJobLandingLinks now catches any failure, logs ONE line and returns []. liveJobLandingLinks (the landing pages' own helper, which needs correct counts) is unchanged and still throws.
 * No database: the client is a stub.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { liveJobLandingLinks, relevantJobLandingLinks } from "@/lib/seo/landing-page-links";

const COUNTS = { remote_count: 12, nigeria_count: 0, ghana_count: 0, kenya_count: 0, south_africa_count: 0, lagos_count: 9, abuja_count: 0, nairobi_count: 0 };
const JOB = { work_type: "remote", location: "Lagos, Nigeria", external_source: null } as never;

type Answer = { data: unknown; error: { message: string } | null };
function client(answer: () => Promise<Answer>) {
  return { rpc: () => ({ single: answer }) } as never;
}
const ok = client(async () => ({ data: COUNTS, error: null }));
const answers = (message: string) => client(async () => ({ data: null, error: { message } }));
const rejects = (e: unknown) => client(async () => { throw e; });

afterEach(() => vi.restoreAllMocks());

describe("relevantJobLandingLinks fails soft", () => {
  it("POSITIVE CONTROL: with counts above the minimum it returns this job's links", async () => {
    const links = await relevantJobLandingLinks(ok, JOB);
    expect(links.map((l) => l.href)).toEqual(["/jobs/remote", "/jobs/in/lagos"]);
  });

  it("a statement timeout answer gives [] and exactly one log line carrying the message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(relevantJobLandingLinks(answers("canceling statement due to statement timeout"), JOB)).resolves.toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toBe("[seo] landing links unavailable: canceling statement due to statement timeout");
  });

  it("an error with an EMPTY message (the two older production errors) gives [] and one log line", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(relevantJobLandingLinks(answers(""), JOB)).resolves.toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toMatch(/^\[seo\] landing links unavailable/);
  });

  it("a rejected call (the client throws) gives [] and one log line", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(relevantJobLandingLinks(rejects(new TypeError("fetch failed")), JOB)).resolves.toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("fetch failed");
  });

  it("something thrown that is not an Error is still caught and logged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(relevantJobLandingLinks(rejects("boom"), JOB)).resolves.toEqual([]);
    expect(String(log.mock.calls[0][0])).toContain("boom");
  });

  it("a success logs nothing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await relevantJobLandingLinks(ok, JOB);
    expect(log).not.toHaveBeenCalled();
  });
});

describe("the landing pages' own helper is unchanged", () => {
  it("liveJobLandingLinks still THROWS on an error answer: a landing page must not show wrong counts", async () => {
    await expect(liveJobLandingLinks(answers("canceling statement due to statement timeout"))).rejects.toThrow("canceling statement due to statement timeout");
  });
});
