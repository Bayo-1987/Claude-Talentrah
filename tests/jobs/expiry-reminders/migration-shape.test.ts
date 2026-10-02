/**
 * Static checks on 0207 that hold with no database: the table is locked, every function is service-role only with an
 * empty search_path, every function that selects or moves a posting says `internal`, and nothing is backfilled. The
 * database-backed twin is expiry-reminders-db.test.ts; this one keeps a later edit to the SQL from quietly dropping a
 * guard on a machine with no database.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXTEND_DAYS } from "@/lib/jobs/expiry-reminders/constants";

const sql = readFileSync(
  path.join(__dirname, "../../../supabase/migrations/0207_job_expiry_reminders.sql"),
  "utf8",
);
/** The SQL with `--` comment lines removed, so a guard mentioned only in prose does not count. */
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

const FUNCTIONS = [
  "expiry_reminder_window_ok(timestamptz, timestamptz)",
  "due_job_expiry_reminders(timestamptz, int)",
  "claim_job_expiry_reminder(uuid, text, timestamptz)",
  "redeem_job_expiry_extend_token(text, timestamptz)",
  "job_expiry_function_definition(text)",
];

function body(fn: string): string {
  const start = code.indexOf(`create or replace function public.${fn}(`);
  expect(start, `${fn} is defined`).toBeGreaterThan(-1);
  const end = code.indexOf("$$;", code.indexOf("$$", start + 1) + 2);
  return code.slice(start, end);
}

