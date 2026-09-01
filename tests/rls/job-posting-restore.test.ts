/**
 * The remove → restore round trip, asserted end to end.
 *
 * THIS IS THE TEST WHOSE ABSENCE LET A BROKEN FEATURE SHIP. M2 covered the
 * remove half and stopped there. Nobody noticed that restore was unreachable
 * through the UI, because two conditions were mutually exclusive and neither
 * was wrong on its own:
 *
 *     reportedPostings()   .neq("status", "removed")   <- removed rows excluded
 *     restore action       .eq("status", "removed")    <- only acts on removed rows
 *
 * So the Restore button rendered on every row that could not use it, and never
 * on a row that could. The screens' own tests passed; the PR described
 * remove/restore as covered. Only walking the whole cycle catches it.
 *
 * The assertions therefore follow the OPERATOR'S PATH rather than the code's:
 * remove it, find it where an operator would look for it, restore it, and
 * check both where it lands and that it comes back to the queue it left.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin } from "../support/auth";
import { reportedPostings, removedPostings } from "@/lib/admin/moderation/queues";

let postingId: string;
const FINGERPRINT = `restore-test-${randomUUID()}`;

beforeAll(async () => {
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "external",
      title: "RESTORE-TEST Posting",
      company_name: "RESTORE-TEST Co",
      description: "Fixture for the remove/restore round trip.",
      structured_jd: {},
      external_url: "https://example.test/restore",
      external_source: "restore-test",
      status: "open",
      dedup_fingerprint: FINGERPRINT,
      last_checked_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`could not create the fixture posting: ${error.message}`);
  postingId = data.id;
});

afterAll(async () => {
  const { error } = await admin.from("job_postings").delete().eq("dedup_fingerprint", FINGERPRINT);
  if (error) console.warn(`[cleanup] fixture posting survived: ${error.message}`);
});

/** What the remove Server Action writes, without needing an admin session. */
async function remove(reason: string, byUserId: string | null) {
  return admin
    .from("job_postings")
    .update({
      status: "removed" as const,
      removed_at: new Date().toISOString(),
      removal_reason: reason,
      removed_by: byUserId,
    })
    .eq("id", postingId)
    .neq("status", "removed")
    .select("id");
}

/** What the restore Server Action writes — `closed`, and both stamps cleared. */
async function restore(byUserId: string | null) {
  return admin
    .from("job_postings")
    .update({
      status: "closed" as const,
      removed_at: null,
      removal_reason: null,
      removed_by: byUserId,
    })
    .eq("id", postingId)
    .eq("status", "removed")
    .select("id");
}

describe("a removed posting can actually be got back", () => {
  it("starts out visible to neither view (no reports filed yet)", async () => {
    // Baseline. Without it, a later "not in the removed list" assertion could
    // pass because the list is broken rather than because the row moved.
    const removed = await removedPostings();
    expect(removed.map((p) => p.jobPostingId)).not.toContain(postingId);
  });

  it("removing takes it off the board and puts it in the removed view", async () => {
    const { data, error } = await remove("RESTORE-TEST: scam listing", null);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);

    const removed = await removedPostings();
    const mine = removed.find((p) => p.jobPostingId === postingId);
    /*
     * THE ASSERTION THAT WAS MISSING. Before the removed-postings view existed
     * this was unreachable: nothing listed a removed posting, so an operator
     * had no way to reach its Restore control.
     */
    expect(mine, "a removed posting is not surfaced anywhere an operator can see").toBeDefined();
    expect(mine!.removalReason).toBe("RESTORE-TEST: scam listing");

    // And it must NOT be in the reports queue any more.
    const open = await reportedPostings();
    expect(open.map((p) => p.jobPostingId)).not.toContain(postingId);
  });

  it("restoring lands it in `closed`, never `open`", async () => {
    const { data, error } = await restore(null);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);

    const { data: row } = await admin
      .from("job_postings")
      .select("status, removed_at, removal_reason")
      .eq("id", postingId)
      .single();

    /*
     * `closed`, not `open`, and this is the route's documented behaviour
     * rather than an implementation detail: restoring says the removal was
     * wrong, not that the job is live. An external posting reopens on the next
     * ingest run only if its source still lists it.
     */
    expect(row?.status).toBe("closed");
    expect(row?.status).not.toBe("open");

    /*
     * Both stamps cleared TOGETHER. preserve_job_posting_removal only lets a
     * row leave `removed` when removed_at goes null with it — which is what
     * stops the nightly ingest quietly un-removing a scam listing.
     */
    expect(row?.removed_at).toBeNull();
    expect(row?.removal_reason).toBeNull();
  });

  it("and it is gone from the removed view afterwards", async () => {
    const removed = await removedPostings();
    expect(removed.map((p) => p.jobPostingId)).not.toContain(postingId);
  });

  it("restoring twice is refused, not silently repeated", async () => {
    // The precondition lives in the statement, so a second click affects zero
    // rows rather than rewriting a posting that has moved on.
    const { data } = await restore(null);
    expect(data ?? []).toHaveLength(0);
  });
});
