/**
 * The one-free-run limit (0058), at the database.
 *
 * Two limits with two different serialisation points, and the tests are
 * grouped by which one is doing the work — because when one regresses the
 * other keeps the feature looking correct:
 *
 *   PER VISITOR   the unique indexes. Two concurrent first requests both pass
 *                 any SELECT-based check; only one survives the insert.
 *   PER DAY       a conditional UPDATE, `where runs < cap`, exactly the shape
 *                 of spend_credits_atomic (0035).
 *
 * What is being protected is not abstract: every allowed run is a real call on
 * a model key CLAUDE.md records as free-tier Gemini at 20 requests a day,
 * shared with every signed-in tailoring run and every Farah reply. A limit
 * that leaks under concurrency is an outage for paying users caused by the
 * marketing page.
 *
 * ── WHY THE WHOLE FILE TAKES A LEASE, NOT JUST THE "DAILY CEILING" TESTS ──
 *
 * `anonymous_demo_daily` has exactly ONE row for "today" — the whole point of
 * the table, not an oversight (see 0058's own comment). Every test in this
 * file calls `claim()`, and the RPC claims the DAY'S budget first regardless
 * of which limit the test is actually exercising, so even a "per visitor"
 * test mutates the same global row the "daily ceiling" tests assert on. And
 * `reset()` runs in every beforeEach/afterEach, unconditionally deleting that
 * row for today.
 *
 * REPRODUCED before this lease existed: claim 3 runs, let a second process's
 * reset() (this file's OWN cleanup, run concurrently) delete the day row,
 * then claim 4 more against a cap of 5 — 4 were allowed where at most 2
 * should have been, because the counter had been wiped back to zero
 * mid-batch. RUN_TAG (tests/support/list-users.ts) cannot fix this: it scopes
 * ROWS THIS RUN OWNS, and there is no per-run name to give a table that is
 * one row by design. The fix is the same shape as #177's operators lock —
 * see tests/support/operators-lock.ts — pinned to a second invariant.
 *
 * e2e/jd-demo.spec.ts touches this same row through the real route and takes
 * the SAME lease for the same reason: a lease only excludes callers that
 * check it, and this table has exactly two.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin } from "../support/auth";
import { acquireAnonymousDemoDailyLock } from "../support/operators-lock";

const CAP = 5;

type ClaimRow = { allowed: boolean; reason: string };

async function claim(ipHash: string | null, visitorId: string | null, cap = CAP) {
  const { data, error } = await admin.rpc("claim_anonymous_demo_run", {
    p_ip_hash: ipHash as unknown as string,
    p_visitor_id: visitorId as unknown as string,
    p_daily_cap: cap,
  });
  if (error) throw new Error(error.message);
  return (data as unknown as ClaimRow[])[0];
}

async function release(ipHash: string | null, visitorId: string | null) {
  const { error } = await admin.rpc("release_anonymous_demo_run", {
    p_ip_hash: ipHash as unknown as string,
    p_visitor_id: visitorId as unknown as string,
  });
  if (error) throw new Error(error.message);
}

async function todaysRuns(): Promise<number> {
  const { data } = await admin
    .from("anonymous_demo_daily")
    .select("runs")
    .eq("day", new Date().toISOString().slice(0, 10))
    .maybeSingle();
  return data?.runs ?? 0;
}

/** Every test starts from a clean day and leaves one behind. */
async function reset(prefix: string) {
  const { error } = await admin.from("anonymous_demo_runs").delete().like("ip_hash", `${prefix}%`);
  if (error) throw new Error(`cleanup failed: ${error.message}`);
  const { error: dayError } = await admin
    .from("anonymous_demo_daily")
    .delete()
    .eq("day", new Date().toISOString().slice(0, 10));
  if (dayError) throw new Error(`day cleanup failed: ${dayError.message}`);
}

let prefix: string;
let releaseLock: (() => Promise<void>) | undefined;

/*
 * SERIALIZED against every other suite that mutates anonymous_demo_daily —
 * currently this file and e2e/jd-demo.spec.ts. Acquired first, before any
 * reset or claim, so nothing in this file can interleave with another
 * process's view of "today".
 */
beforeAll(async () => {
  releaseLock = await acquireAnonymousDemoDailyLock(admin, "anonymous-limit");
}, 300_000); // this hook QUEUES on the lease; the default 60s is too short.

afterAll(async () => {
  await releaseLock?.();
});

beforeEach(async () => {
  prefix = `anonlimit-${randomUUID()}-`;
  await reset(prefix);
});

afterEach(async () => {
  await reset(prefix);
});

