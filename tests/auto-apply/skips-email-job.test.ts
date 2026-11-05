/**
 * PR-E2b: Auto-Apply never works on a job whose applications arrive by email. There is no in-app submission for it, so a match for one is not queued (scan), not offered if a queue row already
 * exists from before the employer's switch (the review list and the /jobs banner share one rule), and not confirmable (the action re-reads the job before anything is claimed or charged).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const h = vi.hoisted(() => ({
  queued: { job_postings: { apply_email: null as string | null } } as unknown,
  rpcCalls: [] as unknown[],
}));

function chain(table: string): Record<string, unknown> {
  const result = () => (table === "auto_apply_queue" ? { data: h.queued, error: null } : { data: { external_url: "https://example.com/job/1" }, error: null });
  const c: Record<string, unknown> = new Proxy({}, {
    get: (_t, p) => {
      if (p === "then") return (res: (v: unknown) => unknown) => res(result());
      if (p === "maybeSingle" || p === "single") return async () => result();
      return () => c;
    },
  });
  return c;
}

vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) } }),
}));
vi.mock("@/lib/supabase/service-role", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/service-role")>()),
  createServiceRoleClient: () => ({
    rpc: async (name: string, args: unknown) => {
      h.rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
    from: (table: string) => chain(table),
  }),
}));
vi.mock("@/lib/credits/spend", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/credits/spend")>()), spendCredits: vi.fn() }));
vi.mock("@/lib/credits/gate-events", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/credits/gate-events")>()), logCreditGateEvent: vi.fn() }));
vi.mock("@/lib/passes/entitlement", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/passes/entitlement")>()), checkPassCoverage: async () => ({ covered: false, reason: "no_active_pass" }) }));
vi.mock("@/lib/applications/job-snapshot", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/applications/job-snapshot")>()), loadJobSnapshot: async () => null }));
vi.mock("@/lib/analytics/posthog", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/analytics/posthog")>()), captureEvent: vi.fn() }));

import { confirmAutoApplyAction } from "@/lib/auto-apply/actions";
import { filterQueueableJobs, type QueueableJobCandidate } from "@/lib/auto-apply/queue";
import { isListableQueueRow } from "@/lib/auto-apply/queue-read";
import { AUTO_APPLY_MIN_SCORE } from "@/lib/auto-apply/config";

const ADDRESS = "careers@example.test";
const verified = new Set(["org-1"]);
const candidate = (over: Partial<QueueableJobCandidate>): QueueableJobCandidate => ({ id: "j", sourceType: "internal", organizationId: "org-1", ...over });

describe("the scan: filterQueueableJobs", () => {
  it("drops a job that takes applications by email and keeps the rest (positive control)", () => {
    const kept = filterQueueableJobs(
      [candidate({ id: "email", applyEmail: ADDRESS }), candidate({ id: "plain" }), candidate({ id: "plain-null", applyEmail: null }), candidate({ id: "external", sourceType: "external", organizationId: null })],
      verified,
    );
    expect(kept.map((j) => j.id)).toEqual(["plain", "plain-null", "external"]);
  });
  it("an unusable stored value is no address: the job is still queueable", () => {
    expect(filterQueueableJobs([candidate({ id: "odd", applyEmail: "a, b" })], verified).map((j) => j.id)).toEqual(["odd"]);
  });
  it("the verified-organisation gate still applies on top", () => {
    expect(filterQueueableJobs([candidate({ id: "unverified", organizationId: "org-2" })], verified)).toEqual([]);
  });
  it("the scan's job read selects the column and hands it to the filter (source)", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/auto-apply/queue.ts"), "utf8").replace(/\s+/g, " ");
    expect(src).toContain('.select("id, source_type, status, organization_id, import_feed_id, apply_email")');
    expect(src).toContain("applyEmail: j.apply_email");
  });
});

describe("the review list and the /jobs banner: isListableQueueRow", () => {
  const goodScore = { score: Math.max(AUTO_APPLY_MIN_SCORE, 90), explanation: { matchedSkills: ["a", "b", "c", "d", "e"], missingSkills: ["f"], seniorityAlignment: "match" } };
  it("a queue row whose job now takes email is not offered, and the same row without an address is (positive control)", () => {
    expect(isListableQueueRow({ job_postings: { status: "open", apply_email: null } }, goodScore as never)).toBe(true);
    expect(isListableQueueRow({ job_postings: { status: "open", apply_email: ADDRESS } }, goodScore as never)).toBe(false);
  });
  it("the list read selects the column through the job embed (source)", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/auto-apply/listable-pending.ts"), "utf8");
    expect(src).toContain("job_postings(title, company_name, location, status, apply_email)");
  });
});

describe("confirmAutoApplyAction", () => {
  beforeEach(() => {
    h.rpcCalls = [];
    h.queued = { job_postings: { apply_email: null } };
  });
  it("refuses a queue row whose job now takes email BEFORE anything is claimed, with a plain sentence that has no address", async () => {
    h.queued = { job_postings: { apply_email: ADDRESS } };
    const result = await confirmAutoApplyAction("queue-1");
    expect(result).toEqual({ ok: false, error: "This job now takes applications by email, so it can't be confirmed here." });
    expect(h.rpcCalls).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("example.test");
  });
  it("a row for a job with no address still reaches the claim (positive control)", async () => {
    await confirmAutoApplyAction("queue-1");
    expect(h.rpcCalls).toHaveLength(1);
  });
});
