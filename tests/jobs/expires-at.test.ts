/**
 * job_postings.expires_at (0053) — schema only, and the "only" is the part
 * worth pinning.
 *
 * The column exists so a source that publishes `validThrough` has somewhere to
 * put it. Nothing reads it: it does not close a posting, does not filter the
 * feed, and has no cron behind it. That is a decision, not an unfinished
 * state — closing a posting is already the ingest pipeline's job, and it has
 * an authority for it (`last_checked_at`, plus the empty-fetch guard). A
 * second, independent authority that can close the same row has a real
 * failure mode — an expiry the employer forgot to extend quietly removing a
 * job the board is still advertising — and deserves its own decision.
 *
 * Three things would undo that decision quietly, so all three are pinned:
 *
 *   1. A DEFAULT. Any default is a guess recorded as if a source had stated
 *      it, and it makes "unknown" indistinguishable from "known and far away"
 *      permanently — no later migration can separate them again.
 *   2. NOT NULL. The same collapse, enforced harder.
 *   3. Anything closing an EXTERNAL row on expiry — see below.
 *
 * 1 and 2 are asserted behaviourally rather than through the catalog, because
 * behaviour is what a caller actually meets: a DEFAULT makes the first test's
 * insert come back non-null, and NOT NULL makes it fail outright.
 *
 * ── WHAT CHANGED, AND WHAT DID NOT ───────────────────────────────────────
 *
 * This file used to assert "nothing acts on it yet" for every posting, and
 * warned that the day it failed, the withheld authority had been added and
 * must not arrive as a side effect. It has now been added — deliberately,
 * for INTERNAL postings only, because the employer job form now offers an
 * expiry and a control that does nothing is worse than no control. See
 * src/lib/jobs/expiry.ts for the full reasoning.
 *
 * The original objection is untouched and still pinned. It was specifically
 * about a second authority contradicting the board on a row the board still
 * serves, and that can only happen for EXTERNAL postings. An internal posting
 * has no board: the employer typed the posting and typed the date, so nothing
 * else claims the row. So the external case below is not a leftover — it is
 * the half of the decision that was kept, and it should still fail loudly if
 * someone widens the sweep.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { closeExpiredInternalPostings } from "@/lib/jobs/expiry";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";

const created: string[] = [];

async function makePosting(over: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "external",
      company_name: "EXPIRES-TEST Co",
      title: "EXPIRES-TEST Role",
      description: "Fixture posting owned by tests/jobs/expires-at.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
      external_source: "expires-at-test",
      external_url: `https://example.test/${randomUUID()}`,
      ...over,
    })
    .select("id, expires_at, status")
    .single();
  if (error || !data) throw new Error(`Could not create fixture posting: ${error?.message}`);
  created.push(data.id);
  return data;
}

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function readPosting(id: string) {
  const { data, error } = await admin
    .from("job_postings")
    .select("status, expires_at")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error(`Could not read posting ${id}: ${error?.message}`);
  return data;
}

/**
 * An internal posting REQUIRES an organization_id — 0000's
 * job_postings_internal_has_org check enforces the pairing — so these tests
 * cannot reuse the external fixture shape. An organisation in turn requires a
 * real `created_by` user, hence the throwaway account.
 */
async function makeOrg() {
  const user = await createTestUser("expires-at");
  createdUsers.push(user.id);

  const { data, error } = await admin
    .from("organizations")
    .insert({ name: `EXPIRES-TEST Org ${randomUUID()}`, created_by: user.id, verified: false })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not create fixture org: ${error?.message}`);
  createdOrgs.push(data.id);
  return data.id;
}

const createdOrgs: string[] = [];
const createdUsers: string[] = [];

afterAll(async () => {
  if (created.length === 0) return;
  // A rejected delete RESOLVES with an error rather than throwing — the
  // failure mode this repo has now hit five times, each found somewhere
  // unrelated and much later. Report it.
  const { error } = await admin.from("job_postings").delete().in("id", created);
  if (error) throw new Error(`expires-at cleanup failed, rows left behind: ${error.message}`);

  /*
   * Postings first, then the shared cascade helper, then the users. The
   * job_postings -> organizations FK is NO ACTION, not CASCADE, so an org
   * that still has a posting cannot be deleted — and a refused delete
   * RESOLVES with an error rather than throwing, which is how test orgs piled
   * up in production for weeks while every hook reported success.
   * deleteTestOrgs/deleteTestUsers report; a hand-rolled delete here would
   * re-create exactly that bug.
   */
  if (createdOrgs.length > 0) await deleteTestOrgs(createdOrgs);
  if (createdUsers.length > 0) await deleteTestUsers(createdUsers);
});

describe("the column records a fact; it does not invent one", () => {
  it("comes back null when nothing stated an expiry", async () => {
    // Fails if a DEFAULT is ever added, and errors if the column is made
    // NOT NULL — the two ways the "unknown" case gets collapsed.
    const row = await makePosting();
    expect(row.expires_at).toBeNull();
  });

  it("stores a real expiry when a source does state one", async () => {
    const when = "2027-01-31T00:00:00.000Z";
    const row = await makePosting({ expires_at: when });
    expect(row.expires_at).not.toBeNull();
    expect(new Date(row.expires_at!).toISOString()).toBe(when);
  });
});

describe("the expiry sweep, and the line it does not cross", () => {
  it("closes an INTERNAL posting whose employer-set expiry has passed", async () => {
    const org = await makeOrg();
    const row = await makePosting({
      source_type: "internal",
      organization_id: org,
      external_source: null,
      external_url: null,
      expires_at: daysFromNow(-1),
    });

    const swept = await closeExpiredInternalPostings();
    expect(swept.ids).toContain(row.id);

    const after = await readPosting(row.id);
    expect(after.status).toBe("closed");
  });

  it("leaves an INTERNAL posting whose expiry is still ahead alone", async () => {
    const org = await makeOrg();
    const row = await makePosting({
      source_type: "internal",
      organization_id: org,
      external_source: null,
      external_url: null,
      expires_at: daysFromNow(30),
    });

    await closeExpiredInternalPostings();
    expect((await readPosting(row.id)).status).toBe("open");
  });

  it("leaves an INTERNAL posting with NO expiry alone", async () => {
    /*
     * The one that would break silently. In PostgREST a comparison against
     * NULL yields NULL, not false — so this passes for a real reason, but if
     * the sweep were ever rewritten to coalesce a missing expiry to a date,
     * every no-expiry posting in the product would close overnight.
     */
    const org = await makeOrg();
    const row = await makePosting({
      source_type: "internal",
      organization_id: org,
      external_source: null,
      external_url: null,
    });

    await closeExpiredInternalPostings();
    expect((await readPosting(row.id)).status).toBe("open");
  });

  it("a posting whose expiry passed two years ago is STILL open when it is external", async () => {
    /*
     * The half of 0053's decision that was kept. If this ever fails, the
     * sweep has been widened to overrule the board on rows the board still
     * serves — which is the exact failure 0053 named. That may one day be
     * right, but it must be argued, not inherited.
     */
    const row = await makePosting({ expires_at: daysFromNow(-730) });

    await closeExpiredInternalPostings();

    const after = await readPosting(row.id);
    expect(after.status).toBe("open");
    expect(after.expires_at).not.toBeNull();
  });
});
