/**
 * The daily LLM usage counter (migration 0223) — DATABASE-BACKED, CI ONLY. These run against the ephemeral per-job database that CI builds from supabase/migrations; they never run against a hosted project. They were
 * written before 0223 and are red against a database without it. Not seen red locally (there is no database on the authoring machine); tests/farah/counter-race-detection.test.ts shows the concurrency assertions can fail.
 *
 * ISOLATION. The counter row for today is shared by every test run on one database, so nothing here assumes an absolute total: each test reads the counter, acts, and compares DELTAS. They are exact because nothing
 * else writes to this counter while they run: tests/farah/tally-isolation.test.ts allows only the counter's own test files to reach it, and the route tests use the safe mocks. The database's UTC day can change in the
 * middle of a test, which would split a delta across two rows; a test that sees the day change reruns once on the new day.
 *
 *   (a) parallel adds sum exactly;  (b) the call-count bucket reports "first caller" exactly once;  (c) a new UTC day starts a new row, from the database clock;
 *   (d) bad input is rejected and changes nothing;  (e) overflow fails the call instead of wrapping;  (f) adding zero reads the total.
 * The grants and ACL are in tests/rls/llm-usage-grants.test.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { admin as typedAdmin } from "../support/auth";
import { assertFirstCallerOnce, assertParallelAddsExact } from "./support/counter-assertions";

// The generated Database types do not know the new table or function until they are regenerated after 0223, and CI typechecks before it tests: an untyped handle keeps this file compiling now.
const admin = typedAdmin as unknown as SupabaseClient;

const SPEND = "farah_chat";
const WARNED = "farah_chat_half_warned";
const CAP = 100_000_000_000;

async function rpcAdd(bucket: unknown, nano: unknown) {
  return admin.rpc("add_llm_usage", { p_bucket: bucket as string, p_nano: nano as number });
}
async function add(bucket: string, nano: number): Promise<number> {
  const { data, error } = await rpcAdd(bucket, nano);
  if (error) throw error;
  return Number(data);
}
const total = (bucket: string) => add(bucket, 0);
const utcDate = (d = new Date()) => d.toISOString().slice(0, 10);
async function rows() {
  // Recent days only: tests/rls/llm-usage-grants.test.ts keeps a sentinel row on an old date, and its writes must not move a snapshot taken here.
  const { data, error } = await admin.from("llm_daily_usage").select("day, bucket, nano_usd").gte("day", utcDate(new Date(Date.now() - 3 * 86_400_000))).order("day").order("bucket");
  if (error) throw error;
  return data ?? [];
}
/** Runs a test body; if the UTC date changed while it ran, runs it once more (a delta across midnight spans two rows). */
async function onOneUtcDay(body: () => Promise<void>): Promise<void> {
  const before = utcDate();
  try {
    await body();
  } catch (err) {
    if (utcDate() === before) throw err;
    await body();
    return;
  }
  if (utcDate() !== before) await body();
}

describe("(a) parallel adds sum exactly", () => {
  it("50 concurrent adds of 1,000 add exactly 50,000, and every call saw a different running total", async () => {
    await onOneUtcDay(() => assertParallelAddsExact(add, SPEND));
  });

  it("buckets are independent", async () => {
    await onOneUtcDay(async () => {
      const [s, w] = [await total(SPEND), await total(WARNED)];
      await add(SPEND, 700);
      await add(WARNED, 1);
      expect(await total(SPEND)).toBe(s + 700);
      expect(await total(WARNED)).toBe(w + 1);
    });
  });
});

describe("(b) the call-count bucket fires exactly once under parallel calls", () => {
  it("50 concurrent callers see base+1 .. base+50, and from a fresh day exactly one sees 1", async () => {
    await onOneUtcDay(() => assertFirstCallerOnce(add, WARNED));
  });
});

