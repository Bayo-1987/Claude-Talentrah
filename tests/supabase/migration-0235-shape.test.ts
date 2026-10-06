/**
 * Migration 0235 (the operator alerts on Farah's daily spend ceiling: one small table and two functions that decide, in the database, who may try to send today's alert and when it counts as sent)
 * — its shape, read from the file (no database). The behaviour is in tests/farah/llm-alert-attempts.test.ts; this pins what a reviewer would otherwise have to find by reading the SQL.
 *
 * WHAT IT IS. An alert (the 80% one, the "reached" one) is a convenience, and the day's alert must not be lost because one send failed. So "today's alert is done" is recorded only AFTER a send succeeds,
 * and a failed send can be tried again on a later request the same day, at most MAX attempts, with only one attempt in flight at a time (a short lease). Two functions do it in one statement each:
 *   claim_llm_alert_attempt(alert, max_attempts, lease_seconds)  -> true for the caller that may try the send now
 *   mark_llm_alert_sent(alert)                                    -> records that the send succeeded; true for the caller that recorded it
 * It touches NOTHING that exists: not llm_daily_usage and not add_llm_usage (0223's objects stay exactly as they are).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FILE = join(__dirname, "../../supabase/migrations/0235_llm_daily_usage_alert_markers.sql");
const ROLLBACK = join(__dirname, "../../supabase/rollbacks/0235_llm_daily_usage_alert_markers.rollback.sql");
const strip = (t: string) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/\s+/g, " ").toLowerCase();
const sql = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
const flat = strip(sql);
const T = "public.llm_daily_usage_alert_markers";

describe("0235: the file", () => {
  it("exists, under this exact name (0235 is the number registered for it)", () => {
    expect(existsSync(FILE)).toBe(true);
  });
});

describe("0235: it adds one table and two functions and touches nothing that exists", () => {
  it("creates exactly one table, with the five columns", () => {
    expect((flat.match(/\bcreate table\b/g) ?? []).length).toBe(1);
    expect(flat).toContain(`create table ${T} (`);
    expect(flat).toMatch(/day date not null/);
    expect(flat).toMatch(/alert text not null/);
    expect(flat).toMatch(/attempts integer not null default 0/);
    expect(flat).toMatch(/last_attempt_at timestamptz(?! not null)/);
    expect(flat).toMatch(/sent_at timestamptz(?! not null)/);
    expect(flat).toMatch(/primary key \(day, alert\)/);
  });

  it("limits the alert to the two known names and the attempt counter to a small range (a bug cannot write a third alert or a runaway counter)", () => {
    expect(flat).toMatch(/check \(alert in \('eighty', 'reached'\)\)/);
    expect(flat).toMatch(/check \(attempts between 0 and 10\)/);
  });

  it("does not alter, drop or redefine anything from 0223: not llm_daily_usage, not add_llm_usage", () => {
    expect(flat).not.toMatch(/\balter table\b(?! public\.llm_daily_usage_alert_markers)/);
    expect(flat).not.toMatch(/\bdrop\b/);
    expect(flat).not.toMatch(/public\.add_llm_usage/);
    expect(flat).not.toMatch(/(insert into|update|delete from|from) public\.llm_daily_usage\b(?!_)/);
  });

  it("creates exactly two functions", () => {
    expect((flat.match(/\bcreate (or replace )?function\b/g) ?? []).length).toBe(2);
    expect(flat).toContain("create or replace function public.claim_llm_alert_attempt(");
    expect(flat).toContain("create or replace function public.mark_llm_alert_sent(");
  });

  it("deletes no row and truncates nothing", () => {
    expect(flat).not.toMatch(/\bdelete from\b/);
    expect(flat).not.toMatch(/\btruncate (table )?(only )?public\./);
  });
});

describe("0235: the table is server-only", () => {
  it("row level security on, and no policy at all", () => {
    expect(flat).toContain(`alter table ${T} enable row level security`);
    expect(flat).not.toMatch(/\bcreate policy\b/);
  });

  it("every privilege revoked from everyone, then select, insert and update (not delete) granted to service_role only", () => {
    expect(flat).toContain(`revoke all on table ${T} from public, anon, authenticated, service_role`);
    const grants = [...flat.matchAll(new RegExp(`grant ([a-z, ]+) on table ${T.replace(".", "\\.")} to ([a-z_, ]+)`, "g"))].map((m) => `${m[1].trim()} -> ${m[2].trim()}`);
    expect(grants).toEqual(["select, insert, update -> service_role"]);
  });
});

describe("0235: claim_llm_alert_attempt: one statement decides, in the database, who may try now", () => {
  const claim = flat.slice(flat.indexOf("create or replace function public.claim_llm_alert_attempt("), flat.indexOf("create or replace function public.mark_llm_alert_sent("));

  it("signature, defaults (3 attempts, a 10 second lease), returns boolean, SECURITY INVOKER, search_path pinned to empty", () => {
    expect(claim).toContain("claim_llm_alert_attempt(p_alert text, p_max_attempts integer default 3, p_lease_seconds integer default 10) returns boolean");
    expect(claim).toMatch(/language plpgsql security invoker set search_path = ''/);
    expect(claim).not.toMatch(/security definer/);
  });

  it("refuses an unknown alert and out-of-range limits with SQLSTATE 22023, so a bad caller cannot switch the bounds off", () => {
    expect(claim).toMatch(/p_alert is null or p_alert not in \('eighty', 'reached'\)/);
    expect(claim).toMatch(/p_max_attempts is null or p_max_attempts < 1 or p_max_attempts > 10/);
    expect(claim).toMatch(/p_lease_seconds is null or p_lease_seconds < 0 or p_lease_seconds > 600/);
    expect((claim.match(/errcode = '22023'/g) ?? []).length).toBe(3);
  });

  it("is ONE insert ... on conflict do update ... where (the check and the increment are the same statement), keyed on the DATABASE's UTC day", () => {
    expect((claim.match(/\binsert into\b/g) ?? []).length).toBe(1);
    expect(claim).toContain(`insert into ${T} as m (day, alert, attempts, last_attempt_at)`);
    expect(claim).toMatch(/values \(\(pg_catalog\.now\(\) at time zone 'utc'\)::date, p_alert, 1, pg_catalog\.now\(\)\)/);
    expect(claim).toMatch(/on conflict \(day, alert\) do update set attempts = m\.attempts \+ 1, last_attempt_at = pg_catalog\.now\(\)/);
  });

  it("the three conditions: not already sent, fewer than the maximum attempts, and the previous attempt's lease has run out", () => {
    expect(claim).toMatch(/where m\.sent_at is null and m\.attempts < p_max_attempts and \(m\.last_attempt_at is null or m\.last_attempt_at <= pg_catalog\.now\(\) - pg_catalog\.make_interval\(secs => p_lease_seconds\)\)/);
  });

  it("returns whether this caller got the attempt (a row came back from the statement)", () => {
    expect(claim).toMatch(/returning m\.attempts into v_attempts/);
    expect(claim).toMatch(/return v_attempts is not null/);
  });
});

describe("0235: mark_llm_alert_sent: records the success, once", () => {
  const mark = flat.slice(flat.indexOf("create or replace function public.mark_llm_alert_sent("));

  it("signature, returns boolean, SECURITY INVOKER, search_path pinned to empty, unknown alert refused with 22023", () => {
    expect(mark).toContain("mark_llm_alert_sent(p_alert text) returns boolean");
    expect(mark).toMatch(/language plpgsql security invoker set search_path = ''/);
    expect(mark).toMatch(/p_alert is null or p_alert not in \('eighty', 'reached'\)/);
    expect(mark).toMatch(/errcode = '22023'/);
  });

  it("is ONE update of today's row that was attempted and is not yet marked (so a second mark, or a mark with no attempt, gets false), and it deletes nothing", () => {
    expect((mark.match(/\bupdate public\./g) ?? []).length).toBe(1);
    expect(mark).toMatch(new RegExp(`update ${T.replace(".", "\\.")} set sent_at = pg_catalog\\.now\\(\\) where day = \\(pg_catalog\\.now\\(\\) at time zone 'utc'\\)::date and alert = p_alert and attempts > 0 and sent_at is null returning`));
  });
});

describe("0235: both functions are service_role only", () => {
  it("states the grants: revoked from everyone, executable by service_role only, for each of the two functions", () => {
    expect(flat).toContain("revoke all on function public.claim_llm_alert_attempt(text, integer, integer) from public, anon, authenticated, service_role");
    expect(flat).toContain("revoke all on function public.mark_llm_alert_sent(text) from public, anon, authenticated, service_role");
    const grants = [...flat.matchAll(/grant execute on function (public\.[a-z_]+\([a-z, ]+\)) to ([a-z_, ]+)/g)].map((m) => `${m[1]} -> ${m[2].trim()}`);
    expect(grants).toEqual(["public.claim_llm_alert_attempt(text, integer, integer) -> service_role", "public.mark_llm_alert_sent(text) -> service_role"]);
  });

  it("checks itself when applied: no client role can execute either function or read the table, PUBLIC cannot, service_role can, neither is SECURITY DEFINER, RLS is on with no policy", () => {
    expect(flat).toMatch(/\bdo \$[a-z]*\$/);
    expect(flat).toMatch(/has_function_privilege\(r, [a-z_]+, 'execute'\)/);
    expect(flat).toMatch(/v_table oid := 'public\.llm_daily_usage_alert_markers'::regclass/);
    expect(flat).toMatch(/has_table_privilege\(r, v_table, 'select, insert, update, delete, truncate, references, trigger'\)/);
    expect(flat).toMatch(/relrowsecurity/);
    expect(flat).toMatch(/prosecdef/);
    expect(flat).toMatch(/pg_policy/);
    expect(flat).toMatch(/raise exception '0235 self-check/);
  });
});

describe("0235: the rollback sits beside it, outside the migrations directory", () => {
  const rb = existsSync(ROLLBACK) ? strip(readFileSync(ROLLBACK, "utf8")) : "";

  it("exists", () => {
    expect(existsSync(ROLLBACK)).toBe(true);
  });

  it("drops the two functions (with their exact argument lists) and then the table, and nothing else", () => {
    const drops = [...rb.matchAll(/\bdrop (function|table)\b ([^;]+);/g)].map((m) => `${m[1]} ${m[2].trim()}`);
    expect(drops).toEqual([
      "function public.claim_llm_alert_attempt(text, integer, integer)",
      "function public.mark_llm_alert_sent(text)",
      `table ${T}`,
    ]);
    expect(rb).not.toMatch(/\bdelete\b|\btruncate\b|alter table|add_llm_usage|public\.llm_daily_usage\b(?!_)/);
  });

  it("checks that all three are gone", () => {
    expect(rb).toMatch(/\bdo \$[a-z]*\$/);
    expect(rb).toMatch(/raise exception '0235 rollback self-check/);
  });
});
