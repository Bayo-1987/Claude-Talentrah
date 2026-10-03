/**
 * send-5xx (draft; the A1 gap S3-24 found) — the "N matches are waiting for review" banner on /jobs counts what
 * /auto-apply LISTS, by the same rule.
 *
 * A1 (#654) made /auto-apply list a pending row only when something current vouches for it (job open, live score >= 80,
 * not thin) but left the /jobs banner counting every raw `status = 'pending'` row, so production said "13 matches are
 * waiting for review" over a queue page showing none. Both now read ONE function, `fetchListablePending`, so they cannot
 * disagree; this pins that, on the same fixtures as tests/auto-apply/queue-read-gate.test.tsx.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";
import { chainable } from "../credits/chainable";
import { loadModule } from "../support/load-module";

const NON_THIN = { matchedSkills: ["sql", "agile", "scrum", "project management"], missingSkills: ["jira"], seniorityAlignment: "match" };
const THIN = { matchedSkills: ["project management"], missingSkills: [], seniorityAlignment: "below" };
const FIXTURES = [
  { id: "q-eligible", jobId: "j1", status: "open", snapshot: 95, live: { score: 88, explanation: NON_THIN } },
  { id: "q-closed", jobId: "j2", status: "closed", snapshot: 100, live: null },
  { id: "q-live-low", jobId: "j3", status: "open", snapshot: 100, live: { score: 30, explanation: NON_THIN } },
  { id: "q-thin", jobId: "j4", status: "open", snapshot: 100, live: { score: 100, explanation: THIN } },
  { id: "q-no-live-row", jobId: "j5", status: "open", snapshot: 100, live: null },
] as const;
const queueRows = FIXTURES.map((f) => ({
  id: f.id, job_posting_id: f.jobId, status: "pending", match_score: f.snapshot, tier: "excellent", source_type: "external",
  queued_at: "2026-09-03T21:03:35Z", decided_at: null, credits_spent: 0,
  job_postings: { title: f.id, company_name: "Example Co", location: "Lagos", status: f.status },
}));
const liveRows = FIXTURES.filter((f) => f.live).map((f) => ({ job_posting_id: f.jobId, score: f.live!.score, explanation: f.live!.explanation }));

const client = {
  auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  from: (table: string) => {
    if (table === "auto_apply_queue") return chainable({ data: queueRows, error: null, count: queueRows.length });
    if (table === "auto_apply_settings") return chainable({ data: { enabled: true }, error: null });
    if (table === "match_scores") return chainable({ data: liveRows, error: null });
    return chainable({ data: null, error: null });
  },
};
vi.mock("@/lib/auth/require-user", () => ({ requireUser: async () => ({ user: { id: "u1" }, profile: { id: "u1" } }) }));
vi.mock("@/lib/auto-apply/queue", () => ({
  getQuotaState: async () => ({ dailyRemaining: 5, freeRemaining: 5, nextSubmissionCostsCredits: false, nextSubmissionCovered: false }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));

const { default: AutoApplyPage } = await import("@/app/(app)/auto-apply/page");
const { AutoApplyQueueList } = await import("@/components/jobs/auto-apply-queue-list");

function listedCount(node: ReactNode): number | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const c of node) {
      const hit = listedCount(c);
      if (hit !== null) return hit;
    }
    return null;
  }
  const el = node as ReactElement<{ children?: ReactNode; items?: unknown[] }>;
  if (el.type === AutoApplyQueueList) return (el.props.items ?? []).length;
  return listedCount(el.props?.children);
}

beforeEach(() => vi.clearAllMocks());

describe("the banner count equals the /auto-apply list length on the same fixtures", () => {
  it("both are 1 here (open, live 88, not thin); the closed, low, thin and no-live-row rows count for neither", async () => {
    const { fetchListablePending } = await loadModule<{ fetchListablePending(c: unknown, userId: string): Promise<unknown[]> }>(
      "@/lib/auto-apply/listable-pending",
    );
    const bannerCount = (await fetchListablePending(client, "u1")).length;
    const pageCount = listedCount((await AutoApplyPage()) as ReactNode);
    expect(pageCount).toBe(1);
    expect(bannerCount).toBe(pageCount);
  });

  it("the raw pending count (what the banner used to show) is 5, so this is not vacuous", () => {
    expect(queueRows.length).toBe(5);
  });
});

describe("the /jobs feed reads the shared function, not a raw head count", () => {
  const feed = () => readFileSync(path.join(process.cwd(), "src/app/(app)/jobs/(feed)/page.tsx"), "utf8");

  it("imports fetchListablePending and passes its length to the toggle", () => {
    const src = feed();
    expect(src).toMatch(/fetchListablePending\(/);
    expect(src).toMatch(/pendingCount=\{/);
  });

  it("no longer counts every pending row with a bare head-count query", () => {
    const src = feed();
    expect(src).not.toMatch(/\.from\("auto_apply_queue"\)\s*\n\s*\.select\("id", \{ count: "exact", head: true \}\)/);
  });
});
