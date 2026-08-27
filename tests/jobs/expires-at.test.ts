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
 *   3. Anything closing a row on expiry. The last test parks a posting two
 *      years past its expiry and asserts it is STILL open. The day that
 *      fails, the authority this migration deliberately withheld has been
 *      added — which may be right, but it changes what `open` means and must
 *      not arrive as a side effect.
 *
 * 1 and 2 are asserted behaviourally rather than through the catalog, because
 * behaviour is what a caller actually meets: a DEFAULT makes the first test's
 * insert come back non-null, and NOT NULL makes it fail outright.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`expires_at test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

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

afterAll(async () => {
  if (created.length === 0) return;
  // A rejected delete RESOLVES with an error rather than throwing — the
  // failure mode this repo has now hit five times, each found somewhere
  // unrelated and much later. Report it.
  const { error } = await admin.from("job_postings").delete().in("id", created);
  if (error) throw new Error(`expires-at cleanup failed, rows left behind: ${error.message}`);
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

describe("nothing acts on it yet", () => {
  it("a posting whose expiry passed two years ago is still open", async () => {
    const past = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString();
    const row = await makePosting({ expires_at: past });

    const { data, error } = await admin
      .from("job_postings")
      .select("status, expires_at")
      .eq("id", row.id)
      .single();

    expect(error).toBeNull();
    expect(data!.status).toBe("open");
    expect(data!.expires_at).not.toBeNull();
  });
});
