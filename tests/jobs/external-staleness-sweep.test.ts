/**
 * closeStaleExternalPostings (src/lib/jobs/expiry.ts) — the 72-hour backstop
 * for external postings, founder decision alongside scaling the source list
 * and the 3-hourly ingest cadence.
 *
 * WHY THIS IS A SEPARATE MECHANISM FROM THE PRESENCE-DRIVEN SWEEP IN
 * ingest.ts, not a replacement for it: that sweep only ever runs for an
 * `external_source` key still present in `JOB_SOURCES` today, and skips
 * closure entirely on any run whose fetch came back empty (an empty response
 * is not evidence, per its own comment). A source removed from config, or one
 * that stays broken for days, leaves its old rows `open` with nothing left to
 * ever re-visit them. This sweep is the backstop for exactly that gap: it
 * closes on staleness of `last_checked_at` directly, independent of whether
 * any source config still claims the row.
 *
 * MANUAL IMPORTS (external_source starting "manual-", e.g. the jobs-sheet import): nothing re-confirms them, so the 72-hour rule would close every one of them
 * three days after insert. The 72-hour rule therefore skips them (a NULL source still counts as "not manual"), and they close on their own stated `expires_at`
 * instead, the one case where an external row's expires_at is the authority.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { closeStaleExternalPostings, EXTERNAL_STALE_AFTER_HOURS, MANUAL_IMPORT_SOURCE_PREFIX } from "@/lib/jobs/expiry";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";
import { runCleanups, mustDelete } from "../support/teardown";

const created: string[] = [];
const createdOrgs: string[] = [];
const createdUsers: string[] = [];

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

async function makeExternalPosting(over: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "external",
      company_name: "STALE-SWEEP-TEST Co",
      title: `STALE-SWEEP-TEST Role ${randomUUID().slice(0, 8)}`,
      description: "Fixture posting owned by tests/jobs/external-staleness-sweep.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
      external_source: "stale-sweep-test",
      external_url: `https://example.test/${randomUUID()}`,
      ...over,
    })
    .select("id, status, last_checked_at")
    .single();
  if (error || !data) throw new Error(`Could not create fixture posting: ${error?.message}`);
  created.push(data.id);
  return data;
}

/** Internal postings need a real org (job_postings_internal_has_org). */
async function makeInternalPosting(over: Record<string, unknown> = {}) {
  const user = await createTestUser("stale-sweep");
  createdUsers.push(user.id);
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: `STALE-SWEEP-TEST Org ${randomUUID()}`, created_by: user.id, verified: false })
    .select("id")
    .single();
  if (orgError || !org) throw new Error(`Could not create fixture org: ${orgError?.message}`);
  createdOrgs.push(org.id);

  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: org.id,
      company_name: "STALE-SWEEP-TEST Co",
      title: `STALE-SWEEP-TEST Internal Role ${randomUUID().slice(0, 8)}`,
      description: "Fixture posting owned by tests/jobs/external-staleness-sweep.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
      ...over,
    })
    .select("id, status")
    .single();
  if (error || !data) throw new Error(`Could not create fixture posting: ${error?.message}`);
  created.push(data.id);
  return data;
}

async function readPosting(id: string) {
  const { data, error } = await admin.from("job_postings").select("status, closed_at").eq("id", id).single();
  if (error || !data) throw new Error(`Could not read posting ${id}: ${error?.message}`);
  return data;
}

afterAll(async () => {
  if (created.length === 0) return;
  await runCleanups(
    ["postings", async () => {
      await mustDelete("job_postings", admin.from("job_postings").delete().in("id", created));
    }],
    ["organisations", async () => {
      if (createdOrgs.length > 0) await deleteTestOrgs(createdOrgs);
    }],
    ["users", async () => {
      if (createdUsers.length > 0) await deleteTestUsers(createdUsers);
    }],
  );
});

