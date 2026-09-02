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
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { closeStaleExternalPostings, EXTERNAL_STALE_AFTER_HOURS } from "@/lib/jobs/expiry";
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
  const { data, error } = await admin.from("job_postings").select("status").eq("id", id).single();
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
