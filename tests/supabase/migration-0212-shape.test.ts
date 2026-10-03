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
    const creates = code.match(/create or replace function public\.[a-z_]+\([^)]*\)[\s\S]*?(?=\n\$\$;)/g) ?? [];
    expect(creates.length).toBe(11);
    for (const c of creates) expect(c).toMatch(/set search_path = ''/);
  });

  it("the helper functions and the two signed-in calls are executable by authenticated and never by anon", () => {
    for (const fn of ["application_applicant_is_active(uuid)", "submission_applicant_is_active(uuid)"]) {
      const esc = fn.replace(/[()]/g, "\\$&");
      expect(code).toMatch(new RegExp(`revoke execute on function public\\.${esc} from public, anon;`));
      expect(code).toMatch(new RegExp(`grant execute on function public\\.${esc} to authenticated, service_role;`));
    }
  });

  it("the precheck, the renewal stop and the audit function are service-role only", () => {
    for (const fn of ["account_deletion_confirm_precheck(uuid, text)", "account_deletion_stop_renewals(uuid)", "function_acl_audit()"]) {
      const esc = fn.replace(/[()]/g, "\\$&");
      expect(code).toMatch(new RegExp(`revoke execute on function public\\.${esc} from public, anon, authenticated`));
      expect(code).toMatch(new RegExp(`grant execute on function public\\.${esc} to service_role;`));
    }
  });

  it("the profiles flag has no client UPDATE grant added (and the self-check asserts it)", () => {
    expect(code).not.toMatch(/grant update[^;]*deletion_requested_at/i);
    expect(code).toMatch(/has_column_privilege\('authenticated', 'public\.profiles', 'deletion_requested_at', 'update'\)/);
  });
});

describe("0212: the renewal stop that runs when the card was cancelled but the deletion was not scheduled", () => {
  const fn = /create or replace function public\.account_deletion_stop_renewals\([\s\S]*?\n\$\$;/.exec(code)?.[0] ?? "";

  it("exists, and does exactly what confirm does to renewals, in the same four columns the Billing page's own cancel writes", () => {
    expect(fn).not.toBe("");
    expect(fn).toMatch(/update public\.user_passes\s+set auto_renew = false, auto_renew_status = 'canceled', next_renewal_date = null, authorization_code = null/);
    expect(fn).toMatch(/update public\.talent_directory_subscriptions\s+set auto_renew_status = 'canceled', next_renewal_date = null, authorization_code = null/);
  });

  it("touches only the person's own ACTIVE renewals (and Talent Directory ones of organisations they created), and nothing else", () => {
    expect(fn).toMatch(/where user_id = p_user_id and auto_renew_status = 'active'/);
    expect(fn).toMatch(/created_by = p_user_id/);
    expect(fn).not.toMatch(/deletion_requested_at|insert into|delete from|auto_apply|job_postings|ad_campaigns/);
  });

  it("is idempotent (a second run changes nothing) and reports what it switched off", () => {
    expect(fn).toMatch(/get diagnostics/i);
    expect(fn).toMatch(/'passes'/);
    expect(fn).toMatch(/'subscriptions'/);
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

/** Every `pg_temp.patch_fn(sig, array[anchor, replacement, ...])` call, as { sig, pairs }. */
function patchCalls(text: string) {
  return [...text.matchAll(/select pg_temp\.patch_fn\(\$(x+)\$([\s\S]*?)\$\1\$, array\[([\s\S]*?)\], (?:true|false)\);/g)].map((m) => ({
    sig: m[2],
    lits: [...m[3].matchAll(/\$(x+)\$([\s\S]*?)\$\1\$/g)].map((l) => l[2]),
  }));
}
const FLAG = /deletion_requested_at is null|account_is_active\(|applicant_is_active\(|deletion_requested_at = null/;
const PATCHED = [
  "talent_directory_listed_ids()",
  "talent_directory_portfolio_items(uuid)",
  "request_talent_directory_contact(uuid, uuid, text, uuid)",
  "employer_job_applicants(uuid)",
  "employer_application_screening_answers(uuid)",
  "employer_resume_view_context(uuid)",
  "employer_view_resume(uuid)",
  "record_employer_resume_view(uuid)",
  "org_application_counts(uuid)",
  "can_access_assessment_submission(text)",
  "referral_leaderboard(timestamptz, timestamptz, integer)",
  "open_mentor_slots(uuid[], timestamptz)",
  "mentor_public_names(uuid[])",
  "book_mentor_session(uuid, uuid, text)",
  "mentorship_session_counterparty_names(uuid[])",
  "reset_test_pool_user(uuid, text)",
];

describe("0212: hiding, by patching the LIVE definitions", () => {
  const calls = patchCalls(sql);

  it("patches exactly the sixteen functions, once each", () => {
    expect(calls.map((c) => c.sig).sort()).toEqual(PATCHED.map((f) => `public.${f}`).sort());
  });

  it.each(PATCHED)("%s: the replacement adds the flag check and keeps the anchor it replaces", (fn) => {
    const c = calls.find((x) => x.sig === `public.${fn}`)!;
    expect(c.lits.length % 2).toBe(0);
    const pairs = c.lits.reduce<string[][]>((acc, _, i) => (i % 2 ? acc : [...acc, [c.lits[i], c.lits[i + 1]]]), []);
    expect(pairs.some(([, to]) => FLAG.test(to)), `${fn} must add the flag`).toBe(true);
    for (const [from, to] of pairs) expect(to, "a patch must change something").not.toBe(from);
  });

  it("never carries a literal copy of a patched function's body (a snapshot would revert whatever landed since)", () => {
    for (const fn of PATCHED) {
      const name = fn.split("(")[0];
      expect(code, `${name} must not be recreated from a literal`).not.toMatch(new RegExp(`create or replace function public\\.${name}\\(`));
    }
  });

  it("the patch helper stops unless an anchor is found exactly once, and keeps definer/search_path/grants by recreating the live definition", () => {
    expect(code).toMatch(/must be found exactly once/);
    expect(code).toMatch(/pg_get_functiondef\(v_oid\)/);
    expect(code).toMatch(/v_cnt <> 1/);
  });

  it.each([
    ["mentor_profiles", "mentor profiles are approved-and-public"],
    ["mentor_availability_slots", "availability is visible for approved mentors"],
    ["mentorship_reviews", "reviews of approved mentors are publicly readable"],
    ["application_assessment_submissions", "candidate or owning org can read an assessment submission"],
    ["application_assessment_response_files", "candidate or owning org can read response files"],
  ])("the %s SELECT policy is patched by its current name (read from pg_policies), not retyped", (table, name) => {
    expect(code).toMatch(new RegExp(`pg_temp\\.patch_policy\\(\\$x\\$public\\.${table}\\$x\\$, \\$x\\$${name}%\\$x\\$`));
  });

  it("the applicant's own access to their own upload is not gated on the flag: only the organisation branch is", () => {
    const c = calls.find((x) => x.sig === "public.can_access_assessment_submission(text)")!;
    expect(c.lits[1]).toBe("or (public.is_org_member(f.organization_id) and public.account_is_active(a.user_id))");
    expect(c.lits[0]).toBe("or public.is_org_member(f.organization_id)");
  });
  it("the two assessment policies gate the organisation branch only", () => {
    expect(code).toMatch(/\(is_org_member\(organization_id\) AND public\.application_applicant_is_active\(application_id\)\)/);
    expect(code).toMatch(/\(is_org_member\(organization_id\) AND public\.submission_applicant_is_active\(application_assessment_submission_id\)\)/);
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
