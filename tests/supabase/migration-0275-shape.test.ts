/**
 * 0275 (PR-E2a, the database half of "employer chooses apply by email"): the shape of the migration and its rollback, read as text. The DB-backed behaviour is
 * tests/rls/job-postings-apply-email-write.test.ts and the extended tests/rls/job-posting-insert-policy.test.ts, run by S3-21 on a local stack (no database here).
 *
 * What it must be: the INSERT policy closed for apply_email (no client can create a row that carries an address), ONE function as the only write path (any member
 * of the organisation, one locked check-and-act, refuses a switch to email once an in-app or Auto-Apply application exists, five changes per job per 24 hours),
 * an audit table nobody but the function writes, and NOTHING about promoted_jobs, company links, or any client write grant on job_postings.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normaliseApplyEmail } from "@/lib/jobs/apply-email";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const sql = read("supabase/migrations/0275_job_postings_apply_email_write.sql");
const rollback = read("supabase/rollbacks/0275_job_postings_apply_email_write.rollback.sql");
/** The statements, without comments, whitespace collapsed. */
const code = (text: string) => text.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const flat = (text: string) => code(text).replace(/\s+/g, " ");

/** The live INSERT-policy check expression as Postgres deparses it, pinned by the preflight (read on preview before this migration, expected after). */
const PRE = { length: 464, md5: "af80642dd9f038db9a810f4d072f167c" };
const POST = { length: 490, md5: "b5d4e35d0346ce4e3ec126aa37cda56c" };

/** The WITH CHECK conditions of the first `alter policy ... with check ( ... );` in a script, as Postgres's pg_get_expr writes them. */
function deparsedCheck(script: string): string {
  const m = flat(script).match(/alter policy "org members can manage their org's internal postings" on public\.job_postings with check \( (.*?) \);/);
  if (!m) throw new Error("no alter policy ... with check ( ... ); found");
  const parts = m[1].split(/ and /).map((c) => {
    const t = c.trim();
    const isNull = t.match(/^([a-z_]+) is null$/);
    if (isNull) return `(${isNull[1]} IS NULL)`;
    if (t === "source_type = 'internal'::public.job_source_type") return "(source_type = 'internal'::job_source_type)";
    if (t === "public.is_org_member(organization_id)") return "is_org_member(organization_id)";
    throw new Error(`unrecognised condition: ${t}`);
  });
  return `(${parts.join(" AND ")})`;
}
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

describe("0275_job_postings_apply_email_write.sql: the INSERT policy", () => {
  it("keeps every condition of the live expression and adds apply_email is null: 490 characters, the pinned md5", () => {
    const expr = deparsedCheck(sql);
    expect(expr.endsWith(" AND (apply_email IS NULL))")).toBe(true);
    expect({ length: expr.length, md5: md5(expr) }).toEqual(POST);
  });
  it("the expression it starts from is the one the preflight reads: 464 characters (the rollback restores it)", () => {
    const expr = deparsedCheck(rollback);
    expect({ length: expr.length, md5: md5(expr) }).toEqual(PRE);
  });
  it("states both pins in its header, for the package that reads the live expression and stops if it differs", () => {
    expect(sql).toContain(`${PRE.length} characters`);
    expect(sql).toContain(PRE.md5);
    expect(sql).toContain(`${POST.length} characters`);
    expect(sql).toContain(POST.md5);
  });
  it("changes only the policy's WITH CHECK (no new policy, no USING change, no grant on job_postings)", () => {
    const f = flat(sql);
    expect(f.match(/alter policy/g)).toHaveLength(1);
    expect(f).not.toMatch(/create policy|drop policy/i);
    expect(f).not.toMatch(/grant [^;]* on (table )?public\.job_postings/i);
    expect(f).not.toMatch(/promoted_jobs/i);
  });
});

