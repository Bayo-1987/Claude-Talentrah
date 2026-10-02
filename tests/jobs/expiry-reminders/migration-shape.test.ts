/**
 * Static checks on 0207 that hold with no database: the table is locked, every function is service-role only, and every
 * function that selects or moves a posting says `internal`. The database-backed twin is expiry-reminders-db.test.ts;
 * this one is what keeps a later edit to the SQL from quietly dropping a guard on a machine with no database.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.join(__dirname, "../../../supabase/migrations/0207_job_expiry_reminders.sql"),
  "utf8",
);
/** The SQL with `--` comment lines removed, so a guard mentioned only in prose does not count. */
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

function body(fn: string): string {
  const start = code.indexOf(`create or replace function public.${fn}(`);
  expect(start, `${fn} is defined`).toBeGreaterThan(-1);
  const end = code.indexOf("$$;", code.indexOf("$$", start + 1) + 2);
  return code.slice(start, end);
}

describe("0207", () => {
  it("enables RLS, defines no policy, and revokes everything from anon and authenticated", () => {
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

  it("grants every function to service_role only", () => {
    for (const fn of [
      "expiry_reminder_window_ok(timestamptz, timestamptz)",
      "due_job_expiry_reminders(timestamptz, int)",
      "claim_job_expiry_reminder(uuid, text, timestamptz)",
      "redeem_job_expiry_extend_token(text, timestamptz)",
    ]) {
      expect(code).toContain(`revoke all on function public.${fn} from public, anon, authenticated`);
      expect(code).toContain(`grant execute on function public.${fn} to service_role`);
    }
  });

  it("reads the window from one function, with the bounds the comments promise", () => {
    expect(body("expiry_reminder_window_ok")).toContain("p_now + interval '2 days'");
    expect(body("expiry_reminder_window_ok")).toContain("p_now + interval '3 days 1 hour'");
    expect(body("due_job_expiry_reminders")).toContain("expiry_reminder_window_ok");
    expect(body("claim_job_expiry_reminder")).toContain("expiry_reminder_window_ok");
  });
});
