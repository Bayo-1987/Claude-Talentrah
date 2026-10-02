/**
 * send-508 / S3-21a — migration 0204 against the REAL database: the SQL definition equals the TypeScript twin, the guards hold, and the
 * stored close_at is always the function's answer.
 *
 * tests/scholarships/close-instant.test.ts holds the TypeScript twin to Postgres's values for 16 inputs. This re-runs the same inputs
 * THROUGH Postgres in CI's own database, so a change to either side that the other does not follow fails here.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { scholarshipCloseInstant } from "@/lib/scholarships/close-instant";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`close-instant-sql test cannot run: ${key} is not set.`);
}
const admin: SupabaseClient<Database> = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PARITY: Array<[string, string | null, string | null]> = [
  ["2026-10-06", "13:00", "America/Vancouver"],
  ["2026-10-06", null, "Africa/Lagos"],
  ["2026-10-06", null, null],
  ["2026-10-06", "23:59", "America/Toronto"],
  ["2026-01-15", "12:59", "Europe/Zurich"],
  ["2026-06-15", "12:59", "Europe/Zurich"],
  ["2026-03-08", "02:30", "America/Toronto"],
  ["2026-11-01", "01:30", "America/Toronto"],
  ["2026-10-06", "11:00", "UTC"],
  ["2026-10-06", "23:30", "Asia/Kolkata"],
  ["2026-10-06", "00:00", "Pacific/Kiritimati"],
  ["2026-10-06", "12:00", "Europe/Moscow"],
  ["2026-03-29", "02:30", "Europe/Zurich"],
  ["2026-10-25", "02:30", "Europe/Zurich"],
  ["2026-10-06", null, "America/Toronto"],
  ["2026-12-31", null, null],
];

const created: string[] = [];
afterAll(async () => {
  if (!created.length) return;
  const { error } = await admin.from("scholarships").delete().in("id", created);
  if (error) throw new Error(`fixture cleanup failed: ${error.message}`);
});

async function rowOf(id: string) {
  const { data, error } = await admin.from("scholarships").select("provider, program_name, funding_type, official_url, dedup_fingerprint, degree_levels, moderation_status").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data!;
}

async function insert(over: Record<string, unknown>) {
  const { data, error } = await admin
    .from("scholarships")
    .insert({
      provider: "E2E close-instant",
      program_name: `fixture ${randomUUID().slice(0, 8)}`,
      funding_type: "full",
      official_url: "https://example.test/close-instant",
      dedup_fingerprint: `close-instant-${randomUUID()}`,
      moderation_status: "pending",
      ...over,
    })
    .select("id, close_at")
    .single();
  if (data) created.push(data.id);
  return { data, error };
}

describe("scholarship_close_instant (SQL) equals scholarshipCloseInstant (TypeScript)", () => {
  it.each(PARITY)("%s %s %s", async (deadline, time, tz) => {
    const { data, error } = await admin.rpc("scholarship_close_instant", { p_deadline: deadline, p_close_time: time as never, p_close_tz: tz as never });
    expect(error).toBeNull();
    const ts = scholarshipCloseInstant({ application_deadline: deadline, close_time: time, close_tz: tz });
    expect(new Date(data as string).toISOString()).toBe(ts!.toISOString());
  });
});

describe("scholarship_is_open: strictly before the instant", () => {
  it("open at 19:59:59Z, closed at 20:00:00Z (13:00 Pacific)", async () => {
    const open = async (iso: string) =>
      (await admin.rpc("scholarship_is_open", { p_deadline: "2026-10-06", p_close_time: "13:00", p_close_tz: "America/Vancouver", p_now: iso })).data;
    expect(await open("2026-10-06T19:59:59Z")).toBe(true);
    expect(await open("2026-10-06T20:00:00Z")).toBe(false);
  });

  it("no deadline: always open", async () => {
    const { data } = await admin.rpc("scholarship_is_open", { p_deadline: null as never, p_close_time: null as never, p_close_tz: null as never, p_now: "2099-01-01T00:00:00Z" });
    expect(data).toBe(true);
  });
});

describe("the guards", () => {
  it("a closing time with no zone is refused (a clock time with no zone is the ambiguity this exists to remove)", async () => {
    const { error } = await insert({ application_deadline: "2026-10-06", close_time: "13:00", close_tz: null });
    expect(error?.code).toBe("23514");
  });

  it("a made-up zone is refused", async () => {
    const { error } = await insert({ application_deadline: "2026-10-06", close_time: "13:00", close_tz: "Mars/Phobos" });
    expect(error?.code).toBe("22023");
  });

  it("a real zone is accepted", async () => {
    const { error } = await insert({ application_deadline: "2026-10-06", close_time: "13:00", close_tz: "America/Vancouver" });
    expect(error).toBeNull();
  });
});

describe("close_at is maintained by the database", () => {
  it("is set on insert, and moves when the deadline, time or zone change", async () => {
    const { data } = await insert({ application_deadline: "2026-10-06", close_time: "13:00", close_tz: "America/Vancouver" });
    expect(new Date(data!.close_at!).toISOString()).toBe("2026-10-06T20:00:00.000Z");
    const { data: moved } = await admin.from("scholarships").update({ close_tz: "UTC" }).eq("id", data!.id).select("close_at").single();
    expect(new Date(moved!.close_at!).toISOString()).toBe("2026-10-06T13:00:00.000Z");
  });

  it("a refresh-style insert with a deadline and NO zone gets deadline + 1 day at 12:00Z (what the scholarship refresh writes)", async () => {
    const { data } = await insert({ application_deadline: "2026-10-06" });
    expect(new Date(data!.close_at!).toISOString()).toBe("2026-10-07T12:00:00.000Z");
  });

  it("a refresh-style upsert that rewrites application_deadline but names no close_* column keeps the zone and recomputes close_at", async () => {
    const { data } = await insert({ application_deadline: "2026-10-06", close_time: "13:00", close_tz: "America/Vancouver" });
    const { data: after, error } = await admin
      .from("scholarships")
      .upsert({ ...(await rowOf(data!.id)), application_deadline: "2026-10-07" }, { onConflict: "dedup_fingerprint" })
      .select("close_tz, close_time, close_at")
      .single();
    expect(error).toBeNull();
    expect(after!.close_tz).toBe("America/Vancouver");
    expect(new Date(after!.close_at!).toISOString()).toBe("2026-10-07T20:00:00.000Z");
  });

  it("is null when there is no deadline", async () => {
    const { data } = await insert({ application_deadline: null });
    expect(data!.close_at).toBeNull();
  });

  it("no row anywhere disagrees with the function (the backfill and every writer agree)", async () => {
    const { data, error } = await admin.from("scholarships").select("id, application_deadline, close_time, close_tz, close_at");
    expect(error).toBeNull();
    const bad = (data ?? []).filter((r) => {
      const ts = scholarshipCloseInstant(r)?.toISOString() ?? null;
      const stored = r.close_at ? new Date(r.close_at).toISOString() : null;
      return ts !== stored;
    });
    expect(bad.map((r) => r.id)).toEqual([]);
  });
});
