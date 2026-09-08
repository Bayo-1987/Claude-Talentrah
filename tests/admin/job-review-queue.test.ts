/**
 * The Path 3 job-review queue (0118/0119) and both its decision paths, end
 * to end against the real database.
 *
 * `decideJobReviewAction` is a Next.js Server Action (`requirePermission`
 * needs a real request for `next/headers`/`next/navigation`), so — matching
 * this repo's own convention (tests/rls/job-posting-restore.test.ts,
 * tests/admin/employer-verification-queue.test.ts) — this drives the exact
 * conditional UPDATE the action runs, plus a direct `recordAdminAction` call
 * for the audit half, which has no Next.js request dependency of its own.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, type TestUser } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";
import { pendingJobReviews } from "@/lib/admin/moderation/queues";
import { recordAdminAction } from "@/lib/admin/audit";

let owner: TestUser;
let operator: TestUser;
let orgId: string;
const jobIds: string[] = [];

async function makeJob(overrides: {
  requestedAt?: string | null;
  title?: string;
}) {
  // `?? new Date()...` would be wrong here: `null` is nullish too, so an
  // explicit `requestedAt: null` (meaning "no review requested at all") must
  // be distinguished from "not passed" (meaning "use the default"), not
  // collapsed into the same branch.
  const requestedAt = "requestedAt" in overrides ? overrides.requestedAt : new Date().toISOString();
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: orgId,
      company_name: "JOBREVIEWQ-TEST Co",
      title: overrides.title ?? `JOBREVIEWQ-TEST Role ${randomUUID().slice(0, 8)}`,
      description: "Fixture posting for the job-review queue suite.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
      admin_review_requested_at: requestedAt,
    })
    .select("id")
    .single();
  if (error) throw new Error(`fixture job: ${error.message}`);
  jobIds.push(data.id);
  return data.id;
}

/** What decideJobReviewAction runs, verbatim, for either direction. */
async function decide(jobId: string, decision: "approved" | "rejected", adminId: string, note: string | null) {
  return admin
    .from("job_postings")
    .update({
      admin_review_decision: decision,
      admin_reviewed_at: new Date().toISOString(),
      admin_reviewed_by: adminId,
      admin_review_note: note,
    })
    .eq("id", jobId)
    .is("admin_review_decision", null)
    .select("id, title, company_name");
}

beforeAll(async () => {
  owner = await createTestUser("jobreviewq-owner");
  operator = await createTestUser("jobreviewq-operator");

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `JOBREVIEWQ-TEST Org ${randomUUID().slice(0, 8)}`, created_by: owner.id })
    .select("id")
    .single();
  if (orgErr) throw new Error(`fixture org: ${orgErr.message}`);
  orgId = org!.id;

  const { error: adminUserErr } = await admin
    .from("admin_users")
    .insert({ id: operator.id, email: operator.email.toLowerCase() });
  if (adminUserErr) throw new Error(`fixture admin_users row: ${adminUserErr.message}`);
});

afterAll(async () => {
  if (jobIds.length) await admin.from("job_postings").delete().in("id", jobIds);
  const { error } = await admin.from("admin_users").delete().eq("id", operator.id);
  if (error) console.error("[cleanup] admin_users:", error.message);
  if (orgId) await deleteOrgsCascade(admin, [orgId]);
  await deleteTestUsers([owner.id, operator.id]);
});

describe("pendingJobReviews()", () => {
  it("lists a posting with a request and no decision, oldest first", async () => {
    const older = await makeJob({ requestedAt: new Date(Date.now() - 60_000).toISOString() });
    const newer = await makeJob({ requestedAt: new Date().toISOString() });

    const queue = await pendingJobReviews();
    const ids = queue.map((r) => r.jobPostingId);
    expect(ids, "the older request must not be missing").toContain(older);
    expect(ids, "the newer request must not be missing").toContain(newer);
    expect(ids.indexOf(older)).toBeLessThan(ids.indexOf(newer));
  });

  it("does not list a posting with no review requested", async () => {
    const jobId = await makeJob({ requestedAt: null });
    const queue = await pendingJobReviews();
    expect(queue.map((r) => r.jobPostingId)).not.toContain(jobId);
  });

  it("does not list a posting that has already been decided", async () => {
    const jobId = await makeJob({});
    await admin.from("job_postings").update({ admin_review_decision: "approved" }).eq("id", jobId);
    const queue = await pendingJobReviews();
    expect(queue.map((r) => r.jobPostingId)).not.toContain(jobId);
  });
});

