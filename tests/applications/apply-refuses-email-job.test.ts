/**
 * PR-E2b: a job whose applications arrive by email takes none inside Talentrah. The shared core of both apply actions (performInAppApply) refuses it BEFORE it writes anything, so a stale page or a
 * direct call cannot create an application. A job with no address still applies as before (positive control). Supabase and the helpers around the write are faked; the actions are the real ones.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  posting: { apply_email: null as string | null } as { apply_email: string | null } | null,
  postingError: null as null | { message: string },
  writes: [] as string[],
}));

function chain(table: string): Record<string, unknown> {
  const result = () => {
    if (table === "job_postings") return { data: h.postingError ? null : h.posting, error: h.postingError };
    if (table === "resumes") return { data: { id: "resume-1" }, error: null };
    return { data: null, error: null };
  };
  const c: Record<string, unknown> = new Proxy({}, {
    get: (_t, p) => {
      if (p === "then") return (res: (v: unknown) => unknown) => res(result());
      if (p === "maybeSingle") return async () => result();
      if (p === "single") return async () => ({ data: { id: "application-1" }, error: null });
      return () => {
        if (p === "insert" || p === "update" || p === "upsert" || p === "delete") h.writes.push(`${String(p)}:${table}`);
        return c;
      };
    },
  });
  return c;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) }, from: (t: string) => chain(t) }),
}));
vi.mock("@/lib/applications/job-snapshot", () => ({ loadJobSnapshot: async () => null }));
vi.mock("@/lib/jobs/country-events", () => ({ logCountryDefaultEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/ads/promoted", () => ({ findActiveCampaignForJobPosting: async () => null, recordAdEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/matching/compute-and-store", () => ({ computeAndStoreApplicationMatchScore: vi.fn(async () => {}) }));
vi.mock("@/lib/analytics/posthog", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/analytics/posthog")>()), captureEvent: vi.fn() }));
vi.mock("@/lib/screening/farah-review", () => ({ runFarahScreeningReview: vi.fn(async () => {}) }));
vi.mock("@/lib/employer/new-applicants/instant", () => ({ notifyFirstApplicant: vi.fn(async () => {}) }));
vi.mock("@/lib/employer/new-applicants/deps", () => ({ defaultInstantDeps: () => ({}) }));

import { applyInAppAction, applyWithScreeningAction } from "@/lib/applications/actions";

const MESSAGE = "This job takes applications by email.";

beforeEach(() => {
  h.posting = { apply_email: null };
  h.postingError = null;
  h.writes = [];
});

describe("an in-app apply to a job that takes applications by email", () => {
  it("applyInAppAction is refused with the plain sentence and writes nothing", async () => {
    h.posting = { apply_email: "careers@example.test" };
    await expect(applyInAppAction("job-1", "none")).rejects.toThrow(MESSAGE);
    expect(h.writes).toEqual([]);
  });

  it("applyWithScreeningAction (the screening and assessment path) is refused the same way and writes nothing", async () => {
    h.posting = { apply_email: "careers@example.test" };
    await expect(applyWithScreeningAction("job-1", "none", [])).rejects.toThrow(MESSAGE);
    expect(h.writes).toEqual([]);
  });

  it("the sentence never carries the address", async () => {
    h.posting = { apply_email: "careers@example.test" };
    await expect(applyInAppAction("job-1", "none")).rejects.not.toThrow(/example\.test/);
  });

  it("an unusable stored value is no address: the apply goes ahead", async () => {
    h.posting = { apply_email: "a@b.co, c@d.co" };
    await applyInAppAction("job-1", "none");
    expect(h.writes).toContain("insert:applications");
  });
});

describe("fail closed: when the read of the job's address fails, nothing is written", () => {
  const TRY = "Couldn't check this job. Please try again, or contact support if it keeps happening.";
  it("applyInAppAction throws the try-again line and writes nothing", async () => {
    h.postingError = { message: 'raw database text "zz_marker_6612"' };
    await expect(applyInAppAction("job-1", "none")).rejects.toThrow(TRY);
    expect(h.writes).toEqual([]);
  });
  it("applyWithScreeningAction does the same", async () => {
    h.postingError = { message: 'raw database text "zz_marker_6612"' };
    await expect(applyWithScreeningAction("job-1", "none", [])).rejects.toThrow(TRY);
    expect(h.writes).toEqual([]);
  });
  it("the database's own text never reaches the person", async () => {
    h.postingError = { message: 'raw database text "zz_marker_6612"' };
    await expect(applyInAppAction("job-1", "none")).rejects.not.toThrow(/zz_marker_6612/);
  });
});

describe("positive control: a job with no address applies as before", () => {
  it("records the application", async () => {
    h.posting = { apply_email: null };
    await applyInAppAction("job-1", "none");
    expect(h.writes).toContain("insert:applications");
  });

  it("a missing job row (read returned nothing) does not block the apply", async () => {
    h.posting = null;
    await applyInAppAction("job-1", "none");
    expect(h.writes).toContain("insert:applications");
  });
});
