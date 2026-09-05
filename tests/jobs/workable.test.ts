/**
 * Workable per-company widget-API ingestion — the fetcher itself (network
 * mocked; the end-to-end upsert/closure/cross-source-dedup behaviour against
 * the real database lives in tests/jobs/ingest-workable-dedup.test.ts, same
 * split as schema-org.test.ts / ingest-schema-org.test.ts).
 *
 * The response shapes below are trimmed real shapes captured against Kuda's
 * live board (`apply.workable.com/api/v1/widget/accounts/kuda?details=true`,
 * 2026-09-05) — see sources.config.ts's WORKABLE COMPANY BOARDS section for
 * the full ground-truth numbers this was verified against.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWorkableJobs } from "@/lib/jobs/sources/workable";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockAccount(payload: unknown, status = 200) {
  fetchMock.mockImplementation(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }));
}

/** One job entry, defaults matching Kuda's real on-site Lagos shape. */
function job(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    title: "Backend Engineer",
    shortcode: "E96B878F8B",
    employment_type: "Full-time",
    telecommuting: false,
    url: "https://apply.workable.com/j/E96B878F8B",
    application_url: "https://apply.workable.com/j/E96B878F8B/apply",
    published_on: "2026-07-31",
    created_at: "2024-03-06",
    country: "Nigeria",
    city: "Lagos",
    state: "Lagos",
    description: "<p>About Kuda</p><ul><li>Ship backend services.</li></ul>",
    ...overrides,
  };
}

