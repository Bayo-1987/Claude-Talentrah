/**
 * 0259 (employer_new_applicant_counts) may not be on a database yet, or may be refused, or the call may throw: the "N new" badge on Jobs Posted must then simply be ABSENT, the page must not throw, and the daily digest route
 * must answer its normal counts-only summary (it never needs that function). No database: the function is made to fail the way PostgREST reports a missing one (PGRST202).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PostedJobRow, type PostedJob } from "@/components/employer/posted-job-row";

const calls = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "employer_new_applicant_counts") return { data: null, error: { code: "PGRST202", message: "Could not find the function public.employer_new_applicant_counts(p_organization_id) in the schema cache" } };
      if (name === "claim_applicant_digest") return { data: [], error: null };
      return { data: null, error: { message: `unexpected ${name}` } };
    },
  }),
}));

const { loadNewApplicantCounts } = await import("@/lib/employer/new-applicants/read-notice");

afterEach(() => {
  calls.length = 0;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const missing = { code: "PGRST202", message: "Could not find the function public.employer_new_applicant_counts(p_organization_id) in the schema cache" };

describe("loadNewApplicantCounts: the badge data never breaks the page", () => {
  it("a missing function (PGRST202) answers an empty map and does not throw", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const counts = await loadNewApplicantCounts({ rpc: async () => ({ data: null, error: missing }) }, "org-1");
    expect(counts.size).toBe(0);
  });

  it("a call that THROWS also answers an empty map", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const counts = await loadNewApplicantCounts({ rpc: async () => { throw new Error("socket hang up"); } }, "org-1");
    expect(counts.size).toBe(0);
  });

  it("a normal answer becomes job id to count; no rows and a null answer are empty", async () => {
    const counts = await loadNewApplicantCounts({ rpc: async () => ({ data: [{ job_posting_id: "j1", new_count: 3 }, { job_posting_id: "j2", new_count: 1 }], error: null }) }, "org-1");
    expect(Object.fromEntries(counts)).toEqual({ j1: 3, j2: 1 });
    expect((await loadNewApplicantCounts({ rpc: async () => ({ data: [], error: null }) }, "org-1")).size).toBe(0);
    expect((await loadNewApplicantCounts({ rpc: async () => ({ data: null, error: null }) }, "org-1")).size).toBe(0);
  });

  it("the warning for a missing function carries the reason and nothing about people", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await loadNewApplicantCounts({ rpc: async () => ({ data: null, error: missing }) }, "org-1");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("no \"N new\" badges");
  });
});

describe("the Jobs Posted page and its row", () => {
  it("the page reads the counts only through the safe loader (a direct rpc call there would let a missing function break the page)", () => {
    const page = readFileSync(join(__dirname, "../../../src/app/employer/jobs/page.tsx"), "utf8");
    expect(page).toContain("loadNewApplicantCounts(");
    expect(page).not.toMatch(/rpc\(\s*"employer_new_applicant_counts"/);
  });

  it("with no counts at all the row has no badge and reads exactly as it did before", () => {
    const job: PostedJob = {
      id: "11111111-1111-1111-1111-111111111111", title: "Backend Engineer", location: "Lagos", status: "open", removalReason: null, postedAt: new Date().toISOString(),
      applicationCount: 5, workType: null, employmentType: null, unlistedAt: null, adminReviewRequestedAt: null, adminReviewDecision: null,
    };
    const html = renderToStaticMarkup(<PostedJobRow job={job} orgVerified={false} origin="https://talentrah.example" />);
    expect(html).toContain("5 applications");
    expect(html).not.toMatch(/\d+ new/);
  });
});

describe("the daily digest route when the counts function is missing", () => {
  it("answers 200 with its normal counts-only summary and never calls the counts function", async () => {
    vi.stubEnv("CRON_SECRET", "cron-value");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { GET } = await import("@/app/api/admin/send-new-applicant-digest/route");
    const response = await GET(new Request("https://t.test/api/admin/send-new-applicant-digest", { headers: { authorization: "Bearer cron-value" } }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { summary: Record<string, unknown> };
    expect(body.summary).toEqual({ ok: true, claimed: 0, organisations: 0, emailsSent: 0, emailsFailed: 0, released: 0 });
    expect(calls).not.toContain("employer_new_applicant_counts");
    expect(calls).toContain("claim_applicant_digest");
  });
});