describe("0207", () => {
  it("enables RLS, defines no policy, and revokes everything from public, anon and authenticated", () => {
    expect(code).toMatch(/alter table public\.job_expiry_reminders enable row level security/);
    expect(code).not.toMatch(/create policy/i);
    expect(code).toMatch(/revoke all on public\.job_expiry_reminders from public, anon, authenticated/);
  });

  it("makes a posting reminded once per closing date, and stores only a token hash", () => {
    expect(code).toMatch(/unique \(job_posting_id, closes_at\)/);
    expect(code).toMatch(/token_hash text not null unique/);
    expect(code).not.toMatch(/\btoken text\b/);
  });

  it.each(["due_job_expiry_reminders", "claim_job_expiry_reminder", "redeem_job_expiry_extend_token"])(
    "%s only ever touches internal, open postings",
    (fn) => {
      const b = body(fn);
      expect(b).toContain("source_type = 'internal'");
      expect(b).toContain("status = 'open'");
    },
  );

  it("revokes EXECUTE from PUBLIC, anon and authenticated, then grants service_role only, for every function", () => {
    for (const fn of FUNCTIONS) {
      expect(code).toContain(`revoke execute on function public.${fn} from public, anon, authenticated;`);
      expect(code).toContain(`grant execute on function public.${fn} to service_role;`);
    }
    // And never to anyone else.
    const grants = code.match(/grant execute on function[^;]*;/g) ?? [];
    expect(grants).toHaveLength(FUNCTIONS.length);
    for (const g of grants) expect(g).toMatch(/ to service_role;$/);
  });

  it("pins an empty search_path on every function", () => {
    for (const fn of FUNCTIONS) {
      const name = fn.split("(")[0];
      expect(body(name), `${name} must set search_path = ''`).toContain("set search_path = ''");
      expect(body(name)).not.toMatch(/search_path\s*=\s*public/);
    }
  });

  it("schema-qualifies every table it touches (nothing resolves through the search_path)", () => {
    for (const fn of FUNCTIONS) {
      const b = body(fn.split("(")[0]);
      for (const m of b.matchAll(/\b(?:from|join|update|into)\s+([a-z_.]+)/g)) {
        const target = m[1];
        // `into r` / `into v_title` in plpgsql are variables, not tables.
        // `do update set ...` (ON CONFLICT) is a keyword pair, not a relation.
        if (/^(r|set|v_[a-z]+|public\.[a-z_]+|pg_catalog\.[a-z_]+)$/.test(target)) continue;
        expect.soft(target, `unqualified relation in ${fn}`).toMatch(/^(public|pg_catalog)\./);
      }
    }
  });

  it("the window is 'closes within the next 3 days' and lives in one function used by both the listing and the claim", () => {
    const w = body("expiry_reminder_window_ok");
    expect(w).toContain("p_closes_at >  p_now");
    expect(w).toContain("p_closes_at <= p_now + interval '3 days'");
    expect(w).not.toContain("2 days");
    expect(body("due_job_expiry_reminders")).toContain("expiry_reminder_window_ok");
    expect(body("claim_job_expiry_reminder")).toContain("expiry_reminder_window_ok");
  });

  it("extends by exactly the number of days the email and page quote", () => {
    expect(body("redeem_job_expiry_extend_token")).toContain(`interval '${EXTEND_DAYS} days'`);
  });

  it("backfills nothing: the only write to job_postings is the conditional extend inside redeem", () => {
    const writes = [...code.matchAll(/\b(update|insert\s+into|delete\s+from)\s+public\.job_postings\b/g)];
    expect(writes).toHaveLength(1);
    const redeem = body("redeem_job_expiry_extend_token");
    expect(redeem).toMatch(/update public\.job_postings j\s+set expires_at = j\.expires_at \+ interval/);
    // A conditional extend, not a blanket one.
    expect(redeem).toMatch(/where j\.id = r\.job_posting_id\s+and j\.source_type = 'internal'/);
  });

  describe("closing_date_source on job_postings (it ALTERS an existing table)", () => {
    it("says so in its header", () => {
      expect(sql).toMatch(/ALTERS an existing table/);
      expect(sql).toMatch(/no rewrite/i);
      expect(sql).toMatch(/no backfill/i);
    });

    it("adds one nullable text column with NO default (so no table rewrite)", () => {
      const stmt = code.match(/alter table public\.job_postings\s+add column if not exists closing_date_source[^;]*;/)?.[0];
      expect(stmt, "the ALTER TABLE ... ADD COLUMN statement").toBeDefined();
      expect(stmt).toMatch(/closing_date_source text\s*;/);
      expect(stmt).not.toMatch(/default|not null/i);
    });

    it("allows only 'default' and 'chosen'", () => {
      expect(code).toMatch(/check \(closing_date_source in \('default', 'chosen'\)\)/);
    });

    it("is not writable by a client: a guard trigger refuses authenticated and anon on INSERT and UPDATE", () => {
      const fn = body("job_postings_guard_closing_date_source");
      expect(fn).toContain("current_user in ('authenticated', 'anon')");
      expect(fn).toContain("tg_op = 'INSERT'");
      expect(fn).toContain("'42501'");
      expect(fn).toContain("set search_path = ''");
      expect(code).toContain(
        "revoke execute on function public.job_postings_guard_closing_date_source() from public, anon, authenticated;",
      );
      expect(code).toMatch(
        /create trigger job_postings_guard_closing_date_source\s+before insert or update on public\.job_postings/,
      );
    });

    it("grants UPDATE on it to nobody (the table's column-grant model leaves a new column ungranted)", () => {
      expect(code).not.toMatch(/grant\s+update\s*\(?[^;]*closing_date_source/i);
      expect(code).not.toMatch(/grant\s+(all|insert)[^;]*job_postings/i);
    });

    it("the closing self-check confirms the column and the constraint exist", () => {
      const doBlock = code.slice(code.lastIndexOf("do $$"));
      expect(doBlock).toContain("closing_date_source");
      expect(doBlock).toContain("job_postings_closing_date_source_check");
    });
  });

  it("depends on nothing from 0204-0206 (it must apply on a database that has 0203 and none of them)", () => {
    for (const col of ["superseded_at", "close_time", "close_tz", "waitlist", "talent_directory_preview"]) {
      expect(code, `0207 must not reference ${col}`).not.toContain(col);
    }
  });
});