describe("fetchWorkableJobs", () => {
  it("maps a real Kuda-shaped response to NormalizedJobPosting", async () => {
    mockAccount({ name: "Kuda Technologies Ltd", jobs: [job()] });

    const jobs = await fetchWorkableJobs("kuda", "Kuda Technologies Ltd");

    expect(jobs).toHaveLength(1);
    const posting = jobs[0];
    expect(posting.title).toBe("Backend Engineer");
    expect(posting.companyName).toBe("Kuda Technologies Ltd");
    expect(posting.location).toBe("Lagos, Lagos, Nigeria");
    expect(posting.employmentType).toBe("full_time");
    expect(posting.externalUrl).toBe("https://apply.workable.com/j/E96B878F8B");
    expect(posting.externalSource).toBe("workable");
    expect(posting.postedAt).toBe(new Date("2026-07-31").toISOString());
    expect(posting.description).toContain("About Kuda");
    expect(posting.description).toContain("Ship backend services");
    expect(posting.structuredJd).toBeDefined();
    expect(posting.dedupFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("prefers the API response's own company name over the config value, same as Greenhouse", async () => {
    mockAccount({ name: "Kuda Technologies Ltd", jobs: [job()] });
    const jobs = await fetchWorkableJobs("kuda", "Some Stale Config Name");
    expect(jobs[0].companyName).toBe("Kuda Technologies Ltd");
  });

  it("falls back to the config company name if the API omits its own", async () => {
    mockAccount({ jobs: [job()] });
    const jobs = await fetchWorkableJobs("kuda", "Kuda Technologies Ltd");
    expect(jobs[0].companyName).toBe("Kuda Technologies Ltd");
  });

  describe("workType — telecommuting is real, but only in the positive direction", () => {
    it("telecommuting: true is read directly as remote, no inference involved", async () => {
      mockAccount({
        name: "Kuda Technologies Ltd",
        jobs: [job({ title: "Vice President of Engineering", telecommuting: true, city: "Cape Town", state: "Western Cape", country: "South Africa" })],
      });
      const jobs = await fetchWorkableJobs("kuda", "Kuda Technologies Ltd");
      expect(jobs[0].workType).toBe("remote");
    });

    it("telecommuting: false with no remote/hybrid signal falls through to inferWorkType, which reads the real Lagos location as onsite", async () => {
      // `job()`'s default location (Lagos, Lagos, Nigeria) is a real place —
      // exactly the positive evidence inferWorkType's onsite branch requires.
      // This test's job is proving the FALL-THROUGH happens (telecommuting:
      // false is not itself treated as a negative "not remote" signal, it's
      // simply the absence of a positive one), not re-testing inferWorkType's
      // own branches — those are covered directly in infer-work-type.test.ts.
      mockAccount({ name: "Kuda Technologies Ltd", jobs: [job({ telecommuting: false })] });
      const jobs = await fetchWorkableJobs("kuda", "Kuda Technologies Ltd");
      expect(jobs[0].workType).toBe("onsite");
    });

    it("telecommuting: false but the title itself says Remote — inferWorkType still catches it", async () => {
      mockAccount({
        name: "Kuda Technologies Ltd",
        jobs: [job({ title: "Remote Clinical Psychologist (Nigeria)", telecommuting: false })],
      });
      const jobs = await fetchWorkableJobs("kuda", "Kuda Technologies Ltd");
      expect(jobs[0].workType).toBe("remote");
    });
  });

  describe("shortcode dedup — one requisition posted to multiple locations", () => {
    it("collapses two entries sharing a shortcode into one posting, first location wins", async () => {
      mockAccount({
        name: "Kuda Technologies Ltd",
        jobs: [
          job({
            title: "Vice President of Engineering",
            shortcode: "61F507FDD7",
            telecommuting: true,
            city: "Cape Town",
            state: "Western Cape",
            country: "South Africa",
          }),
          job({
            title: "Vice President of Engineering",
            shortcode: "61F507FDD7",
            telecommuting: true,
            city: "Johannesburg",
            state: "Gauteng",
            country: "South Africa",
          }),
        ],
      });

      const jobs = await fetchWorkableJobs("kuda", "Kuda Technologies Ltd");

      expect(jobs, "one requisition, not two — same shortcode must not become two rows").toHaveLength(1);
      expect(jobs[0].location).toBe("Cape Town, Western Cape, South Africa");
    });

    it("a genuinely different requisition with a different shortcode is NOT collapsed", async () => {
      mockAccount({
        name: "Kuda Technologies Ltd",
        jobs: [
          job({ title: "Senior iOS Engineer", shortcode: "0508B55843" }),
          job({ title: "Senior iOS Engineer - Lagos", shortcode: "392E453EC1" }),
        ],
      });
      const jobs = await fetchWorkableJobs("kuda", "Kuda Technologies Ltd");
      expect(jobs).toHaveLength(2);
    });
  });

  it("a job with no description (details=true omitted upstream) maps to an empty string, not a crash", async () => {
    const bare = job();
    delete (bare as Record<string, unknown>).description;
    mockAccount({ name: "Kuda Technologies Ltd", jobs: [bare] });
    const jobs = await fetchWorkableJobs("kuda", "Kuda Technologies Ltd");
    expect(jobs[0].description).toBe("");
    expect(jobs[0].structuredJd.skills).toEqual([]);
  });

  it("no salary or expiry fields exist on this payload shape — never fabricated", async () => {
    mockAccount({ name: "Kuda Technologies Ltd", jobs: [job()] });
    const jobs = await fetchWorkableJobs("kuda", "Kuda Technologies Ltd");
    expect(jobs[0].salaryMin).toBeUndefined();
    expect(jobs[0].salaryCurrency).toBeUndefined();
    expect(jobs[0].expiresAt).toBeUndefined();
  });

  it("throws a descriptive error on a non-2xx response, same failure mode as Greenhouse/Lever", async () => {
    mockAccount({}, 404);
    await expect(fetchWorkableJobs("not-a-real-account", "Nobody")).rejects.toThrow(
      /Workable account "not-a-real-account" returned 404/,
    );
  });

  it("an empty jobs array maps to an empty result, not an error", async () => {
    mockAccount({ name: "Kuda Technologies Ltd", jobs: [] });
    const jobs = await fetchWorkableJobs("kuda", "Kuda Technologies Ltd");
    expect(jobs).toEqual([]);
  });
});
