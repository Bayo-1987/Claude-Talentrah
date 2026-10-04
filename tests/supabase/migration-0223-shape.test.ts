/**
 * Migration 0223 (the daily LLM usage counter) — its shape, read from the file (no database). The behaviour is in
 * tests/farah/llm-usage-counter.test.ts and the grants in tests/rls/llm-usage-grants.test.ts; this pins what a reviewer would otherwise have to
 * find by reading the SQL, and what would not fail any behavioural test until somebody was hurt by it.
 *
 * Written before the migration exists: every test here is red until 0223 is written.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FILE = join(__dirname, "../../supabase/migrations/0223_llm_daily_usage.sql");
const sql = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const flat = code.replace(/\s+/g, " ").toLowerCase();

describe("0223: the file", () => {
  it("exists, under this exact name (0223 is the number registered for it)", () => {
    expect(existsSync(FILE)).toBe(true);
    expect(code.trim().length).toBeGreaterThan(0);
  });
});

describe("0223: the table", () => {
  it("is public.llm_daily_usage with a (day, bucket) key and a bigint nano-dollar total that cannot go negative", () => {
    expect(flat).toMatch(/create table (if not exists )?public\.llm_daily_usage/);
    expect(flat).toMatch(/day date not null/);
    expect(flat).toMatch(/bucket text not null/);
    expect(flat).toMatch(/nano_usd bigint not null default 0/);
    expect(flat).toMatch(/primary key \(day, bucket\)/);
    expect(flat).toMatch(/check \(nano_usd >= 0\)/);
  });

  it("allows only the two known buckets, in the table itself as well as in the function", () => {
    expect(flat).toMatch(/check \(bucket in \('farah_chat', 'farah_chat_half_warned'\)\)/);
  });

  it("is closed to clients: an explicit REVOKE ALL from public, anon and authenticated; RLS on; no policies", () => {
    expect(flat).toMatch(/revoke all on (table )?public\.llm_daily_usage from public, anon, authenticated/);
    expect(flat).toMatch(/alter table public\.llm_daily_usage enable row level security/);
    expect(flat).not.toMatch(/create policy/);
    expect(flat).not.toMatch(/grant [a-z, ]+ on (table )?public\.llm_daily_usage to (public|anon|authenticated)/);
  });

  it("does not touch any other table, and drops nothing", () => {
    const alters = [...flat.matchAll(/alter table (?:if exists )?(?:only )?([a-z_.]+)/g)].map((m) => m[1]);
    expect(alters.length).toBeGreaterThan(0);
    expect(alters.every((t) => t === "public.llm_daily_usage")).toBe(true);
    expect(flat).not.toMatch(/\bdrop (table|function|column|policy|trigger)\b/);
  });
});

describe("0223: public.add_llm_usage(p_bucket text, p_nano bigint) returns bigint", () => {
  it("is SECURITY INVOKER (never DEFINER), plpgsql, with search_path pinned to empty", () => {
    expect(flat).toMatch(/function public\.add_llm_usage\(p_bucket text, p_nano bigint\) returns bigint/);
    expect(flat).toMatch(/security invoker/);
    expect(flat).not.toMatch(/security definer/);
    expect(flat).toMatch(/set search_path = ''/);
  });

  it("takes the day from the DATABASE clock, in UTC, and takes no day argument", () => {
    expect(flat).toMatch(/\(now\(\) at time zone 'utc'\)::date/);
    expect(flat).not.toMatch(/p_day/);
    expect(flat).not.toMatch(/current_date/);
  });

  it("adds in ONE statement (insert ... on conflict do update), not a read then a write", () => {
    expect(flat).toMatch(/insert into public\.llm_daily_usage .* on conflict \(day, bucket\) do update set nano_usd = (public\.)?llm_daily_usage\.nano_usd \+ /);
  });

  it("rejects a null or unknown bucket, a null or negative amount, and an amount above 100,000,000,000 nano-dollars ($100)", () => {
    expect(flat).toMatch(/p_bucket is null/);
    expect(flat).toMatch(/p_bucket not in \('farah_chat', 'farah_chat_half_warned'\)/);
    expect(flat).toMatch(/p_nano is null/);
    expect(flat).toMatch(/p_nano < 0/);
    expect(flat).toMatch(/p_nano > 100000000000/);
    expect((flat.match(/raise exception/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(flat).toMatch(/errcode = '22023'/);
  });

  it("is executable by service_role ONLY: revoked from public, anon and authenticated, granted to service_role, granted to no one else", () => {
    expect(flat).toMatch(/revoke (all|execute) on function public\.add_llm_usage\(text, bigint\) from public, anon, authenticated/);
    expect(flat).toMatch(/grant execute on function public\.add_llm_usage\(text, bigint\) to service_role/);
    const grants = [...flat.matchAll(/grant execute on function public\.add_llm_usage\(text, bigint\) to ([a-z_, ]+)/g)].map((m) => m[1].trim());
    expect(grants).toEqual(["service_role"]);
  });
});

describe("0223: checks itself when it is applied", () => {
  it("has a DO block that fails the apply if RLS is off or a client role holds any privilege on the table or can execute the function", () => {
    expect(flat).toMatch(/do \$\$/);
    expect(flat).toMatch(/relrowsecurity/);
    expect(flat).toMatch(/has_table_privilege/);
    expect(flat).toMatch(/has_function_privilege/);
  });
});
