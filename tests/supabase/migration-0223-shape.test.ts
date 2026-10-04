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
    expect(flat).toMatch(/\(pg_catalog\.now\(\) at time zone 'utc'\)::date/);
    expect(flat).not.toMatch(/p_day/);
    expect(flat).not.toMatch(/current_date/);
  });

  it("adds in ONE statement (insert ... on conflict do update), not a read then a write", () => {
    expect(flat).toMatch(/insert into public\.llm_daily_usage as u \(day, bucket, nano_usd\) values .* on conflict \(day, bucket\) do update set nano_usd = u\.nano_usd \+ excluded\.nano_usd returning u\.nano_usd into v_total/);
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

describe("0223: service_role's own privileges are written out, not left to Supabase's default privileges", () => {
  it("revokes everything from service_role first, then grants exactly select, insert, update on the table", () => {
    expect(flat).toMatch(/revoke all on (table )?public\.llm_daily_usage from public, anon, authenticated, service_role/);
    expect(flat).toMatch(/grant select, insert, update on (table )?public\.llm_daily_usage to service_role/);
    expect(flat).not.toMatch(/grant [a-z, ]*(delete|truncate|all)[a-z, ]* on (table )?public\.llm_daily_usage/);
  });

  it("does the same for the function: revoked from service_role too, then an explicit grant of execute", () => {
    expect(flat).toMatch(/revoke all on function public\.add_llm_usage\(text, bigint\) from public, anon, authenticated, service_role/);
    expect(flat).toMatch(/grant execute on function public\.add_llm_usage\(text, bigint\) to service_role/);
  });
});

describe("0223: under an empty search_path every table and function the body names is schema-qualified", () => {
  const body = /returns bigint language plpgsql security invoker set search_path = '' as \$\$([\s\S]*?)\$\$;/.exec(flat)?.[1] ?? "";

  it("found the function body", () => {
    expect(body.length).toBeGreaterThan(100);
  });

  it("every mention of the table is public.llm_daily_usage, and now() is pg_catalog.now()", () => {
    expect(body).toMatch(/public\.llm_daily_usage/);
    expect(body.replace(/public\.llm_daily_usage/g, "").includes("llm_daily_usage")).toBe(false);
    expect(/(?<!pg_catalog\.)\bnow\(\)/.test(body)).toBe(false);
    expect(body).toMatch(/pg_catalog\.now\(\)/);
  });

  it("calls no other function, and reads no other table (only the one insert, qualified)", () => {
    const calls = [...body.matchAll(/\b([a-z_][a-z0-9_.]*)\(/g)].map((m) => m[1]).filter((n) => !["in", "values", "insert"].includes(n));
    expect(calls.every((n) => n === "pg_catalog.now" || n === "add_llm_usage" || n.startsWith("public."))).toBe(true);
    expect([...body.matchAll(/\b(?:from|join|into) ([a-z_][a-z0-9_.]*)/g)].map((m) => m[1]).filter((n) => n !== "v_total")).toEqual(["public.llm_daily_usage"]);
  });
});

describe("0223: the add is ONE statement (insert ... on conflict ... do update), never a read followed by a write", () => {
  const fn = /returns bigint language plpgsql security invoker set search_path = '' as \$\$([\s\S]*?)\$\$;/.exec(flat)?.[1] ?? "";
  const afterBegin = fn.slice(fn.indexOf(" begin ") + 7);

  it("found the function body", () => {
    expect(fn.length).toBeGreaterThan(100);
  });

  it("has exactly one insert, and the only update is the one inside that insert's ON CONFLICT clause", () => {
    expect((fn.match(/\binsert into\b/g) ?? []).length).toBe(1);
    expect((fn.match(/on conflict \(day, bucket\) do update set/g) ?? []).length).toBe(1);
    expect(fn.replace(/do update set/g, "").match(/\bupdate\b/g)).toBeNull();
  });

  it("reads nothing first: no select, no perform, no row lock, no delete", () => {
    expect(fn.match(/\bselect\b/g)).toBeNull();
    expect(fn.match(/\bperform\b/g)).toBeNull();
    expect(fn.match(/\bfor (update|share|no key update)\b/g)).toBeNull();
    expect(fn.match(/\bdelete\b/g)).toBeNull();
  });

  it("adds to the STORED value inside the statement (u.nano_usd + excluded.nano_usd), and the result variable is not read before the insert", () => {
    expect(fn).toMatch(/do update set nano_usd = u\.nano_usd \+ excluded\.nano_usd returning u\.nano_usd into v_total/);
    expect(afterBegin.slice(0, afterBegin.indexOf("insert into")).includes("v_total")).toBe(false);
  });
});

describe("0223: the migration says plainly that one bucket stores a count, not money", () => {
  it("has a comment on the nano_usd column AND a header paragraph, both naming farah_chat_half_warned as a call count", () => {
    expect(sql).toMatch(/comment on column public\.llm_daily_usage\.nano_usd is[\s\S]*farah_chat_half_warned[\s\S]*CALL COUNT/);
    expect(sql).toMatch(/-- TWO BUCKETS, and the second one is not money/);
    expect(sql).toMatch(/is acceptable because/);
  });
});

describe("0223: checks itself when it is applied", () => {
  it("has a DO block that fails the apply if RLS is off or a client role holds any privilege on the table or can execute the function", () => {
    expect(flat).toMatch(/do \$[a-z]*\$/);
    expect(flat).toMatch(/relrowsecurity/);
    expect(flat).toMatch(/has_table_privilege/);
    expect(flat).toMatch(/has_function_privilege/);
  });
});
