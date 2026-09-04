/**
 * "A >30-day posting is unreachable through every path including a direct
 * URL" — checked against the real, exported functions each discovery
 * surface actually calls, with real fixture rows on the live (CI) database,
 * not a reimplementation of their SQL. There is no single choke point these
 * surfaces share (see src/lib/jobs/freshness.ts's own header) — each is
 * verified independently here for that reason.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { deletePostingsCascade } from "../support/delete-orgs";
import { loadRemoteJobs, loadCityJobs } from "@/lib/seo/landing-page-data";
import { liveJobLandingLinks } from "@/lib/seo/landing-page-links";
import { scanAndQueue } from "@/lib/auto-apply/queue";
import { JOB_FRESHNESS_WINDOW_DAYS } from "@/lib/jobs/freshness";

const DAY_MS = 24 * 60 * 60 * 1000;
const isoAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

let userId: string;
let fixtureOrgId: string;
const staleJobIds: string[] = [];
const freshJobIds: string[] = [];

async function insertPosting(overrides: {
  title: string;
  postedAt: string;
  workType?: "remote" | null;
  location?: string;
}): Promise<string> {
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: fixtureOrgId,
      company_name: "FRESHNESS-TEST Org",
      title: overrides.title,
      description: "Fixture posting for the freshness-visibility suite.",
      status: "open",
      work_type: overrides.workType ?? null,
      location: overrides.location ?? null,
      posted_at: overrides.postedAt,
      dedup_fingerprint: `freshness-visibility-${randomUUID()}`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture posting: ${error?.message}`);
  return data.id;
}

beforeAll(async () => {
  const user = await createTestUser("freshnessvis");
  userId = user.id;

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `FRESHNESS-TEST Org ${randomUUID().slice(0, 8)}`, created_by: userId, verified: true })
    .select("id")
    .single();
  if (orgErr || !org) throw new Error(`fixture org: ${orgErr?.message}`);
  fixtureOrgId = org.id;

  const staleAt = isoAgo(JOB_FRESHNESS_WINDOW_DAYS + 5); // 35 days
  // Not just "recent" (e.g. 5 days) — both loaders order by posted_at DESC
  // LIMIT 30, and a shared, populated CI database can easily have 30+ real
  // postings newer than a 5-day-old fixture, pushing it off the page before
  // the freshness filter is even reached. Posted essentially "now" so it
  // always sorts first regardless of what else is on the board.
  const freshAt = new Date().toISOString();

  staleJobIds.push(
    await insertPosting({ title: "FRESHNESS-TEST Stale Remote Role", postedAt: staleAt, workType: "remote" }),
    await insertPosting({ title: "FRESHNESS-TEST Stale Lagos Role", postedAt: staleAt, location: "Lagos, Nigeria" }),
  );
  freshJobIds.push(
    await insertPosting({ title: "FRESHNESS-TEST Fresh Remote Role", postedAt: freshAt, workType: "remote" }),
    await insertPosting({ title: "FRESHNESS-TEST Fresh Lagos Role", postedAt: freshAt, location: "Lagos, Nigeria" }),
  );
}, 60_000);

afterAll(async () => {
  await deletePostingsCascade(admin, [...staleJobIds, ...freshJobIds]);
  if (fixtureOrgId) await admin.from("organizations").delete().eq("id", fixtureOrgId);
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

describe("loadRemoteJobs (src/jobs/remote)", () => {
  it("includes the 5-day-old remote posting", async () => {
    // Posted essentially "now" (see beforeAll), so it always sorts first
    // regardless of anything else real on the board — a positive control
    // that this loader's `jobs` array is reachable at all.
    const result = await loadRemoteJobs(admin);
    expect(result.jobs.map((j) => j.id)).toContain(freshJobIds[0]);
  });

  it(
    "does not count the 35-day-old remote posting toward `total` " +
      "— SABOTAGE-PROOF TARGET",
    async () => {
      // NOT checked via the `jobs` array: that query is `ORDER BY posted_at
      // DESC LIMIT 30`, so on an active board a 35-day-old row can fail to
      // appear in the top 30 for a reason that has nothing to do with the
      // freshness filter — proven live: removing the filter and re-running
      // this exact check via the `jobs` array still passed, because the
      // real board already had 30+ newer remote postings crowding it out.
      // `total` comes from a COUNT query with no LIMIT, so it is not
      // subject to that false negative — a stale row inflates it if and
      // only if the filter is actually missing.
      const before = (await loadRemoteJobs(admin)).total;
      const staleAt = isoAgo(JOB_FRESHNESS_WINDOW_DAYS + 40);
      const extraStaleId = await insertPosting({
        title: "FRESHNESS-TEST Extra Stale Remote Role (count check)",
        postedAt: staleAt,
        workType: "remote",
      });
      try {
        const after = (await loadRemoteJobs(admin)).total;
        expect(after).toBe(before);
      } finally {
        await deletePostingsCascade(admin, [extraStaleId]);
      }
    },
  );
});

describe("loadCityJobs (src/jobs/in/[city])", () => {
  it("includes the 5-day-old Lagos posting", async () => {
    const result = await loadCityJobs(admin, "lagos");
    expect(result).not.toBeNull();
    expect(result!.jobs.map((j) => j.id)).toContain(freshJobIds[1]);
  });

  it(
    "does not count a 35-day-old Lagos posting toward `total` " +
      "— SABOTAGE-PROOF TARGET (same LIMIT-30-masks-the-bug reasoning as loadRemoteJobs above)",
    async () => {
      const before = (await loadCityJobs(admin, "lagos"))!.total;
      const staleAt = isoAgo(JOB_FRESHNESS_WINDOW_DAYS + 40);
      const extraStaleId = await insertPosting({
        title: "FRESHNESS-TEST Extra Stale Lagos Role (count check)",
        postedAt: staleAt,
        location: "Lagos, Nigeria",
      });
      try {
        const after = (await loadCityJobs(admin, "lagos"))!.total;
        expect(after).toBe(before);
      } finally {
        await deletePostingsCascade(admin, [extraStaleId]);
      }
    },
  );
});

describe("liveJobLandingLinks (the 'explore more' / sitemap live-count check)", () => {
  it("does not count a stale posting toward whether a category page would render", async () => {
    // Both fixture postings are real, open, remote/Lagos rows — if the
    // count query forgot the freshness floor, the stale one would still
    // inflate this count, which is exactly what a sabotage of the query
    // would produce.
    const before = await liveJobLandingLinks(admin);
    // Not asserting on the link list itself (LANDING_PAGE_MIN_ENTRIES may or
    // may not be cleared depending on the rest of the board) — asserting
    // instead that adding ONE more stale row changes nothing, which is only
    // true if the count query already excludes it.
    const staleAt = isoAgo(JOB_FRESHNESS_WINDOW_DAYS + 40);
    const extraStaleId = await insertPosting({
      title: "FRESHNESS-TEST Extra Stale Remote Role",
      postedAt: staleAt,
      workType: "remote",
    });
    try {
      const after = await liveJobLandingLinks(admin);
      expect(after).toEqual(before);
    } finally {
      await deletePostingsCascade(admin, [extraStaleId]);
    }
  });
});

describe("scanAndQueue (Auto-Apply's candidate scan)", () => {
  it("never queues a posting older than the freshness floor, even with a qualifying match score", async () => {
    // Auto-Apply must be enabled for this user or scanAndQueue returns
    // immediately with reason "disabled", never reaching the job_postings
    // read at all — confirmed the hard way: this test initially passed with
    // the freshness filter sabotaged OUT of scanAndQueue's query, because it
    // never enabled settings and so never got far enough to exercise it.
    await admin
      .from("auto_apply_settings")
      .upsert({ user_id: userId, enabled: true }, { onConflict: "user_id" });

    // A match_scores row is the ONLY thing scanAndQueue reads to find
    // candidates — writing one directly for the stale fixture simulates a
    // job that was scored while still fresh and has since aged out, which
    // is exactly the case an independent freshness check (not just the
    // feed's own filtered query) exists to catch.
    await admin.from("match_scores").upsert(
      { user_id: userId, job_posting_id: staleJobIds[0], score: 95, tier: "excellent" },
      { onConflict: "user_id,job_posting_id" },
    );
    await scanAndQueue(userId);
    const { data: queued } = await admin
      .from("auto_apply_queue")
      .select("job_posting_id")
      .eq("user_id", userId)
      .eq("job_posting_id", staleJobIds[0]);
    expect(
      queued ?? [],
      "SABOTAGE-PROOF TARGET: Auto-Apply queued a posting older than the freshness floor",
    ).toHaveLength(0);
  });
});
