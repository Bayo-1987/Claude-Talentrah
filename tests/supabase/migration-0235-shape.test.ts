/**
 * Migration 0235 (the two operator-alert markers on the daily LLM usage counter) — its shape, read from the file (no database). The behaviour is in
 * tests/farah/llm-usage-counter.test.ts; this pins what a reviewer would otherwise have to find by reading the SQL.
 *
 * 0223 allowed two buckets: the day's spend (farah_chat) and a call counter for the 50% log line (farah_chat_half_warned). The operator alerts need one more marker each,
 * so the bucket list in the table's CHECK and in public.add_llm_usage grows by farah_chat_80_warned and farah_chat_reached_warned. Nothing else changes: not the
 * columns, the grants, RLS, or what the function does. 0223's own file is not edited (applied migrations never are), so this redefines the two places that hold the list.
 *
 * Written before the migration exists: every test here is red until 0235 is written.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FILE = join(__dirname, "../../supabase/migrations/0235_llm_daily_usage_alert_markers.sql");
const ROLLBACK = join(__dirname, "../../supabase/rollbacks/0235_llm_daily_usage_alert_markers.rollback.sql");
const sql = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const flat = code.replace(/\s+/g, " ").toLowerCase();
const BUCKETS = "'farah_chat', 'farah_chat_half_warned', 'farah_chat_80_warned', 'farah_chat_reached_warned'";

describe("0235: the file", () => {
  it("exists, under this exact name (0235 is the number registered for it)", () => {
    expect(existsSync(FILE)).toBe(true);
    expect(code.trim().length).toBeGreaterThan(0);
  });
});

describe("0235: the bucket list grows in both places that hold it, and only by the two markers", () => {
  it("replaces the table's CHECK with the four buckets (drop and add in one statement, so no row is ever unchecked)", () => {
    expect(flat).toMatch(/alter table public\.llm_daily_usage drop constraint llm_daily_usage_bucket_known, add constraint llm_daily_usage_bucket_known check \(bucket in \(/);
    expect(flat).toContain(`check (bucket in (${BUCKETS}))`);
  });

  it("replaces the function's own list with the same four", () => {
    expect(flat).toContain(`p_bucket not in (${BUCKETS})`);
  });

  it("touches no other constraint, column or table", () => {
    const alters = [...flat.matchAll(/alter table (?:if exists )?(?:only )?([a-z_.]+)/g)].map((m) => m[1]);
    expect(alters.length).toBeGreaterThan(0);
    expect(alters.every((t) => t === "public.llm_daily_usage")).toBe(true);
    expect([...flat.matchAll(/(?:drop|add) constraint ([a-z_]+)/g)].map((m) => m[1]).every((n) => n === "llm_daily_usage_bucket_known")).toBe(true);
    expect(flat).not.toMatch(/\b(add|drop|alter) column\b/);
    expect(flat).not.toMatch(/\bcreate table\b/);
    expect(flat).not.toMatch(/\bdrop (table|function|policy|trigger|column)\b/);
  });

  it("deletes and updates no row", () => {
    expect(flat).not.toMatch(/\bdelete from\b/);
    expect(flat).not.toMatch(/\bupdate public\./);
    expect(flat).not.toMatch(/\btruncate\b/);
  });
});

describe("0235: public.add_llm_usage is redefined exactly as 0223 had it, apart from the list", () => {
  it("same signature, SECURITY INVOKER, plpgsql, search_path pinned to empty", () => {
    expect(flat).toMatch(/create or replace function public\.add_llm_usage\(p_bucket text, p_nano bigint\) returns bigint/);
    expect(flat).toMatch(/security invoker/);
    expect(flat).not.toMatch(/security definer/);
    expect(flat).toMatch(/set search_path = ''/);
  });

  it("keeps the validation (null or negative amount, above $100, errcode 22023) and the single-statement add", () => {
    expect(flat).toMatch(/p_nano is null/);
    expect(flat).toMatch(/p_nano < 0/);
    expect(flat).toMatch(/p_nano > 100000000000/);
    expect(flat).toMatch(/errcode = '22023'/);
    expect(flat).toMatch(/insert into public\.llm_daily_usage as u \(day, bucket, nano_usd\) values \(\(pg_catalog\.now\(\) at time zone 'utc'\)::date, p_bucket, p_nano\) on conflict \(day, bucket\) do update set nano_usd = u\.nano_usd \+ excluded\.nano_usd returning u\.nano_usd into v_total/);
    expect((flat.match(/\binsert into\b/g) ?? []).length).toBe(1);
  });

  it("states the grants again: revoked from everyone, executable by service_role only", () => {
    expect(flat).toMatch(/revoke all on function public\.add_llm_usage\(text, bigint\) from public, anon, authenticated, service_role/);
    expect(flat).toMatch(/grant execute on function public\.add_llm_usage\(text, bigint\) to service_role/);
    const grants = [...flat.matchAll(/grant execute on function public\.add_llm_usage\(text, bigint\) to ([a-z_, ]+)/g)].map((m) => m[1].trim());
    expect(grants).toEqual(["service_role"]);
    expect(flat).not.toMatch(/grant [a-z, ]+ on (table )?public\.llm_daily_usage/);
  });

  it("checks itself when applied: the four buckets are accepted, others are not, and nothing reachable by a client changed", () => {
    expect(flat).toMatch(/\bdo \$[a-z]*\$/);
    expect(flat).toMatch(/has_function_privilege\('anon'|has_function_privilege\(r, v_fn, 'execute'\)/);
  });
});

describe("0235: the rollback sits beside it, outside the migrations directory", () => {
  it("exists, and puts back the two-bucket list in both places", () => {
    expect(existsSync(ROLLBACK)).toBe(true);
    const rb = existsSync(ROLLBACK) ? readFileSync(ROLLBACK, "utf8").replace(/\s+/g, " ").toLowerCase() : "";
    expect(rb).toContain("check (bucket in ('farah_chat', 'farah_chat_half_warned'))");
    expect(rb).toContain("p_bucket not in ('farah_chat', 'farah_chat_half_warned')");
  });
});