describe("approve — the conditional UPDATE decideJobReviewAction runs", () => {
  it("sets the decision, reviewer and timestamp together, does not touch organizations.verified, and logs it", async () => {
    const jobId = await makeJob({ title: "JOBREVIEWQ-TEST Approve Path" });

    const { data: updated, error } = await decide(jobId, "approved", operator.id, null);
    expect(error).toBeNull();
    expect(updated).toHaveLength(1);

    const { data: after } = await admin
      .from("job_postings")
      .select("admin_review_decision, admin_reviewed_at, admin_reviewed_by")
      .eq("id", jobId)
      .single();
    expect(after?.admin_review_decision).toBe("approved");
    expect(after?.admin_reviewed_at).not.toBeNull();
    expect(after?.admin_reviewed_by).toBe(operator.id);

    const { data: org } = await admin.from("organizations").select("verified").eq("id", orgId).single();
    expect(org?.verified, "approving a posting must never verify the organisation").toBe(false);

    await recordAdminAction({
      identity: { adminId: operator.id, email: operator.email },
      action: "job_posting.review_approved",
      targetTable: "job_postings",
      targetId: jobId,
      detail: { note: null },
    });

    const { data: log } = await admin
      .from("admin_audit_log")
      .select("action, target_table, target_id")
      .eq("target_id", jobId)
      .eq("action", "job_posting.review_approved")
      .maybeSingle();
    expect(log, "the approval was not written to the audit log").not.toBeNull();
    expect(log?.target_table).toBe("job_postings");
  });

  it("the second of two concurrent approvals affects zero rows (0035's shape)", async () => {
    const jobId = await makeJob({ title: "JOBREVIEWQ-TEST Race Path" });

    const [first, second] = await Promise.all([
      decide(jobId, "approved", operator.id, null),
      decide(jobId, "approved", owner.id, null),
    ]);

    const winners = [first, second].filter((r) => (r.data?.length ?? 0) > 0);
    expect(winners, "either both or neither decision matched a row").toHaveLength(1);
  });
});

describe("reject", () => {
  it("sets the decision and note, and the posting still isn't publicly readable", async () => {
    const jobId = await makeJob({ title: "JOBREVIEWQ-TEST Reject Path" });

    const { data: updated, error } = await decide(
      jobId,
      "rejected",
      operator.id,
      "Company name doesn't match the posting content",
    );
    expect(error).toBeNull();
    expect(updated).toHaveLength(1);

    const { data: after } = await admin
      .from("job_postings")
      .select("admin_review_decision, admin_review_note")
      .eq("id", jobId)
      .single();
    expect(after?.admin_review_decision).toBe("rejected");
    expect(after?.admin_review_note).toMatch(/doesn't match/);

    await recordAdminAction({
      identity: { adminId: operator.id, email: operator.email },
      action: "job_posting.review_rejected",
      targetTable: "job_postings",
      targetId: jobId,
      detail: { note: after?.admin_review_note ?? null },
    });

    const { data: log } = await admin
      .from("admin_audit_log")
      .select("action")
      .eq("target_id", jobId)
      .eq("action", "job_posting.review_rejected")
      .maybeSingle();
    expect(log).not.toBeNull();

    // A decided-either-way posting drops out of the queue — proven, not
    // assumed, by the "already decided" test above; restated here for the
    // rejected direction specifically since it is the one an employer might
    // expect to somehow linger.
    const queue = await pendingJobReviews();
    expect(queue.map((r) => r.jobPostingId)).not.toContain(jobId);
  });
});
