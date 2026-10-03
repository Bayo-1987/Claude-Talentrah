/**
 * The retention purge against the REAL table (0208), with real created_at values. Runs in CI's fresh database (and
 * anywhere SUPABASE env is set). Rows carry a unique error_class marker so this run cleans up exactly what it made.
 *
 * The purge deletes EVERY row older than 90 days, not just this run's, so assertions about "what else was deleted" are
 * deliberately avoided: this file only asserts about its own marked rows, and loops the purge until it reports it is done.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { purgeOldDemoAttempts } from "@/lib/demo/attempt-retention";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`attempt-retention-db test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const MARK = `R${randomUUID().replace(/-/g, "")}`;
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString();

afterAll(async () => {
  const { error } = await admin.from("anonymous_demo_attempts").delete().eq("error_class", MARK);
  if (error) throw new Error(`cleanup failed, rows left behind (error_class=${MARK}): ${error.message}`);
});

async function seed(ageDays: number, count = 1): Promise<void> {
  const rows = Array.from({ length: count }, () => ({ outcome: "success", error_class: MARK, created_at: daysAgo(ageDays) }));
  const { error } = await admin.from("anonymous_demo_attempts").insert(rows);
  expect(error).toBeNull();
}
async function mine(): Promise<{ id: string; created_at: string }[]> {
  const { data, error } = await admin.from("anonymous_demo_attempts").select("id, created_at").eq("error_class", MARK);
  expect(error).toBeNull();
  return data ?? [];
}
/** Run the purge to completion (the table may hold other old rows, e.g. on a shared project, so one run may hit its cap). */
async function purgeToCompletion() {
  for (let i = 0; i < 100; i++) {
    const r = await purgeOldDemoAttempts();
    expect(r.error).toBeUndefined();
    if (!r.hitCap) return;
  }
  throw new Error("purge never finished");
}

describe("purgeOldDemoAttempts against the real table", () => {
  it("a row at 91 days is deleted and a row at 89 days is kept", async () => {
    await seed(91);
    await seed(89);
    expect(await mine()).toHaveLength(2);
    await purgeToCompletion();
    const left = await mine();
    expect(left).toHaveLength(1);
    expect(Date.now() - new Date(left[0].created_at).getTime()).toBeLessThan(90 * DAY);
  });

  it("the batch cap holds: 25 old rows, batch of 10, two rounds: exactly 20 of the table's old rows are deleted", async () => {
    await seed(120, 25);
    const r = await purgeOldDemoAttempts({ batchSize: 10, maxRounds: 2 });
    expect(r.error).toBeUndefined();
    expect(r.deleted).toBe(20);
    expect(r.rounds).toBe(2);
    expect(r.hitCap).toBe(true);
    // at least 5 of mine are left (25 seeded, at most 20 deleted)
    const old = (await mine()).filter((x) => Date.now() - new Date(x.created_at).getTime() > 90 * DAY);
    expect(old.length).toBeGreaterThanOrEqual(5);
    await purgeToCompletion();
    expect((await mine()).filter((x) => Date.now() - new Date(x.created_at).getTime() > 90 * DAY)).toHaveLength(0);
  });
});