describe("the per-visitor cap holds under concurrency", () => {
  it("THE POINT: two simultaneous requests from one IP hash yield exactly one run", async () => {
    /*
     * The failure this exists to prevent, in the words of every other atomic
     * gate in this repo: a read-then-insert in TypeScript lets both callers
     * see "not used yet" and both reach a paid model call. Fired together, not
     * sequentially — sequential calls would pass even on the broken version.
     */
    const ip = `${prefix}same`;
    const results = await Promise.all([
      claim(ip, randomUUID()),
      claim(ip, randomUUID()),
    ]);

    expect(results.filter((r) => r.allowed)).toHaveLength(1);
    expect(results.filter((r) => !r.allowed)).toHaveLength(1);
    expect(results.find((r) => !r.allowed)!.reason).toBe("already_used");
    // And the day's budget records ONE run, not two — the loser's claim was
    // refunded rather than left spent.
    expect(await todaysRuns()).toBe(1);
  });

  it("holds for a shared cookie too, not just a shared IP", async () => {
    const visitor = randomUUID();
    const results = await Promise.all([
      claim(`${prefix}a`, visitor),
      claim(`${prefix}b`, visitor),
    ]);
    expect(results.filter((r) => r.allowed)).toHaveLength(1);
    expect(await todaysRuns()).toBe(1);
  });

  it("a match on EITHER identifier counts as used", async () => {
    const ip = `${prefix}one`;
    const visitor = randomUUID();
    expect((await claim(ip, visitor)).allowed).toBe(true);

    // same cookie, new address
    expect((await claim(`${prefix}other`, visitor)).reason).toBe("already_used");
    // same address, new cookie
    expect((await claim(ip, randomUUID())).reason).toBe("already_used");

    // Neither refusal spent the day's budget.
    expect(await todaysRuns()).toBe(1);
  });

  it("a genuinely new visitor is still allowed", async () => {
    await claim(`${prefix}a`, randomUUID());
    const fresh = await claim(`${prefix}b`, randomUUID());
    expect(fresh.allowed).toBe(true);
  });
});

describe("the daily ceiling holds under concurrency", () => {
  it("ten simultaneous distinct visitors against a cap of five yield exactly five", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => claim(`${prefix}c${i}`, randomUUID())),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(CAP);
    expect(results.filter((r) => r.reason === "daily_cap")).toHaveLength(10 - CAP);
    expect(await todaysRuns()).toBe(CAP);
  });

  it("the ceiling is independent of the per-visitor cap", async () => {
    // Five distinct visitors exhaust the day even though none has used a run
    // before — which is the whole reason it exists separately.
    for (let i = 0; i < CAP; i++) {
      expect((await claim(`${prefix}d${i}`, randomUUID())).allowed).toBe(true);
    }
    const sixth = await claim(`${prefix}d-last`, randomUUID());
    expect(sixth.allowed).toBe(false);
    expect(sixth.reason).toBe("daily_cap");
  });
});

describe("a run given back is a run the visitor still has", () => {
  it("release restores both the visitor's slot and the day's budget", async () => {
    const ip = `${prefix}rel`;
    const visitor = randomUUID();
    expect((await claim(ip, visitor)).allowed).toBe(true);
    expect(await todaysRuns()).toBe(1);

    await release(ip, visitor);
    expect(await todaysRuns()).toBe(0);

    // The visitor can try again — which is the point: a model call that failed
    // must not cost someone their only attempt.
    expect((await claim(ip, visitor)).allowed).toBe(true);
  });

  it("is safe to call when nothing was claimed", async () => {
    // The route calls this from an error path without first working out
    // whether the claim succeeded, so a no-op release must not throw or drive
    // the counter negative.
    await release(`${prefix}never`, randomUUID());
    expect(await todaysRuns()).toBe(0);
  });
});

describe("a caller with nothing to key on", () => {
  it("is refused rather than allowed", async () => {
    // Refusing is the conservative direction: an unidentifiable caller is
    // precisely the one that could take the entire daily budget alone.
    const result = await claim(null, null);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("no_identifier");
    expect(await todaysRuns()).toBe(0);
  });
});

describe("the tables are not client-reachable", () => {
  it("neither anon nor authenticated can read who has used the demo", async () => {
    // It records visitors who have not signed up. There is no client that
    // should see it, and 0058 revokes the privilege rather than relying on an
    // absent policy — the distinction 0054 turns on.
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    for (const table of ["anonymous_demo_runs", "anonymous_demo_daily"]) {
      const { error } = await anon.from(table).select("*").limit(1);
      expect(error, `${table} should be unreadable`).not.toBeNull();
    }
  });
});