describe("(c) a new UTC day starts a new row; the day comes from the database clock", () => {
  it("yesterday's row is untouched, today's row moves by the delta, and today's row is keyed by the UTC date", async () => {
    await onOneUtcDay(async () => {
      const yesterday = utcDate(new Date(Date.now() - 86_400_000));
      const { error } = await admin.from("llm_daily_usage").upsert({ day: yesterday, bucket: SPEND, nano_usd: 5_000_000 }, { onConflict: "day,bucket" });
      expect(error).toBeNull();
      const base = await total(SPEND);
      await add(SPEND, 10);
      expect(await total(SPEND)).toBe(base + 10);
      const all = await rows();
      expect(all.find((r) => r.day === yesterday && r.bucket === SPEND)?.nano_usd).toBe(5_000_000);
      expect(all.some((r) => r.bucket === SPEND && r.day === utcDate())).toBe(true);
    });
  });

  it("the function accepts no day argument (a caller cannot write to another day)", async () => {
    const r = await admin.rpc("add_llm_usage", { p_bucket: SPEND, p_nano: 1, p_day: "2020-01-01" } as never);
    expect(r.error).not.toBeNull();
    const { data } = await admin.from("llm_daily_usage").select("day").eq("day", "2020-01-01");
    expect(data ?? []).toEqual([]);
  });
});

describe("(d) bad inputs are rejected, and a rejected call changes nothing", () => {
  const bad: Array<[string, unknown, unknown]> = [
    ["a negative amount", SPEND, -1],
    ["a null amount", SPEND, null],
    ["an amount above the $100 cap", SPEND, CAP + 1],
    ["a fractional amount", SPEND, 1.5],
    ["the text NaN", SPEND, "NaN"],
    ["the text Infinity", SPEND, "Infinity"],
    ["a null bucket", null, 1],
    ["an unknown bucket", "some_other_feature", 1],
    ["an empty bucket", "", 1],
    ["a bucket differing only in case", "Farah_Chat", 1],
  ];
  for (const [label, bucket, nano] of bad) {
    it(`rejects ${label}`, async () => {
      await onOneUtcDay(async () => {
        await add(SPEND, 0); // today's row exists, so the snapshots below compare the same rows
        const before = await rows();
        const r = await rpcAdd(bucket, nano);
        expect(r.error).not.toBeNull();
        expect(await rows()).toEqual(before);
      });
    });
  }

  it("the explicit checks use SQLSTATE 22023 (invalid parameter), so a caller can tell them from an outage", async () => {
    for (const [bucket, nano] of [[SPEND, -1], [SPEND, null], [SPEND, CAP + 1], [null, 1], ["nope", 1]] as Array<[unknown, unknown]>) {
      expect((await rpcAdd(bucket, nano)).error?.code).toBe("22023");
    }
  });

  it("accepts the largest allowed single amount and zero", async () => {
    await onOneUtcDay(async () => {
      const base = await total(SPEND);
      expect((await rpcAdd(SPEND, CAP)).error).toBeNull();
      expect(await total(SPEND)).toBe(base + CAP);
      expect((await rpcAdd(SPEND, 0)).error).toBeNull();
    });
  });
});

describe("(e) overflow fails the call; it never wraps to a small or negative total", () => {
  it("a total near the bigint maximum refuses the next add (SQLSTATE 22003) and keeps its value; the row is put back afterwards", async () => {
    await onOneUtcDay(async () => {
      const base = await total(SPEND);
      const day = (await rows()).filter((r) => r.bucket === SPEND).map((r) => r.day as string).sort().pop()!;
      try {
        const { error } = await admin.from("llm_daily_usage").update({ nano_usd: "9223372036854775000" as unknown as number }).eq("day", day).eq("bucket", SPEND);
        expect(error).toBeNull();
        const r = await rpcAdd(SPEND, 1_000_000);
        expect(r.error?.code).toBe("22003");
        expect(Number((await rows()).find((x) => x.day === day && x.bucket === SPEND)?.nano_usd)).toBeGreaterThan(9e18);
      } finally {
        const { error } = await admin.from("llm_daily_usage").update({ nano_usd: base }).eq("day", day).eq("bucket", SPEND);
        expect(error).toBeNull();
      }
    });
  });
});

describe("(f) adding zero reads the total", () => {
  it("returns the running total without changing it", async () => {
    await onOneUtcDay(async () => {
      const base = await total(SPEND);
      await add(SPEND, 7);
      expect(await total(SPEND)).toBe(base + 7);
      expect(await total(SPEND)).toBe(base + 7);
    });
  });
});