describe("0275: set_job_apply_email, the only write path", () => {
  const f = flat(sql);
  const fn = f.slice(f.indexOf("create or replace function public.set_job_apply_email"), f.indexOf("$f$;", f.indexOf("create or replace function public.set_job_apply_email") + 10) + 4);

  it("is a SECURITY DEFINER function with an empty search_path, taking (uuid, text) and returning void", () => {
    expect(fn).toContain("create or replace function public.set_job_apply_email(p_job_id uuid, p_address text) returns void language plpgsql security definer set search_path = '' as $f$");
  });
  it("is executable by authenticated only: revoked from public, anon, service_role", () => {
    expect(f).toContain("revoke all on function public.set_job_apply_email(uuid, text) from public, anon, authenticated, service_role;");
    expect(f).toContain("grant execute on function public.set_job_apply_email(uuid, text) to authenticated;");
    expect(f).not.toMatch(/grant execute on function public\.set_job_apply_email[^;]* to [^;]*(anon|public|service_role)/);
  });
  it("takes the job row lock first (FOR UPDATE) and does its checks after it", () => {
    const lock = fn.indexOf("for update");
    expect(lock).toBeGreaterThan(-1);
    for (const later of ["is_org_member", "AE004", "AE003", "AE001", "AE002", "update public.job_postings set apply_email"]) {
      expect(fn.indexOf(later), `${later} must come after the lock`).toBeGreaterThan(lock);
    }
  });
  it("any member of the organisation may set it: is_org_member, and no role is compared", () => {
    expect(fn).toContain("public.is_org_member(v_job.organization_id)");
    expect(fn).not.toMatch(/\brole\b|organization_members|'owner'|'admin'/);
  });
  it("only an internal, non-imported, non-removed draft/open/closed job can change", () => {
    expect(fn).toContain("v_job.source_type <> 'internal'::public.job_source_type");
    expect(fn).toContain("v_job.import_feed_id is not null");
    expect(fn).toContain("v_job.removed_at is not null");
    expect(fn).toContain("v_job.status not in ('draft'::public.job_status, 'open'::public.job_status, 'closed'::public.job_status)");
  });
  it("refuses a switch to email once an internal_apply or auto_apply application exists; a manual row does not count; clearing is never refused", () => {
    expect(fn).toContain("p_address is not null and v_old is null and exists ( select 1 from public.applications a where a.job_posting_id = p_job_id and a.source in ('internal_apply'::public.application_source, 'auto_apply'::public.application_source) )");
    expect(fn).not.toContain("'manual'");
    expect(fn).toContain("This job already has applications on Talentrah, so it can''t be switched to email. Close it and post a new job instead.' using errcode = 'AE001'");
  });
  it("caps changes at 5 per job per rolling 24 hours, counted from the audit table inside the lock", () => {
    expect(fn).toContain("from public.job_posting_apply_email_events e where e.job_posting_id = p_job_id and e.created_at > pg_catalog.now() - interval '24 hours'");
    expect(fn).toContain("if v_changes >= 5 then");
    expect(fn).toContain("This job''s apply method was changed 5 times in the last 24 hours. Try again tomorrow.' using errcode = 'AE002'");
  });
  it("an unchanged value returns before the application check, the cap and the audit write (no row, no count)", () => {
    const unchanged = fn.indexOf("p_address is not distinct from v_old");
    expect(unchanged).toBeGreaterThan(-1);
    expect(unchanged).toBeLessThan(fn.indexOf("AE001"));
    expect(unchanged).toBeLessThan(fn.indexOf("AE002"));
    expect(unchanged).toBeLessThan(fn.indexOf("insert into public.job_posting_apply_email_events"));
  });
  it("writes the change and the audit row, in that function (so in the same transaction), with the actor from the session", () => {
    expect(fn).toContain("update public.job_postings set apply_email = p_address where id = p_job_id;");
    expect(fn).toContain("insert into public.job_posting_apply_email_events (job_posting_id, organization_id, actor_user_id, old_address, new_address) values (p_job_id, v_job.organization_id, v_actor, v_old, p_address);");
    expect(fn).toContain("v_actor uuid := (select auth.uid())");
    expect(fn).toContain("using errcode = '28000'");
  });

  it("re-checks the address with the same allowlist as normaliseApplyEmail: the SQL pattern agrees with the helper on a corpus", () => {
    const m = fn.match(/p_address !~ '([^']+)'/);
    expect(m, "the address pattern").not.toBeNull();
    const pattern = new RegExp(m![1]);
    const dotRule = fn.match(/p_address ~ '([^']+)'/);
    expect(dotRule, "the dot rule").not.toBeNull();
    const dots = new RegExp(dotRule![1]);
    const sqlAccepts = (a: string) => a.length <= 254 && pattern.test(a) && !dots.test(a);
    const corpus = [
      "careers@example.com", "a@b.co", "first.last@mail.example.org", "jobs+nigeria@example.co.uk", "x_y-z@sub.example.ng", "a@b-c.de", "a@1.2",
      ".a@b.co", "a.@b.co", "a..b@b.co", "a@b", "a@.b.co", "a@b..co", "a@-b.co", "a@b-.co", "a@b.c-", "a b@c.co", "a@b.co ", "A@b.co", "a@B.co",
      "a@b.co?cc=x", "a@b.co&cc=x", "a%0ABcc:x@b.co", "a,b@c.co", "a;b@c.co", "<a@b.co>", "a@@b.co", "a#b@c.co", "o'x@c.co", "a@b.co\n", "a\u0000@b.co",
      "kK@b.co", "é@b.co", "a@é.co", "", "@b.co", "a@", `${"a".repeat(64)}@b.co`, `${"a".repeat(65)}@b.co`, `a@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(60)}.com`,
    ];
    for (const a of corpus) {
      const helper = normaliseApplyEmail(a) === a;
      expect(sqlAccepts(a), `SQL and helper must agree on ${JSON.stringify(a)}`).toBe(helper);
    }
  });
  it("refuses with the plain sentence the screen shows, and a stable SQLSTATE per refusal", () => {
    expect(fn).toContain("Enter one email address, such as careers@yourcompany.com.' using errcode = 'AE003'");
    expect(fn).toContain("This job''s apply method can''t be changed.' using errcode = 'AE004'");
    expect(fn).toContain("That job was not found.' using errcode = '42501'");
  });
});

