/**
 * The daily LLM usage counter (migration 0223) — DATABASE-BACKED, CI ONLY. These run against the ephemeral per-job database that CI builds from
 * supabase/migrations; they never run against a hosted project. They were written before 0223 and are red against a database without it.
 *
 *   (a) parallel adds sum exactly;
 *   (b) the 50% bucket reports "first caller" exactly once under parallel calls;
 *   (c) a new UTC day starts a new row, from the database clock;
 *   (d) bad input is rejected, and a rejected call leaves nothing behind;
 *   (e) overflow fails the call instead of wrapping;
 *   (f) adding zero reads the total without changing it.
 * The grants and ACL are in tests/rls/llm-usage-grants.test.ts.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin as typedAdmin } from "../support/auth";

// The generated Database types do not know the new table or function until they are regenerated after 0223, and CI typechecks before it tests: an
// untyped handle keeps this file compiling now (so it fails at runtime, on its own assertions) and unchanged after the types are regenerated.
const admin = typedAdmin as unknown as SupabaseClient;

const SPEND = "farah_chat";
const WARNED = "farah_chat_half_warned";
const CAP = 100_000_000_000;

async function add(bucket: unknown, nano: unknown) {
  return admin.rpc("add_llm_usage", { p_bucket: bucket as string, p_nano: nano as number });
}
async function total(bucket: string): Promise<number> {
  const { data, error } = await add(bucket, 0);
  if (error) throw error;
  return Number(data);
}
const utcDate = (d = new Date()) => d.toISOString().slice(0, 10);
const rows = async () => {
  const { data, error } = await admin.from("llm_daily_usage").select("day, bucket, nano_usd").order("day").order("bucket");
  if (error) throw error;
  return data ?? [];
};

beforeEach(async () => {
  const { error } = await admin.from("llm_daily_usage").delete().gte("day", "2000-01-01");
  if (error) throw error;
});

describe("(a) parallel adds sum exactly", () => {
  it("50 concurrent adds of 1,000 give 50,000, and every call saw a different running total", async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => add(SPEND, 1000)));
    expect(results.every((r) => r.error === null)).toBe(true);
    const totals = results.map((r) => Number(r.data)).sort((a, b) => a - b);
    expect(totals[49]).toBe(50_000);
    expect(new Set(totals).size).toBe(50);
    expect(await total(SPEND)).toBe(50_000);
  });

  it("buckets are independent", async () => {
    await add(SPEND, 700);
    await add(WARNED, 1);
    expect(await total(SPEND)).toBe(700);
    expect(await total(WARNED)).toBe(1);
  });
});

describe("(b) the 50% bucket fires exactly once under parallel calls", () => {
  it("50 concurrent callers: exactly ONE sees a total of 1 (the first), the rest see 2..50", async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => add(WARNED, 1)));
    expect(results.every((r) => r.error === null)).toBe(true);
    const totals = results.map((r) => Number(r.data)).sort((a, b) => a - b);
    expect(totals.filter((t) => t === 1)).toHaveLength(1);
    expect(totals).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });
});

describe("(c) a new UTC day starts a new row; the day comes from the database clock", () => {
  it("yesterday's total is untouched, today starts at zero, and the row is keyed by the UTC date", async () => {
    const before = utcDate();
    const yesterday = utcDate(new Date(Date.now() - 86_400_000));
    const { error } = await admin.from("llm_daily_usage").insert({ day: yesterday, bucket: SPEND, nano_usd: 5_000_000 });
    expect(error).toBeNull();
    expect(await total(SPEND)).toBe(0);
    await add(SPEND, 10);
    expect(await total(SPEND)).toBe(10);
    const after = utcDate();
    const all = await rows();
    expect(all.find((r) => r.day === yesterday && r.bucket === SPEND)?.nano_usd).toBe(5_000_000);
    const today = all.find((r) => r.bucket === SPEND && r.day !== yesterday);
    expect(today?.nano_usd).toBe(10);
    expect([before, after]).toContain(today?.day);
  });

  it("the function accepts no day argument (a caller cannot write to another day)", async () => {
    const r = await admin.rpc("add_llm_usage", { p_bucket: SPEND, p_nano: 1, p_day: "2020-01-01" } as never);
    expect(r.error).not.toBeNull();
    expect((await rows()).some((row) => row.day === "2020-01-01")).toBe(false);
  });
});

describe("(d) bad inputs are rejected, and a rejected call leaves nothing behind", () => {
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
      const r = await add(bucket, nano);
      expect(r.error).not.toBeNull();
      expect(await rows()).toEqual([]);
    });
  }

  it("the explicit checks use SQLSTATE 22023 (invalid parameter), so a caller can tell them from an outage", async () => {
    for (const [bucket, nano] of [[SPEND, -1], [SPEND, null], [SPEND, CAP + 1], [null, 1], ["nope", 1]] as Array<[unknown, unknown]>) {
      expect((await add(bucket, nano)).error?.code).toBe("22023");
    }
  });

  it("accepts the largest allowed single amount and zero", async () => {
    expect((await add(SPEND, CAP)).error).toBeNull();
    expect(await total(SPEND)).toBe(CAP);
    expect((await add(SPEND, 0)).error).toBeNull();
  });
});

describe("(e) overflow fails the call; it never wraps to a small or negative total", () => {
  it("a total near the bigint maximum refuses the next add (SQLSTATE 22003) and keeps its value", async () => {
    const { error } = await admin.from("llm_daily_usage").insert({ day: utcDate(), bucket: SPEND, nano_usd: "9223372036854775000" as unknown as number });
    expect(error).toBeNull();
    const r = await add(SPEND, 1_000_000);
    expect(r.error?.code).toBe("22003");
    expect(Number((await rows())[0].nano_usd)).toBeGreaterThan(9e18);
  });
});

describe("(f) adding zero reads the total", () => {
  it("returns 0 on a fresh day, then the running total, without changing it", async () => {
    expect(await total(SPEND)).toBe(0);
    await add(SPEND, 7);
    expect(await total(SPEND)).toBe(7);
    expect(await total(SPEND)).toBe(7);
  });
});