describe("the 72-hour external staleness sweep", () => {
  it("leaves an external posting seen recently open", async () => {
    const row = await makeExternalPosting({ last_checked_at: hoursAgo(1) });
    await closeStaleExternalPostings();
    expect((await readPosting(row.id)).status).toBe("open");
  });

  it("leaves an external posting right at the edge of the window open", async () => {
    // Just inside the window (71 hours) — not yet stale.
    const row = await makeExternalPosting({ last_checked_at: hoursAgo(EXTERNAL_STALE_AFTER_HOURS - 1) });
    await closeStaleExternalPostings();
    expect((await readPosting(row.id)).status).toBe("open");
  });

  it("closes an external posting not seen in over 72 hours", async () => {
    const row = await makeExternalPosting({ last_checked_at: hoursAgo(EXTERNAL_STALE_AFTER_HOURS + 1) });
    const swept = await closeStaleExternalPostings();
    expect(swept.ids).toContain(row.id);
    expect((await readPosting(row.id)).status).toBe("closed");
  });

  it("closes an external posting not seen in weeks", async () => {
    const row = await makeExternalPosting({ last_checked_at: hoursAgo(24 * 30) });
    await closeStaleExternalPostings();
    expect((await readPosting(row.id)).status).toBe("closed");
  });

  it("never emits or touches expires_at — this is a status-only closure", async () => {
    // The whole point of the founder's instruction: markup absence stays
    // absent. Confirm the sweep does not invent a validThrough on its way
    // through by writing to expires_at.
    const row = await makeExternalPosting({ last_checked_at: hoursAgo(EXTERNAL_STALE_AFTER_HOURS + 5) });
    await closeStaleExternalPostings();
    const { data } = await admin.from("job_postings").select("expires_at").eq("id", row.id).single();
    expect(data?.expires_at).toBeNull();
  });

  it("leaves an ALREADY CLOSED external posting alone (nothing to re-close, no spurious inclusion)", async () => {
    const row = await makeExternalPosting({
      last_checked_at: hoursAgo(EXTERNAL_STALE_AFTER_HOURS + 1),
      status: "closed",
    });
    const swept = await closeStaleExternalPostings();
    expect(swept.ids).not.toContain(row.id);
  });

  it("INTERNAL postings are never touched, however stale their last_checked_at", async () => {
    // The line this rule must not cross: an internal posting's last_checked_at
    // is set once by the employer's own write and never revisited — ageing it
    // would eventually close every internal posting on the board for a reason
    // that has nothing to do with whether the role is still open.
    const row = await makeInternalPosting({ last_checked_at: hoursAgo(24 * 90) });
    const swept = await closeStaleExternalPostings();
    expect(swept.ids).not.toContain(row.id);
    expect((await readPosting(row.id)).status).toBe("open");
  });
});

function hoursAhead(hours: number) {
  return hoursAgo(-hours);
}

describe("the 72-hour rule is for sourced rows: a manual import is not closed by it", () => {
  const STALE = EXTERNAL_STALE_AFTER_HOURS + 28; // 100 hours

  it("the prefix is exactly 'manual-'", () => {
    expect(MANUAL_IMPORT_SOURCE_PREFIX).toBe("manual-");
  });

  it("a manual-sheet row last checked 100 hours ago stays open", async () => {
    const row = await makeExternalPosting({ external_source: "manual-sheet-2026-11-02", last_checked_at: hoursAgo(STALE) });
    const swept = await closeStaleExternalPostings();
    expect(swept.ids).not.toContain(row.id);
    expect((await readPosting(row.id)).status).toBe("open");
  });

  it("any other manual- key is skipped too, and a key that merely contains 'manual' somewhere else is not", async () => {
    const manual = await makeExternalPosting({ external_source: "manual-other-import", last_checked_at: hoursAgo(STALE) });
    const lookalike = await makeExternalPosting({ external_source: "not-manual-sheet", last_checked_at: hoursAgo(STALE) });
    const lookalike2 = await makeExternalPosting({ external_source: "manual", last_checked_at: hoursAgo(STALE) });
    await closeStaleExternalPostings();
    expect((await readPosting(manual.id)).status).toBe("open");
    expect((await readPosting(lookalike.id)).status).toBe("closed");
    expect((await readPosting(lookalike2.id)).status).toBe("closed");
  });

  it("an external row with NO source (NULL) older than 72 hours still closes (a bare NOT LIKE would silently skip it)", async () => {
    const row = await makeExternalPosting({ external_source: null, last_checked_at: hoursAgo(EXTERNAL_STALE_AFTER_HOURS + 1) });
    const swept = await closeStaleExternalPostings();
    expect(swept.ids).toContain(row.id);
    expect((await readPosting(row.id)).status).toBe("closed");
  });

  it.each(["greenhouse", "lever", "workable", "schema-org:workable-nigeria"])("a %s row older than 72 hours still closes", async (source) => {
    const row = await makeExternalPosting({ external_source: source, last_checked_at: hoursAgo(EXTERNAL_STALE_AFTER_HOURS + 1) });
    const swept = await closeStaleExternalPostings();
    expect(swept.ids).toContain(row.id);
    expect((await readPosting(row.id)).status).toBe("closed");
  });
});

