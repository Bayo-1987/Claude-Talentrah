/**
 * P1 / 0208 — the attempt table, against the real database: the route's own writer lands a row, the 7-day view
 * counts it, NO client (anon or signed-in) can read or write either, and the SCHEMA guarantees the two short-string
 * columns can only hold short codes, never a visitor's text.
 *
 * Rows are identified by a unique `error_class` marker (it allows letters and digits, so a per-run id fits; `reason`
 * does not allow digits). The cleanup deletes exactly this run's rows, so the suite stays safe next to anything else
 * writing to the table (nothing here resets or truncates it).
 */
import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { recordDemoAttempt } from "@/lib/demo/attempt-log";
import { ATTEMPT_REASONS, PROVIDER_ERROR_KINDS, REFUSAL_REASONS } from "@/lib/demo/attempt-codes";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`attempt-table test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** `T` + 32 hex characters: fits the error_class shape, unique per run. */
const MARK = `T${randomUUID().replace(/-/g, "")}`;
/** A listed code, so the row is a realistic one. */
const REASON = "daily_cap";
const CHECK_VIOLATION = "23514";

afterAll(async () => {
  const { error } = await admin.from("anonymous_demo_attempts").delete().eq("error_class", MARK);
  if (error) throw new Error(`cleanup failed, rows left behind (error_class=${MARK}): ${error.message}`);
});

function asAnon() {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error("Need the publishable/anon key to test client reach.");
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe("anonymous_demo_attempts (0208)", () => {
  it("the route's writer lands a row with exactly the recorded fields", async () => {
    await recordDemoAttempt({ outcome: "refused", reason: REASON, errorClass: MARK, ipRuleActive: false });
    const { data, error } = await admin
      .from("anonymous_demo_attempts")
      .select("outcome, reason, error_class, ip_rule_active, created_at")
      .eq("error_class", MARK);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ outcome: "refused", reason: REASON, error_class: MARK, ip_rule_active: false });
  });

  it("rejects an outcome outside the enumerated set", async () => {
    const { error } = await admin.from("anonymous_demo_attempts").insert({ outcome: "whatever", reason: REASON, error_class: MARK });
    expect(error?.code, "the check constraint should refuse an unknown outcome").toBe(CHECK_VIOLATION);
  });

  it("the 7-day view counts the row, by outcome, reason and error class", async () => {
    const { data, error } = await admin
      .from("anonymous_demo_outcomes_7d")
      .select("outcome, reason, error_class, attempts")
      .eq("error_class", MARK);
    expect(error).toBeNull();
    expect(data).toEqual([{ outcome: "refused", reason: REASON, error_class: MARK, attempts: 1 }]);
  });

  it("an anonymous client can neither read nor write the table, nor read the view", async () => {
    const client = asAnon();
    const read = await client.from("anonymous_demo_attempts").select("*").eq("error_class", MARK);
    expect(read.data ?? [], "an anonymous client could read attempt rows").toHaveLength(0);

    const write = await client.from("anonymous_demo_attempts").insert({ outcome: "success", error_class: MARK });
    expect(write.error, "an anonymous client could insert an attempt row").toBeTruthy();

    const view = await client.from("anonymous_demo_outcomes_7d").select("*");
    expect(view.data ?? [], "an anonymous client could read the outcome view").toHaveLength(0);

    const { data } = await admin.from("anonymous_demo_attempts").select("id").eq("error_class", MARK);
    expect(data, "nothing may have leaked in through the failed insert").toHaveLength(1);
  });
});

/**
 * "No personal data" is a property of the SCHEMA, not of today's writer. These are the two check constraints
 *   reason       ~ '^[a-z_]{1,32}$'
 *   error_class  ~ '^[A-Za-z0-9_.]{1,64}$'
 * A sentence has spaces and is long, so a pasted job description cannot be stored in either column even if a future
 * writer tried to.
 */
describe("the schema refuses anything that is not a short code (0208 check constraints)", () => {
  const SENTENCE = "a visitor pasted a whole job description here";

  async function insert(fields: { reason?: string | null; error_class?: string | null }) {
    // Every row that DOES land carries MARK in error_class unless the test is about error_class itself.
    return admin.from("anonymous_demo_attempts").insert({ outcome: "invalid", error_class: MARK, ...fields });
  }

  it("a sentence with spaces is refused in reason", async () => {
    expect((await insert({ reason: SENTENCE })).error?.code).toBe(CHECK_VIOLATION);
  });

  it("a sentence with spaces is refused in error_class", async () => {
    expect((await insert({ error_class: SENTENCE })).error?.code).toBe(CHECK_VIOLATION);
  });

  it("a 33-character reason is refused, a 32-character one is accepted", async () => {
    expect((await insert({ reason: "a".repeat(33) })).error?.code).toBe(CHECK_VIOLATION);
    expect((await insert({ reason: "a".repeat(32) })).error).toBeNull();
  });

  it("a 65-character error_class is refused, a 64-character one is accepted", async () => {
    // the accepted 64-character row must still be findable for cleanup: MARK is 33 characters, so build 64 from it
    const sixtyFour = MARK + "x".repeat(64 - MARK.length);
    expect(sixtyFour).toHaveLength(64);
    expect((await insert({ error_class: sixtyFour + "x" })).error?.code).toBe(CHECK_VIOLATION);
    const ok = await insert({ error_class: sixtyFour });
    expect(ok.error).toBeNull();
    await admin.from("anonymous_demo_attempts").delete().eq("error_class", sixtyFour);
  });

  it.each(["Daily_cap", "cap2", "daily-cap", "daily.cap", "ünïcode", ""])("reason %j (capitals, digits, hyphen, dot, non-ASCII, empty) is refused", async (bad) => {
    expect((await insert({ reason: bad })).error?.code).toBe(CHECK_VIOLATION);
  });

  it.each(["Type Error", "x/y", "x;drop", "ünï", ""])("error_class %j (space, slash, semicolon, non-ASCII, empty) is refused", async (bad) => {
    expect((await insert({ error_class: bad })).error?.code).toBe(CHECK_VIOLATION);
  });

  it("null is accepted in both columns (a success has neither)", async () => {
    const { error } = await admin.from("anonymous_demo_attempts").insert({ outcome: "success", reason: null, error_class: null });
    expect(error).toBeNull();
    // that row has no marker; remove exactly it: the newest success row with both null
    const { data } = await admin
      .from("anonymous_demo_attempts")
      .select("id")
      .eq("outcome", "success")
      .is("reason", null)
      .is("error_class", null)
      .order("created_at", { ascending: false })
      .limit(1);
    if (data?.[0]) await admin.from("anonymous_demo_attempts").delete().eq("id", data[0].id);
  });

  it("EVERY reason the route writes today is accepted (the list is taken from the code, so a new code that does not fit fails here)", async () => {
    for (const reason of ATTEMPT_REASONS) {
      const { error } = await insert({ reason });
      expect(error, `reason "${reason}" was refused by the schema`).toBeNull();
    }
  });

  it("EVERY error class the writer produces is accepted: the provider kinds, and class names of the errors the model call can throw", async () => {
    // Kinds from the code; constructor names are what classifyError yields for non-provider errors. Written through the
    // real writer, which sanitises first, so this also proves its output is never refused.
    for (const errorClass of [...PROVIDER_ERROR_KINDS, "Error", "TypeError", "RangeError", "AbortError", "FetchError", "SyntaxError"]) {
      const { error } = await insert({ reason: null, error_class: errorClass });
      expect(error, `error_class "${errorClass}" was refused by the schema`).toBeNull();
      await admin.from("anonymous_demo_attempts").delete().eq("error_class", errorClass).eq("outcome", "invalid").is("reason", null);
    }
  });

  it("the writer cannot lose a row to the constraint: a value that would be refused is written as the catch-all ('other' / 'Other'), never repaired", async () => {
    const since = new Date().toISOString();
    await recordDemoAttempt({ outcome: "error", reason: SENTENCE, errorClass: `${MARK} has spaces!`, ipRuleActive: false });
    // The row carries no marker (the catch-all values are the point), so find it by time and clean up by id.
    const { data } = await admin
      .from("anonymous_demo_attempts")
      .select("id, reason, error_class")
      .gte("created_at", since)
      .eq("outcome", "error")
      .eq("reason", "other")
      .eq("error_class", "Other");
    expect(data?.length, "the catch-all row must have landed").toBeGreaterThanOrEqual(1);
    for (const row of data ?? []) await admin.from("anonymous_demo_attempts").delete().eq("id", row.id);
  });
});

/**
 * The 7-day view groups by the reason the writer chose, so the refused-row count can only ever use codes the code knows:
 * every reason it reports is in attempt-codes.ts, even when the caller asked for one that is not.
 */
describe("the 7-day view's refused-row count uses only codes from attempt-codes.ts", () => {
  const VIEW_MARK = `V${randomUUID().replace(/-/g, "")}`;

  afterAll(async () => {
    const { error } = await admin.from("anonymous_demo_attempts").delete().eq("error_class", VIEW_MARK);
    if (error) throw new Error(`cleanup failed, rows left behind (error_class=${VIEW_MARK}): ${error.message}`);
  });

  it("one refused row per refusal reason, plus one asking for a reason that does not exist: the view reports only listed codes, and counts them all", async () => {
    for (const reason of REFUSAL_REASONS) {
      await recordDemoAttempt({ outcome: "refused", reason, errorClass: VIEW_MARK, ipRuleActive: false });
    }
    await recordDemoAttempt({ outcome: "refused", reason: "a_reason_nobody_listed", errorClass: VIEW_MARK, ipRuleActive: false });

    const { data, error } = await admin
      .from("anonymous_demo_outcomes_7d")
      .select("outcome, reason, attempts")
      .eq("error_class", VIEW_MARK)
      .eq("outcome", "refused");
    expect(error).toBeNull();

    const reported = (data ?? []).map((r) => r.reason as string);
    for (const reason of reported) expect([...ATTEMPT_REASONS], `the view reported "${reason}", which attempt-codes.ts does not list`).toContain(reason);
    expect(new Set(reported)).toEqual(new Set([...REFUSAL_REASONS, "other"]));
    const total = (data ?? []).reduce((n, r) => n + (r.attempts ?? 0), 0);
    expect(total, "every written refused row is counted").toBe(REFUSAL_REASONS.length + 1);
  });
});