describe("0275: the audit table", () => {
  const f = flat(sql);
  it("holds who, which job, from what and to what, with no foreign key on the job (a deleted job keeps its trail) and the actor set null on delete", () => {
    expect(f).toContain("create table public.job_posting_apply_email_events ( id uuid primary key default gen_random_uuid(), job_posting_id uuid not null,");
    expect(f).toContain("organization_id uuid not null references public.organizations (id) on delete cascade");
    expect(f).toContain("actor_user_id uuid references public.profiles (id) on delete set null");
    expect(f).not.toMatch(/job_posting_id uuid not null references/);
    expect(f).toContain("check (char_length(old_address) <= 254)");
    expect(f).toContain("check (char_length(new_address) <= 254)");
    expect(f).toContain("check (old_address is distinct from new_address)");
    expect(f).toContain("create index job_posting_apply_email_events_job_idx on public.job_posting_apply_email_events (job_posting_id, created_at desc);");
  });
  it("is closed to every API role: RLS on, nothing granted, service_role may read and append only", () => {
    expect(f).toContain("alter table public.job_posting_apply_email_events enable row level security;");
    expect(f).toContain("revoke all on table public.job_posting_apply_email_events from public, anon, authenticated, service_role;");
    expect(f).toContain("grant select, insert on table public.job_posting_apply_email_events to service_role;");
    expect(f).not.toMatch(/grant [^;]* on (table )?public\.job_posting_apply_email_events to [^;]*(anon|authenticated)/);
    expect(f).not.toMatch(/create policy/i);
  });
});

describe("0275: the migration checks its own result and runs inside the runner's transaction", () => {
  const f = flat(sql);
  it("self-check: the policy, the function's privileges and security mode, the table's closure, and that no client can UPDATE the column", () => {
    for (const needle of [
      "pg_get_expr(p.polwithcheck, p.polrelid)",
      "'(apply_email IS NULL)'",
      "p.prosecdef",
      "has_function_privilege('anon', 'public.set_job_apply_email(uuid, text)', 'execute')",
      "has_function_privilege('authenticated', 'public.set_job_apply_email(uuid, text)', 'execute')",
      "aclexplode",
      "relrowsecurity",
      "has_any_column_privilege('authenticated', 'public.job_posting_apply_email_events', 'SELECT')",
      "has_column_privilege('authenticated', 'public.job_postings', 'apply_email', 'UPDATE')",
      "has_column_privilege('anon', 'public.job_postings', 'apply_email', 'UPDATE')",
    ]) expect(f, needle).toContain(needle);
    expect(f.match(/raise exception '0275:/g)!.length).toBeGreaterThanOrEqual(8);
  });
  it("fails fast on a lock, and has no transaction control", () => {
    expect(f).toContain("set local lock_timeout = '3s';");
    expect(f).not.toMatch(/\b(begin|commit|rollback);/i);
  });
});

describe("0275_job_postings_apply_email_write.rollback.sql", () => {
  const f = flat(rollback);
  it("refuses while audit rows exist, restores the 0246 policy text, drops the function and the table, and is one transaction", () => {
    expect(f.startsWith("begin; set local lock_timeout = '3s';")).toBe(true);
    expect(f).toContain("if exists (select 1 from public.job_posting_apply_email_events)");
    expect(f).toContain("drop function if exists public.set_job_apply_email(uuid, text);");
    expect(f).toContain("drop table if exists public.job_posting_apply_email_events;");
    expect(f.trimEnd().endsWith("commit;")).toBe(true);
    expect(f).not.toMatch(/drop column|delete from|truncate/i);
  });
});
