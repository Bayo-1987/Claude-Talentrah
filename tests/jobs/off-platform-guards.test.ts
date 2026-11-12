/**
 * PR-E4 gate 2: "off platform" means an e-mail address OR a career-site link. Every place that decides whether a job takes applications inside Talentrah asks takesApplicationsOffPlatform, and every
 * query behind such a decision selects apply_link_kind (a scan, below): the in-app apply core, Auto-Apply's scan, its review list, its confirm, the assessment-exercise upload, the feed's applicant
 * counts, the structured data, and the two employer pages. Each is checked for the link case here; the e-mail cases stay in the E2b tests, unmodified.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const h = vi.hoisted(() => ({
  posting: { apply_email: null, apply_link_kind: "company" } as Record<string, unknown> | null,
  writes: [] as string[],
  queued: { job_postings: { apply_email: null, apply_link_kind: "company" } } as unknown,
  rpcCalls: [] as unknown[],
}));

function chain(table: string): Record<string, unknown> {
  const result = () => {
    if (table === "job_postings") return { data: h.posting, error: null };
    if (table === "resumes") return { data: { id: "resume-1" }, error: null };
    if (table === "auto_apply_queue") return { data: h.queued, error: null };
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
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) }, from: (t: string) => chain(t) }) }));
vi.mock("@/lib/supabase/service-role", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/service-role")>()),
  createServiceRoleClient: () => ({
    rpc: async (name: string, args: unknown) => {
      h.rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
    from: (t: string) => chain(t),
  }),
}));
vi.mock("@/lib/applications/job-snapshot", () => ({ loadJobSnapshot: async () => null }));
vi.mock("@/lib/jobs/country-events", () => ({ logCountryDefaultEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/ads/promoted", () => ({ findActiveCampaignForJobPosting: async () => null, recordAdEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/matching/compute-and-store", () => ({ computeAndStoreApplicationMatchScore: vi.fn(async () => {}) }));
vi.mock("@/lib/analytics/posthog", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/analytics/posthog")>()), captureEvent: vi.fn() }));
vi.mock("@/lib/screening/farah-review", () => ({ runFarahScreeningReview: vi.fn(async () => {}) }));
vi.mock("@/lib/employer/new-applicants/instant", () => ({ notifyFirstApplicant: vi.fn(async () => {}) }));
vi.mock("@/lib/employer/new-applicants/deps", () => ({ defaultInstantDeps: () => ({}) }));
vi.mock("@/lib/credits/spend", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/credits/spend")>()), spendCredits: vi.fn() }));
vi.mock("@/lib/credits/gate-events", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/credits/gate-events")>()), logCreditGateEvent: vi.fn() }));
vi.mock("@/lib/passes/entitlement", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/passes/entitlement")>()), checkPassCoverage: async () => ({ covered: false, reason: "no_active_pass" }) }));

import { applyInAppAction, applyWithScreeningAction } from "@/lib/applications/actions";
import { confirmAutoApplyAction } from "@/lib/auto-apply/actions";
import { filterQueueableJobs } from "@/lib/auto-apply/queue";
import { isListableQueueRow } from "@/lib/auto-apply/queue-read";
import { takesApplicationsByLink, takesApplicationsOffPlatform, postingApplyLinkHost } from "@/lib/jobs/posting-apply-email";
import { buildJobPostingJsonLd } from "@/lib/seo/job-posting-jsonld";
import { AUTO_APPLY_MIN_SCORE } from "@/lib/auto-apply/config";

const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8").replace(/\s+/g, " ");
const LINK_MESSAGE = "This job takes applications on the company's own site.";

beforeEach(() => {
  h.posting = { apply_email: null, apply_link_kind: "company" };
  h.queued = { job_postings: { apply_email: null, apply_link_kind: "company" } };
  h.writes = [];
  h.rpcCalls = [];
});

describe("the helper", () => {
  it("takesApplicationsOffPlatform is an address OR a link kind; the link needs a kind, not an address", () => {
    expect(takesApplicationsOffPlatform({ apply_email: "careers@example.test" })).toBe(true);
    expect(takesApplicationsOffPlatform({ apply_link_kind: "company" })).toBe(true);
    expect(takesApplicationsOffPlatform({ apply_link_kind: "ats" })).toBe(true);
    expect(takesApplicationsOffPlatform({ apply_email: null, apply_link_kind: null })).toBe(false);
    expect(takesApplicationsOffPlatform({ apply_link_kind: "other" })).toBe(false);
    expect(takesApplicationsOffPlatform({})).toBe(false);
    expect(takesApplicationsOffPlatform(null)).toBe(false);
    expect(takesApplicationsByLink({ apply_link_kind: "ats" })).toBe(true);
    expect(takesApplicationsByLink({ apply_email: "careers@example.test" })).toBe(false);
  });
  it("postingApplyLinkHost returns the host only when there is a kind AND a plain host", () => {
    expect(postingApplyLinkHost({ apply_link_kind: "company", apply_link_host: "careers.acme.test" })).toBe("careers.acme.test");
    expect(postingApplyLinkHost({ apply_link_kind: null, apply_link_host: "careers.acme.test" })).toBeNull();
    expect(postingApplyLinkHost({ apply_link_kind: "company", apply_link_host: null })).toBeNull();
    expect(postingApplyLinkHost({ apply_link_kind: "company", apply_link_host: "has space.test" })).toBeNull();
    expect(postingApplyLinkHost({ apply_link_kind: "company", apply_link_host: "https://x.test/path" })).toBeNull();
    expect(postingApplyLinkHost(null)).toBeNull();
  });
});

describe("site 1: the in-app apply core (both actions)", () => {
  it("refuses a job with a career-site link, with the plain sentence, and writes nothing", async () => {
    await expect(applyInAppAction("job-1", "none")).rejects.toThrow(LINK_MESSAGE);
    await expect(applyWithScreeningAction("job-1", "none", [])).rejects.toThrow(LINK_MESSAGE);
    expect(h.writes).toEqual([]);
  });
  it("a job with no kind still applies (positive control)", async () => {
    h.posting = { apply_email: null, apply_link_kind: null };
    await applyInAppAction("job-1", "none");
    expect(h.writes).toContain("insert:applications");
  });
});

describe("sites 2 to 4: Auto-Apply", () => {
  it("the scan never queues such a job", () => {
    const kept = filterQueueableJobs([{ id: "l", sourceType: "internal", organizationId: "org-1", applyLinkKind: "ats" }, { id: "p", sourceType: "internal", organizationId: "org-1", applyLinkKind: null }], new Set(["org-1"]));
    expect(kept.map((j) => j.id)).toEqual(["p"]);
  });
  it("the review list and the banner do not offer a queue row whose job now has a link", () => {
    const live = { score: Math.max(AUTO_APPLY_MIN_SCORE, 90), explanation: { matchedSkills: ["a", "b", "c", "d", "e"], missingSkills: ["f"], seniorityAlignment: "match" } };
    expect(isListableQueueRow({ job_postings: { status: "open", apply_email: null, apply_link_kind: null } }, live as never)).toBe(true);
    expect(isListableQueueRow({ job_postings: { status: "open", apply_email: null, apply_link_kind: "company" } }, live as never)).toBe(false);
  });
  it("the confirm refuses it before anything is claimed, with a sentence that names no address", async () => {
    const result = await confirmAutoApplyAction("queue-1");
    expect(result).toEqual({ ok: false, error: "This job now takes applications on the company's own site, so it can't be confirmed here." });
    expect(h.rpcCalls).toEqual([]);
  });
});

describe("site 5: structured data", () => {
  it("directApply is false for a job with a link, and the data holds no link", () => {
    const job = { id: "job-1", organization_id: "org-1", title: "Support Lead", company_name: "Acme", description: "<p>Do support work for customers across Nigeria.</p>", location: "Lagos, Nigeria", work_type: "onsite", employment_type: "full_time", status: "open", source_type: "internal", external_url: null, apply_email: null, apply_link: "https://careers.acme.test/secret", apply_link_kind: "company", apply_link_host: "careers.acme.test", posted_at: new Date().toISOString(), expires_at: null, import_feed_id: null, organizations: { name: "Acme", website: null, logo_url: null } };
    const ld = buildJobPostingJsonLd(job as never);
    expect(ld).not.toBeNull();
    expect(ld?.directApply).toBe(false);
    expect(JSON.stringify(ld)).not.toContain("secret");
    expect(JSON.stringify(ld)).not.toContain("/go");
  });
});

describe("the scan: every guard-site query selects apply_link_kind, and each site asks the one helper", () => {
  const sites: Array<[string, string[]]> = [
    ["src/lib/applications/actions.ts", ['.select("apply_email, apply_link_kind")', "takesApplicationsOffPlatform("]],
    ["src/lib/auto-apply/queue.ts", ["import_feed_id, apply_email, apply_link_kind", "applyLinkKind: j.apply_link_kind", "takesApplicationsOffPlatform("]],
    ["src/lib/auto-apply/listable-pending.ts", ["job_postings(title, company_name, location, status, apply_email, apply_link_kind)"]],
    ["src/lib/auto-apply/queue-read.ts", ["apply_link_kind?: string | null", "takesApplicationsOffPlatform("]],
    ["src/lib/auto-apply/actions.ts", ['.select("job_postings(apply_email, apply_link_kind)")', "takesApplicationsOffPlatform("]],
    ["src/app/api/employer/job-assessment-exercise/route.ts", ["import_feed_id, apply_email, apply_link_kind", "takesApplicationsOffPlatform("]],
    ["src/lib/seo/job-posting-jsonld.ts", ["takesApplicationsOffPlatform("]],
    // The feed's applicant counts: both places that decide "does this card have a Talentrah applicant count" pass the WHOLE row, so the kind is seen.
    ["src/app/(app)/jobs/(feed)/page.tsx", ["!takesApplicationsOffPlatform(s.job)", "!takesApplicationsOffPlatform(job) && applicantCounts"]],
    ["src/app/employer/jobs/page.tsx", ["apply_email, apply_link_kind", "takesApplicationsOffPlatform("]],
    ["src/app/employer/jobs/[id]/applicants/page.tsx", ["apply_email, apply_link_kind", "takesApplicationsOffPlatform("]],
  ];
  it.each(sites)("%s", (file, needles) => {
    const src = read(file);
    for (const needle of needles) expect(src, needle).toContain(needle);
  });
  it("the two lists that feed the cards select the kind and the host, and NEVER the address", () => {
    const cols = read("src/lib/jobs/job-columns.ts");
    expect(cols).toMatch(/JOB_DETAIL_COLUMNS =\s*"[^"]*\bapply_link_kind\b[^"]*\bapply_link_host\b/);
    expect(cols).not.toMatch(/JOB_DETAIL_COLUMNS =\s*"[^"]*\bapply_link\b(?![_a-z])/);
    const feed = read("src/app/(app)/jobs/(feed)/page.tsx");
    const feedList = /const FEED_COLUMNS = "([^"]*)"/.exec(feed)?.[1] ?? "";
    expect(feedList).toMatch(/\bapply_link_kind\b/);
    expect(feedList).toMatch(/\bapply_link_host\b/);
    expect(feedList).not.toMatch(/\bapply_link\b(?![_a-z])/);
  });
});
