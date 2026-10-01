/**
 * send-492 (diagnosis, tests first) — the Auto-Apply review queue must only LIST what the page promises:
 * "Roles scoring 80%+ against your resume land here".
 *
 * WHAT PRODUCTION SHOWED. 13 pending rows, 11 of them snapshotted 2026-08-30 .. 2026-09-10, 9 shown as
 * "99% · Excellent*". Of those 9, 7 jobs are now CLOSED, and 8 have NO current `match_scores` row at all
 * (pruned when the job closed, or never recomputed), so the page had nothing to qualify the number with and
 * printed the stale snapshot. The thin-match gate (0164, 2026-09-15) and the queue-time filter were added AFTER
 * every one of those rows was queued, and the confirm-time recheck (0034/0164) is a different place from the one
 * the user reads.
 *
 * THE READ PATH today (src/app/(app)/auto-apply/page.tsx) selects every `status = 'pending'` row, takes
 * `match_score` from the queue row's SNAPSHOT, and looks the live explanation up only to decorate the badge; it
 * never checks the job is still open, never reads the live score, and treats a missing explanation as "nothing
 * to caveat". These tests call the REAL page with a mocked database and inspect the items it hands to the list.
 *
 * Fixtures are production-shaped, fictional values. RED on current code for every exclusion; the control (a
 * genuinely eligible open row) is GREEN and must stay listed, so hiding everything cannot pass.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { chainable } from "../credits/chainable";

const NON_THIN = { matchedSkills: ["sql", "agile", "scrum", "project management"], missingSkills: ["jira"], seniorityAlignment: "match" };
const THIN = { matchedSkills: ["project management"], missingSkills: [], seniorityAlignment: "below" };

interface Fixture {
  id: string;
  jobId: string;
  title: string;
  jobStatus: "open" | "closed";
  snapshot: number;
  live: { score: number; explanation: unknown } | null;
}
const FIXTURES: Fixture[] = [
  { id: "q-eligible", jobId: "j1", title: "Senior Product Manager", jobStatus: "open", snapshot: 92, live: { score: 92, explanation: NON_THIN } },
  { id: "q-closed", jobId: "j2", title: "QA Engineer (Pinewood)", jobStatus: "closed", snapshot: 100, live: null },
  { id: "q-live-low", jobId: "j3", title: "Product Auditor", jobStatus: "open", snapshot: 100, live: { score: 30, explanation: { matchedSkills: ["sql"], missingSkills: ["pos", "reconciliation", "google sheets"], seniorityAlignment: "match" } } },
  { id: "q-thin", jobId: "j4", title: "Global MEL Manager", jobStatus: "open", snapshot: 100, live: { score: 100, explanation: THIN } },
  { id: "q-no-live-row", jobId: "j5", title: "Marketing Manager", jobStatus: "open", snapshot: 100, live: null },
];

const queueRows = FIXTURES.map((f) => ({
  id: f.id,
  job_posting_id: f.jobId,
  status: "pending",
  match_score: f.snapshot,
  tier: f.snapshot >= 80 ? "excellent" : "fair",
  source_type: "external",
  queued_at: "2026-09-03T21:03:35Z",
  decided_at: null,
  credits_spent: 0,
  // `status` is included on the embedded job so a read that wants it can have it.
  job_postings: { title: f.title, company_name: "Example Co", location: "Lagos", status: f.jobStatus },
}));
const liveScoreRows = FIXTURES.filter((f) => f.live).map((f) => ({
  job_posting_id: f.jobId,
  score: f.live!.score,
  tier: f.live!.score >= 80 ? "excellent" : "fair",
  explanation: f.live!.explanation,
}));
const jobRows = FIXTURES.map((f) => ({ id: f.jobId, status: f.jobStatus, title: f.title }));

vi.mock("@/lib/auth/require-user", () => ({ requireUser: async () => ({ user: { id: "u1" }, profile: { id: "u1" } }) }));
vi.mock("@/lib/auto-apply/queue", () => ({
  getQuotaState: async () => ({ dailyRemaining: 5, freeRemaining: 5, nextSubmissionCostsCredits: false, nextSubmissionCovered: false }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (table: string) => {
      if (table === "auto_apply_queue") return chainable({ data: queueRows, error: null });
      if (table === "auto_apply_settings") return chainable({ data: { enabled: true }, error: null });
      if (table === "match_scores") return chainable({ data: liveScoreRows, error: null });
      if (table === "job_postings") return chainable({ data: jobRows, error: null });
      return chainable({ data: null, error: null });
    },
  }),
}));

const { default: AutoApplyPage } = await import("@/app/(app)/auto-apply/page");
const { AutoApplyQueueList } = await import("@/components/jobs/auto-apply-queue-list");

/** Finds the props the page hands to <AutoApplyQueueList>, without rendering anything. */
function findQueueItems(node: ReactNode): Array<{ id: string; matchScore: number }> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findQueueItems(child);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as ReactElement<{ children?: ReactNode; items?: Array<{ id: string; matchScore: number }> }>;
  if (el.type === AutoApplyQueueList) return el.props.items ?? [];
  return findQueueItems(el.props?.children);
}

async function listedIds(): Promise<string[]> {
  const tree = await AutoApplyPage();
  const items = findQueueItems(tree as ReactNode);
  expect(items, "the page did not render an <AutoApplyQueueList>").not.toBeNull();
  return items!.map((i) => i.id);
}

beforeEach(() => vi.clearAllMocks());

describe("the Auto-Apply review queue lists only what it promises", () => {
  it("CONTROL: a genuinely eligible row (open job, live score 92, not thin) is listed", async () => {
    expect(await listedIds()).toContain("q-eligible");
  });

  it("never lists a job that has closed", async () => {
    expect(await listedIds()).not.toContain("q-closed");
  });

  it("never lists a row whose LIVE score is below 80, whatever its snapshot said", async () => {
    expect(await listedIds()).not.toContain("q-live-low");
  });

  it("never lists a thin match (screenable-tag denominator <= 2), even with a live score of 100", async () => {
    expect(await listedIds()).not.toContain("q-thin");
  });

  it("never lists a row it has no live score for: with nothing to vouch for it, the stale snapshot is not shown as Excellent", async () => {
    expect(await listedIds()).not.toContain("q-no-live-row");
  });

  it("is not vacuous: of the five fixtures exactly the eligible one survives", async () => {
    expect(await listedIds()).toEqual(["q-eligible"]);
  });
});
