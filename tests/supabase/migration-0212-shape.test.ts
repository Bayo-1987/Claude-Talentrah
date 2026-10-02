/**
 * ACCT-1 PR 1 — migration 0212's shape, read from the file (no database). The behaviour is in tests/rls/account-deletion-*.test.ts; this pins the
 * properties a reviewer would otherwise have to find by reading 48 KB of SQL, and the ones whose loss would not fail any behavioural test until
 * somebody was hurt by it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(__dirname, "../../supabase/migrations/0212_account_deletion_request.sql"), "utf8");
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("0212: the request table", () => {
  it("has NO foreign key to profiles: the record must outlive the account it describes", () => {
    const table = /create table if not exists public\.account_deletions \(([\s\S]*?)\n\);/.exec(code)![1];
    expect(table).not.toMatch(/references/i);
  });

  it("stores only a hash of the token, never the token", () => {
    const table = /create table if not exists public\.account_deletions \(([\s\S]*?)\n\);/.exec(code)![1];
    expect(table).toMatch(/token_hash\s+text not null/);
    expect(table).not.toMatch(/\btoken\s+text/);
  });

  it("is closed to clients: RLS on, no grants, no policies", () => {
    expect(code).toMatch(/alter table public\.account_deletions enable row level security/);
    expect(code).toMatch(/revoke all on public\.account_deletions from anon, authenticated/);
    expect(code).not.toMatch(/create policy[^;]*account_deletions/i);
    expect(code).not.toMatch(/grant [^;]*on public\.account_deletions/i);
  });

  it("carries the refund columns as nullable and unused, so a refund policy needs no migration", () => {
    expect(code).toMatch(/refund_policy\s+text,/);
    expect(code).toMatch(/refund_note\s+text\s*\n/);
  });

  it("allows the 'purged' status now, so the purge PR needs no check-constraint migration", () => {
    expect(code).toMatch(/'pending_confirmation', 'scheduled', 'restored', 'superseded', 'purged'/);
  });
});

describe("0212: who can call what", () => {
  it.each(["account_deletion_blockers(uuid)", "account_deletion_create_request(uuid, text)", "account_deletion_confirm(uuid, text)"])(
    "%s is revoked from public, anon and authenticated and granted to service_role only",
    (fn) => {
      const esc = fn.replace(/[()]/g, "\\$&");
      expect(code).toMatch(new RegExp(`revoke execute on function public\\.${esc} from public, anon, authenticated`));
      expect(code).toMatch(new RegExp(`grant execute on function public\\.${esc} to service_role;`));
    },
  );

  it("restore and status are the only calls a signed-in person gets, and never anon", () => {
    for (const fn of ["account_deletion_status()", "account_deletion_restore()"]) {
      const esc = fn.replace(/[()]/g, "\\$&");
      expect(code).toMatch(new RegExp(`revoke execute on function public\\.${esc} from public, anon;`));
      expect(code).toMatch(new RegExp(`grant execute on function public\\.${esc} to authenticated, service_role;`));
    }
  });

  it("account_is_active is executable by authenticated (RLS policies call it) and not by anon", () => {
    expect(code).toMatch(/revoke execute on function public\.account_is_active\(uuid\) from public, anon;/);
    expect(code).toMatch(/grant execute on function public\.account_is_active\(uuid\) to authenticated, service_role;/);
  });

  it("every function it creates pins search_path", () => {
    const creates = code.match(/create or replace function public\.account_[a-z_]+\([^)]*\)[\s\S]*?(?=\n\$\$;|\n\$function\$;)/g) ?? [];
    expect(creates.length).toBe(6);
    for (const c of creates) expect(c).toMatch(/set search_path/);
  });

  it("the profiles flag has no client UPDATE grant added (and the self-check asserts it)", () => {
    expect(code).not.toMatch(/grant update[^;]*deletion_requested_at/i);
    expect(code).toMatch(/has_column_privilege\('authenticated', 'public\.profiles', 'deletion_requested_at', 'update'\)/);
  });
});

describe("0212: the numbers the owner decided", () => {
  it("the link lives one hour and the hard delete is 30 days out", () => {
    expect(code).toMatch(/interval '1 hour'/);
    expect(code).toMatch(/interval '30 days'/);
  });
  it("at most three requests an hour", () => {
    expect(code).toMatch(/v_recent >= 3/);
  });
});

describe("0212: hiding", () => {
  it.each([
    "talent_directory_listed_ids",
    "talent_directory_portfolio_items",
    "request_talent_directory_contact",
    "employer_job_applicants",
    "employer_application_screening_answers",
    "employer_resume_view_context",
    "employer_view_resume",
    "record_employer_resume_view",
    "org_application_counts",
    "can_access_assessment_submission",
    "referral_leaderboard",
    "open_mentor_slots",
    "mentor_public_names",
    "book_mentor_session",
  ])("%s is rewritten to read the flag", (fn) => {
    const m = new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?\\n\\$function\\$;`).exec(code);
    expect(m, `${fn} must be rewritten`).not.toBeNull();
    expect(m![0]).toMatch(/deletion_requested_at is null|account_is_active\(/);
  });

  it("the two mentor SELECT policies are altered by their current name (read from pg_policies), not retyped", () => {
    expect(code).toMatch(/alter policy %I on public\.mentor_profiles using/);
    expect(code).toMatch(/alter policy %I on public\.mentor_availability_slots using/);
  });

  it("the applicant's own access to their own upload is not gated on the flag", () => {
    const m = /create or replace function public\.can_access_assessment_submission[\s\S]*?\n\$function\$;/.exec(code)![0];
    expect(m).toMatch(/a\.user_id = \(select auth\.uid\(\)\)\s*\n\s*or \(public\.is_org_member/);
  });
});

describe("0212: what it must not do", () => {
  it("deletes nothing real: the only DELETE is the test-pool reset of request rows", () => {
    const deletes = code.match(/delete from public\.[a-z_]+/gi) ?? [];
    expect(deletes.every((d) => /account_deletions|mentor_payouts|mentorship_reviews|mentorship_sessions/.test(d))).toBe(true);
    expect(code).not.toMatch(/drop table|truncate|drop column|alter table[^;]*drop constraint/i);
  });
  it("does not touch grants on any table other than account_deletions", () => {
    expect(code.match(/revoke [a-z ,]+ on public\.[a-z_]+ from/gi)).toEqual(["revoke all on public.account_deletions from"]);
  });
  it("ends with a self-check that fails the migration when a grant is wrong", () => {
    expect(code).toMatch(/raise exception 'self-check: %s? is callable by a client role'|raise exception 'self-check: % is callable by a client role'/);
  });
});
