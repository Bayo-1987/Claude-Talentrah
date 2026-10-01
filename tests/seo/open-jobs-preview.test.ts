/**
 * send-484 — loadOpenJobsPreview: the real rows on the signed-out /jobs landing page, and the live
 * total that decides whether they are shown at all.
 *
 * Runs against the REAL database with a REAL anon client, like tests/seo/open-scholarships-preview.test.ts
 * and for the same reason: a mock proves the function calls the client, never that RLS, the freshness
 * floor and the unlisted rule really decide what a signed-out visitor sees.
 *
 * NARROW COLUMNS, ASSERTED EXACTLY. The measured production payload for six rows is 1,484 B against
 * 14,323 B with the wide landing-page columns (about 9.7x). The exact key set is pinned so a column added
 * "just for the card" fails here rather than quietly restoring the wide payload.
 *
 * SHARED-DATABASE HYGIENE. Other files in this run write job postings at the same time, so this file asks
 * for a large `limit`, filters the result to ITS OWN tagged fixtures and asserts on those, and never
 * touches a row it did not create.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { deletePostingsCascade } from "../support/delete-orgs";
import { loadModule } from "../support/load-module";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`open-jobs-preview test cannot run: ${key} is not set.`);
}

type DB = SupabaseClient<Database>;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin: DB = createClient<Database>(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon: DB = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface PreviewModule {
  loadOpenJobsPreview: (db: DB, limit?: number) => Promise<{ total: number; jobs: Array<Record<string, unknown> & { id: string; title: string }> }>;
}
const load = () => loadModule<PreviewModule>("@/lib/seo/landing-page-data");

const RUN = randomUUID().slice(0, 8);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const created: string[] = [];

async function fixture(label: string, over: Record<string, unknown>) {
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "external",
      external_source: "preview-test",
      external_url: `https://example.test/${randomUUID()}`,
      company_name: `PREVIEW-TEST Co ${label} ${RUN}`,
      title: `PREVIEW-TEST ${label} ${RUN}`,
      description: "A fixture description that must never be fetched by the narrow preview loader.",
      structured_jd: {},
      status: "open" as const,
      posted_at: new Date(Date.now() - HOUR).toISOString(),
      dedup_fingerprint: `preview-test-${label}-${RUN}-${randomUUID()}`,
      ...over,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`could not create fixture ${label}: ${error?.message}`);
  created.push(data.id);
  return data.id;
}

const ids: Record<string, string> = {};

beforeAll(async () => {
  ids.newest = await fixture("newest", { posted_at: new Date(Date.now() - 1 * HOUR).toISOString() });
  ids.older = await fixture("older", { posted_at: new Date(Date.now() - 5 * HOUR).toISOString() });
  ids.closed = await fixture("closed", { status: "closed" });
  ids.unlisted = await fixture("unlisted", { unlisted_at: new Date().toISOString() });
  ids.stale = await fixture("stale", { posted_at: new Date(Date.now() - 40 * DAY).toISOString() });
});

afterAll(async () => {
  if (created.length) await deletePostingsCascade(admin, created);
});

const mine = <T extends { title: string }>(rows: T[]) => rows.filter((r) => r.title.endsWith(RUN));

describe("loadOpenJobsPreview", () => {
  it("returns this run's fresh open fixtures, newest first, and nothing it should not", async () => {
    const { loadOpenJobsPreview } = await load();
    const { jobs } = await loadOpenJobsPreview(anon, 1000);
    // Positive control first: the fixtures that SHOULD be there are. Only then is "absent" meaningful.
    expect(mine(jobs).map((j) => j.id)).toEqual([ids.newest, ids.older]);
    const all = new Set(jobs.map((j) => j.id));
    expect(all.has(ids.closed), "a closed posting leaked").toBe(false);
    expect(all.has(ids.unlisted), "an unlisted posting leaked (0107)").toBe(false);
    expect(all.has(ids.stale), "a posting past the 30-day freshness floor leaked").toBe(false);
  });

  it("returns exactly the narrow columns the card renders, and no description or moderation field", async () => {
    const { loadOpenJobsPreview } = await load();
    const { jobs } = await loadOpenJobsPreview(anon, 1000);
    const row = mine(jobs)[0];
    expect(row, "no fixture row to inspect").toBeTruthy();
    expect(Object.keys(row).sort()).toEqual(
      ["company_name", "id", "location", "posted_at", "source_type", "title", "work_type"],
    );
  });

  it("counts every fresh open listing as `total`, independent of how many rows it returns", async () => {
    const { loadOpenJobsPreview } = await load();
    const small = await loadOpenJobsPreview(anon, 1);
    const big = await loadOpenJobsPreview(anon, 1000);
    expect(small.jobs).toHaveLength(1);
    expect(big.total).toBeGreaterThanOrEqual(2);
    // Same filter, so the row count at an unbounded limit IS the total (one query returns both).
    expect(big.jobs.length).toBe(big.total);
    // A total counted from the row limit would be 1 here.
    expect(small.total).toBeGreaterThanOrEqual(2);
  });

  it("defaults to at most six rows", async () => {
    const { loadOpenJobsPreview } = await load();
    const { jobs } = await loadOpenJobsPreview(anon);
    expect(jobs.length).toBeLessThanOrEqual(6);
  });

  it("is uncached: a fixture opened AFTER an earlier call shows up in the next one (no memoisation, no data cache)", async () => {
    const { loadOpenJobsPreview } = await load();
    const before = await loadOpenJobsPreview(anon, 1000);
    const extra = await fixture("uncached", {});
    // Control: the earlier call really was made without it.
    expect(before.jobs.map((j) => j.id)).not.toContain(extra);
    const after = await loadOpenJobsPreview(anon, 1000);
    expect(after.jobs.map((j) => j.id)).toContain(extra);
  });
});