describe("a manual import closes on its own expires_at", () => {
  it("a manual row past its expires_at closes, with closed_at stamped, and expires_at is left as it was", async () => {
    const expiresAt = hoursAgo(2);
    const row = await makeExternalPosting({ external_source: "manual-sheet-2026-11-02", expires_at: expiresAt, last_checked_at: hoursAgo(1) });
    const swept = await closeStaleExternalPostings();
    expect(swept.ids).toContain(row.id);
    const after = await readPosting(row.id);
    expect(after.status).toBe("closed");
    expect(after.closed_at).not.toBeNull();
    const { data } = await admin.from("job_postings").select("expires_at").eq("id", row.id).single();
    expect(new Date(data!.expires_at!).getTime()).toBe(new Date(expiresAt).getTime());
  });

  it("a manual row with a future expires_at stays open", async () => {
    const row = await makeExternalPosting({ external_source: "manual-sheet-2026-11-02", expires_at: hoursAhead(48), last_checked_at: hoursAgo(1) });
    const swept = await closeStaleExternalPostings();
    expect(swept.ids).not.toContain(row.id);
    expect((await readPosting(row.id)).status).toBe("open");
  });

  it("a manual row with no expires_at stays open", async () => {
    const row = await makeExternalPosting({ external_source: "manual-sheet-2026-11-02", expires_at: null, last_checked_at: hoursAgo(1) });
    await closeStaleExternalPostings();
    expect((await readPosting(row.id)).status).toBe("open");
  });

  it("a NON-manual external row past its expires_at is NOT closed by this rule (only the 72-hour rule applies to it)", async () => {
    const row = await makeExternalPosting({ external_source: "greenhouse", expires_at: hoursAgo(5), last_checked_at: hoursAgo(1) });
    const swept = await closeStaleExternalPostings();
    expect(swept.ids).not.toContain(row.id);
    expect((await readPosting(row.id)).status).toBe("open");
  });

  it("an already closed manual row past its expires_at is not counted again", async () => {
    const row = await makeExternalPosting({ external_source: "manual-sheet-2026-11-02", expires_at: hoursAgo(2), status: "closed" });
    const swept = await closeStaleExternalPostings();
    expect(swept.ids).not.toContain(row.id);
  });

  it("an INTERNAL row is untouched even if it carries a manual- source and a past expires_at", async () => {
    const row = await makeInternalPosting({ external_source: "manual-sheet-2026-11-02", expires_at: hoursAgo(2), last_checked_at: hoursAgo(24 * 90) });
    const swept = await closeStaleExternalPostings();
    expect(swept.ids).not.toContain(row.id);
    expect((await readPosting(row.id)).status).toBe("open");
  });

  it("the result merges the ids of both rules and 'closed' is their count (the return shape is unchanged)", async () => {
    const stale = await makeExternalPosting({ external_source: "greenhouse", last_checked_at: hoursAgo(EXTERNAL_STALE_AFTER_HOURS + 2) });
    const expired = await makeExternalPosting({ external_source: "manual-sheet-2026-11-02", expires_at: hoursAgo(3), last_checked_at: hoursAgo(1) });
    const swept = await closeStaleExternalPostings();
    expect(Object.keys(swept).sort()).toEqual(["closed", "ids"]);
    expect(swept.ids).toEqual(expect.arrayContaining([stale.id, expired.id]));
    expect(swept.closed).toBe(swept.ids.length);
    expect(new Set(swept.ids).size).toBe(swept.ids.length);
  });
});
