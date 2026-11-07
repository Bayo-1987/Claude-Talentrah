/**
 * 0277 (PR-E4, gate 1: the database half of "On our career site"): the shape of the migration and its rollback, read as text. The DB-backed behaviour is
 * tests/rls/job-postings-apply-link-write.test.ts (run by S3-21 on a local stack; this machine has no database).
 *
 * What it must be: three columns set only by one SERVICE-ROLE-ONLY function (so a direct call with a user token is refused by privilege), no API role able to read the address itself, the INSERT policy
 * closed for all three, one method per job, one shared cap counted once, the 0275 function replaced with its grants and AE001..AE004 contract intact, and a rollback that restores the 0275 function and
 * policy VERBATIM. The SQL's link rules are replayed in JavaScript from the patterns in the SQL text itself (so they cannot drift from the file) against a corpus of 50+ addresses.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeDomain } from "@/lib/employer/verification";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const sql = read("supabase/migrations/0277_job_postings_apply_link.sql");
const rollback = read("supabase/rollbacks/0277_job_postings_apply_link.rollback.sql");
const sql0275 = read("supabase/migrations/0275_job_postings_apply_email_write.sql");
const code = (text: string) => text.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const flat = (text: string) => code(text).replace(/\s+/g, " ");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

/** The INSERT policy's check expression as Postgres deparses it: live after 0275 (the preflight pin) and expected after 0277. */
const PRE = { length: 490, md5: "b5d4e35d0346ce4e3ec126aa37cda56c" };
const POST = { length: 575, md5: "4a86f3501566ff9d0284d8c5a448a4a1" };

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

/** The text of a whole `create or replace function public.<name>(...)` ... through its trailing comment statement. */
function functionBlock(script: string, name: string): string {
  const start = script.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`no function ${name}`);
  const commentAt = script.indexOf(`comment on function public.${name}(`, start);
  return script.slice(start, script.indexOf(";\n", commentAt) + 2);
}

describe("the INSERT policy", () => {
  it("0277's expression is 575 characters, the pinned md5: the 0275 expression plus apply_link, apply_link_kind and apply_link_host are null", () => {
    const expr = deparsedCheck(sql);
    expect(expr.endsWith(" AND (apply_link IS NULL) AND (apply_link_kind IS NULL) AND (apply_link_host IS NULL))")).toBe(true);
    expect({ length: expr.length, md5: md5(expr) }).toEqual(POST);
  });
  it("0275's expression (live before 0277, the preflight pin) is 490 characters; the rollback restores exactly it", () => {
    expect({ length: deparsedCheck(sql0275).length, md5: md5(deparsedCheck(sql0275)) }).toEqual(PRE);
    expect({ length: deparsedCheck(rollback).length, md5: md5(deparsedCheck(rollback)) }).toEqual(PRE);
  });
  it("states both pins in its header, and that the package aborts on a mismatch on BOTH projects", () => {
    for (const pin of [PRE.md5, POST.md5, "490 characters", "575 characters"]) expect(sql).toContain(pin);
    expect(sql).toContain("on BOTH projects");
    expect(sql).toContain("md5(pg_get_functiondef('public.set_job_apply_email(uuid, text)'::regprocedure))");
  });
});

describe("the columns, constraints and grants", () => {
  const f = flat(sql);
  it("adds three nullable text columns and five constraints, added NOT VALID then validated", () => {
    expect(f).toContain("add column if not exists apply_link text, add column if not exists apply_link_kind text, add column if not exists apply_link_host text;");
    for (const c of ["job_postings_apply_link_length", "job_postings_apply_link_host_length", "job_postings_apply_link_kind_known", "job_postings_apply_link_all_or_none", "job_postings_one_off_platform_method"]) {
      expect(f).toContain(`alter table public.job_postings validate constraint ${c};`);
    }
    expect(f.match(/not valid/g)).toHaveLength(5);
  });
  it("the link is at most 2000 characters (the importer's cap), the kind is company or ats, all three are set or null, and an email and a link are never both set", () => {
    expect(f).toContain("check (char_length(apply_link) <= 2000)");
    expect(f).toContain("check (apply_link_kind in ('company', 'ats'))");
    expect(f).toContain("check ((apply_link is null) = (apply_link_kind is null) and (apply_link is null) = (apply_link_host is null))");
    expect(f).toContain("check (apply_email is null or apply_link is null)");
  });
  it("grants SELECT on the kind and the host only: NO API role can read apply_link, and nobody gets an UPDATE grant", () => {
    expect(f).toContain("grant select (apply_link_kind, apply_link_host) on public.job_postings to anon, authenticated;");
    expect(f).not.toMatch(/grant [^;]*\bapply_link\b[^;]* on public\.job_postings/);
    expect(f).not.toMatch(/grant (insert|update|all|delete)[^;]* on (table )?public\.job_postings/i);
  });
  it("does not touch promoted_jobs, and adds no transaction control", () => {
    expect(f).not.toMatch(/promoted_jobs/i);
    expect(f).not.toMatch(/\b(begin|commit|rollback);/i);
    expect(f).toContain("set local lock_timeout = '3s';");
  });
});

describe("set_job_apply_link: the only write path, service role only", () => {
  const fn = flat(functionBlock(sql, "set_job_apply_link").replace(/comment on function[\s\S]*$/, ""));
  const f = flat(sql);
  it("is SECURITY DEFINER with an empty search_path and takes the actor as a parameter", () => {
    expect(fn).toContain("create or replace function public.set_job_apply_link(p_job_id uuid, p_actor uuid, p_url text, p_kind text, p_ats_confirmed boolean) returns void language plpgsql security definer set search_path = '' as $f$");
  });
  it("is executable by service_role and by NOBODY else: a direct call with a user token is refused by privilege", () => {
    expect(f).toContain("revoke all on function public.set_job_apply_link(uuid, uuid, text, text, boolean) from public, anon, authenticated, service_role;");
    expect(f).toContain("grant execute on function public.set_job_apply_link(uuid, uuid, text, text, boolean) to service_role;");
    expect(f).not.toMatch(/grant execute on function public\.set_job_apply_link[^;]* to [^;]*(anon|authenticated|public)/);
  });
  it("takes the job row lock first and checks everything after it", () => {
    const lock = fn.indexOf("for update");
    expect(lock).toBeGreaterThan(-1);
    for (const later of ["organization_members", "AE004", "AE005", "AE006", "AE007", "AE001", "AE002", "update public.job_postings set"]) {
      expect(fn.indexOf(later), `${later} comes after the lock`).toBeGreaterThan(lock);
    }
  });
  it("re-checks that the actor is a member of the job's organisation, with no role compared", () => {
    expect(fn).toContain("not exists ( select 1 from public.organization_members m where m.organization_id = v_job.organization_id and m.user_id = p_actor )");
    expect(fn).not.toMatch(/\brole\b|'owner'|'admin'/);
  });
  it("only an internal, non-imported, non-removed draft/open/closed job can change", () => {
    expect(fn).toContain("v_job.source_type <> 'internal'::public.job_source_type");
    expect(fn).toContain("v_job.import_feed_id is not null");
    expect(fn).toContain("v_job.removed_at is not null");
    expect(fn).toContain("v_job.status not in ('draft'::public.job_status, 'open'::public.job_status, 'closed'::public.job_status)");
  });
  it("each refusal has its own code and a sentence that says how to fix it", () => {
    for (const needle of [
      "Sign in to change how people apply.' using errcode = '28000'",
      "That job was not found.' using errcode = '42501'",
      "This job''s apply method can''t be changed.' using errcode = 'AE004'",
      "That link can''t be used. Use a full https address on your company''s website or on your applicant tracking system.' using errcode = 'AE005'",
      "Your company isn''t verified yet, so a link on your own website can''t be used. Use your applicant tracking page, or finish verifying your company first.' using errcode = 'AE006'",
      "Tick the box to confirm this is your own careers page.' using errcode = 'AE007'",
      "This job already has applications on Talentrah, so it can''t be switched to a career-site link. Close it and post a new job instead.' using errcode = 'AE001'",
      "This job''s apply method was changed 5 times in the last 24 hours. Try again tomorrow.' using errcode = 'AE002'",
    ]) expect(fn, needle).toContain(needle);
  });
  it("the three guards the corpus model below takes as given are in the SQL as written: https only, the careers-page tick, a verified company for the company path", () => {
    expect(fn).toContain("p_url !~ '^https://[a-z0-9]");
    expect(fn).not.toMatch(/https\?:/);
    expect(fn).toContain("if p_ats_confirmed is not true then raise exception 'Tick the box to confirm this is your own careers page.' using errcode = 'AE007'; end if;");
    expect(fn).toContain("if not coalesce(v_org.verified, false) or v_domain = '' then raise exception");
    expect(fn).toContain("using errcode = 'AE006'");
  });
  it("the has-applications lock counts internal_apply and auto_apply, never manual, and clearing is never refused", () => {
    expect(fn).toContain("p_url is not null and v_job.apply_link is null and exists ( select 1 from public.applications a where a.job_posting_id = p_job_id and a.source in ('internal_apply'::public.application_source, 'auto_apply'::public.application_source) )");
    expect(fn).not.toContain("'manual'");
  });
  it("an unchanged value returns before the lock check, the cap and the audit row", () => {
    const unchanged = fn.indexOf("p_url is not distinct from v_job.apply_link");
    expect(unchanged).toBeGreaterThan(-1);
    for (const later of ["AE001", "AE002", "insert into public.job_posting_apply_link_events"]) expect(unchanged).toBeLessThan(fn.indexOf(later));
  });
  it("the cap is shared: email events plus link events that were not replaced_by_email, 5 per rolling 24 hours", () => {
    expect(fn).toContain("from public.job_posting_apply_email_events e where e.job_posting_id = p_job_id and e.created_at > pg_catalog.now() - interval '24 hours'");
    expect(fn).toContain("from public.job_posting_apply_link_events l where l.job_posting_id = p_job_id and not l.replaced_by_email and l.created_at > pg_catalog.now() - interval '24 hours'");
    expect(fn).toContain("if v_changes >= 5 then");
  });
  it("setting a link clears an address in the same statement; clearing a link touches only the three link columns; the audit row records the tick and the replaced address", () => {
    expect(fn).toContain("update public.job_postings set apply_link = p_url, apply_link_kind = p_kind, apply_link_host = v_host, apply_email = null where id = p_job_id;");
    expect(fn).toContain("update public.job_postings set apply_link = null, apply_link_kind = null, apply_link_host = null where id = p_job_id;");
    expect(fn).toContain("p_url is not null and p_kind = 'ats' and p_ats_confirmed is true");
    expect(fn).toContain("case when p_url is null then null else v_job.apply_email end");
  });
});

describe("the other new functions", () => {
  const f = flat(sql);
  it("get_job_apply_link returns the address to a member of the job's organisation only, and is authenticated-only", () => {
    expect(f).toContain("select j.apply_link from public.job_postings j where j.id = p_job_id and j.organization_id is not null and public.is_org_member(j.organization_id);");
    expect(f).toContain("revoke all on function public.get_job_apply_link(uuid) from public, anon, authenticated, service_role;");
    expect(f).toContain("grant execute on function public.get_job_apply_link(uuid) to authenticated;");
  });
  it("record_apply_link_click is service-role only and counts per job per UTC day with no user id", () => {
    expect(f).toContain("grant execute on function public.record_apply_link_click(uuid) to service_role;");
    expect(f).not.toMatch(/grant execute on function public\.record_apply_link_click[^;]* to [^;]*(anon|authenticated)/);
    expect(f).toContain("insert into public.apply_link_clicks (job_posting_id, day, clicks) values (p_job_id, (pg_catalog.now() at time zone 'UTC')::date, 1) on conflict (job_posting_id, day) do update set clicks = public.apply_link_clicks.clicks + 1;");
    const table = f.slice(f.indexOf("create table public.apply_link_clicks"), f.indexOf(");", f.indexOf("create table public.apply_link_clicks")));
    expect(table).not.toMatch(/user|profile|session|ip/i);
  });
  it("the audit and click tables are closed to every API role; service_role may use them", () => {
    for (const t of ["job_posting_apply_link_events", "apply_link_clicks"]) {
      expect(f).toContain(`alter table public.${t} enable row level security;`);
      expect(f).toContain(`revoke all on table public.${t} from public, anon, authenticated, service_role;`);
    }
    expect(f).toContain("grant select, insert on table public.job_posting_apply_link_events to service_role;");
    expect(f).toContain("grant select, insert, update on table public.apply_link_clicks to service_role;");
    expect(f).not.toMatch(/grant [^;]* on (table )?public\.(job_posting_apply_link_events|apply_link_clicks) to [^;]*(anon|authenticated)/);
  });
  it("the audit table keeps no foreign key on the job and sets the actor null on delete", () => {
    expect(f).toContain("job_posting_id uuid not null, organization_id uuid not null references public.organizations (id) on delete cascade, actor_user_id uuid references public.profiles (id) on delete set null,");
  });
});

describe("set_job_apply_email, replaced: grants and the AE001..AE004 contract unchanged", () => {
  const next = flat(functionBlock(sql, "set_job_apply_email"));
  const old = flat(functionBlock(sql0275, "set_job_apply_email"));
  it("keeps every error code and sentence of the 0275 function", () => {
    for (const code of ["28000", "42501", "AE004", "AE003", "AE001", "AE002"]) {
      const pair = old.match(new RegExp(`raise exception '[^;]*?' using errcode = '${code}'`))?.[0];
      expect(pair, `0275 has ${code}`).toBeTruthy();
      expect(next, `0277 keeps ${code}`).toContain(pair!);
    }
  });
  it("keeps the revoke and the grant to authenticated only", () => {
    expect(next).toContain("revoke all on function public.set_job_apply_email(uuid, text) from public, anon, authenticated, service_role;");
    expect(next).toContain("grant execute on function public.set_job_apply_email(uuid, text) to authenticated;");
  });
  it("setting an address also clears the link in the same update, and the replaced link leaves a replaced_by_email audit row", () => {
    expect(next).toContain("update public.job_postings set apply_email = p_address, apply_link = null, apply_link_kind = null, apply_link_host = null where id = p_job_id;");
    expect(next).toContain("if p_address is not null and v_job.apply_link is not null then insert into public.job_posting_apply_link_events");
    expect(next).toContain("replaced_by_email) values (p_job_id, v_job.organization_id, v_actor, v_job.apply_link, v_job.apply_link_kind, null, null, true);");
  });
  it("the cap counts both audit tables, a replacement once", () => {
    expect(next).toContain("not l.replaced_by_email");
  });
  it("with no link on the job the validation, the lock and the audit are the 0275 ones: the only differences are the documented ones", () => {
    const strip = (t: string) =>
      t
        .replace(/, j\.apply_link, j\.apply_link_kind/, "")
        .replace(/select \(select count\(\*\) from public\.job_posting_apply_email_events e where e\.job_posting_id = p_job_id and e\.created_at > pg_catalog\.now\(\) - interval '24 hours'\) \+ \(select count\(\*\) from public\.job_posting_apply_link_events l where l\.job_posting_id = p_job_id and not l\.replaced_by_email and l\.created_at > pg_catalog\.now\(\) - interval '24 hours'\) into v_changes;/, "select count(*) into v_changes from public.job_posting_apply_email_events e where e.job_posting_id = p_job_id and e.created_at > pg_catalog.now() - interval '24 hours';")
        .replace("update public.job_postings set apply_email = p_address, apply_link = null, apply_link_kind = null, apply_link_host = null where id = p_job_id;", "update public.job_postings set apply_email = p_address where id = p_job_id;")
        .replace(/ -- A link that[^$]*?(?= end \$f\$)/, "")
        .replace(/ if p_address is not null and v_job\.apply_link is not null then insert into public\.job_posting_apply_link_events \(.*?\) values \(.*?\); end if;/, "");
    const a = strip(next.replace(/comment on function[\s\S]*$/, "")).replace(/\s+/g, " ").trim();
    const b = old.replace(/comment on function[\s\S]*$/, "").replace(/\s+/g, " ").trim();
    expect(a.replace(/revoke all[\s\S]*$/, "")).toBe(b.replace(/revoke all[\s\S]*$/, ""));
  });
});

describe("the rollback", () => {
  const f = flat(rollback);
  it("refuses while a job holds a link or an audit row exists, restores the 0275 function VERBATIM, then drops the new objects, and is one transaction", () => {
    expect(f.startsWith("begin; set local lock_timeout = '3s';")).toBe(true);
    expect(f).toContain("if exists (select 1 from public.job_postings where apply_link is not null) then");
    expect(f).toContain("if exists (select 1 from public.job_posting_apply_link_events) then");
    expect(flat(functionBlock(rollback, "set_job_apply_email"))).toBe(flat(functionBlock(sql0275, "set_job_apply_email")));
    for (const drop of [
      "drop function if exists public.set_job_apply_link(uuid, uuid, text, text, boolean);",
      "drop function if exists public.get_job_apply_link(uuid);",
      "drop function if exists public.record_apply_link_click(uuid);",
      "drop table if exists public.apply_link_clicks;",
      "drop table if exists public.job_posting_apply_link_events;",
      "alter table public.job_postings drop column if exists apply_link;",
    ]) expect(f).toContain(drop);
    expect(f.trimEnd().endsWith("commit;")).toBe(true);
    expect(f).not.toMatch(/delete from|truncate|drop column if exists apply_email;/);
  });
  it("restores the policy BEFORE dropping the columns the new policy mentions", () => {
    expect(f.indexOf("alter policy")).toBeGreaterThan(-1);
    expect(f.indexOf("alter policy")).toBeLessThan(f.indexOf("drop column if exists apply_link_host"));
  });
});

// ── The SQL's link rules, replayed from the patterns in the SQL text ────────────────────────────────────────────────────────────────────────────
const fnText = code(functionBlock(sql, "set_job_apply_link"));
const posix = (re: string) => re.replace(/\[\[:space:\]\]/g, "\\s").replace(/\[:space:\]/g, "\\s").replace(/\[:cntrl:\]/g, "\\x00-\\x1f\\x7f");
const grab = (re: RegExp, label: string): string => {
  const m = fnText.match(re);
  if (!m) throw new Error(`SQL pattern not found: ${label}`);
  return m[1];
};
const SHAPE = new RegExp(posix(grab(/p_url !~ '([^']+)'/, "shape")));
const HOST = new RegExp(posix(grab(/substring\(p_url from '(\^https:\/\/\([^']+)'\)/, "host")));
const HOST_BAD = new RegExp(grab(/v_host ~ '(\(\\\.\\\.[^']+)'/, "host-bad"));
const PATH = new RegExp(grab(/v_path := substring\(p_url from '([^']+)'\)/, "path"));
const PATH_OK = new RegExp(grab(/v_path !~ '([^']+)'/, "path-ok"));
const TENANT = new RegExp(grab(/v_host !~ '(\^\[a-z0-9\]\(\[a-z0-9-\]\*\[a-z0-9\]\)\?\\\.\([^']+)'/, "tenant"));
const XN = new RegExp(grab(/v_host ~ '(\(\^\|\\\.\)xn--)'/, "xn--"));
const VENDOR = [...grab(/split_part\(v_host, '\.', 1\) = any \(array\[([^\]]+)\]\)/, "vendor labels").matchAll(/'([^']+)'/g)].map((m) => m[1]);
const EXACT = [...grab(/v_host = any \(array\[([^\]]+)\]\)/, "exact list").matchAll(/'([^']+)'/g)].map((m) => m[1]);

type Org = { domain: string | null; verified: boolean };
function sqlModel(url: string, kind: string | null, org: Org, tick: boolean): "accept" | "AE005" | "AE006" | "AE007" {
  if (kind === null || !["company", "ats"].includes(kind) || url.length > 2000 || /\s/.test(url) || !SHAPE.test(url)) return "AE005";
  const host = HOST.exec(url)?.[1];
  if (!host || !host.includes(".") || HOST_BAD.test(host) || XN.test(host) || host.length > 253) return "AE005";
  if (kind === "company") {
    const d = (org.domain ?? "").trim().toLowerCase();
    if (!org.verified || d === "") return "AE006";
    return host === d || host.slice(-(d.length + 1)) === `.${d}` ? "accept" : "AE005";
  }
  const p = PATH.exec(url)?.[1] ?? null;
  if (EXACT.includes(host)) {
    if (p === null || !PATH_OK.test(p)) return "AE005";
  } else if (!TENANT.test(host) || VENDOR.includes(host.split(".")[0])) return "AE005";
  return tick ? "accept" : "AE007";
}

describe("the SQL's two domain paths against a corpus (the patterns are read from the SQL text)", () => {
  it("the ATS allowlist in the SQL is exactly the approved one", () => {
    expect([...EXACT].sort()).toEqual(["apply.workable.com", "boards.greenhouse.io", "careers.smartrecruiters.com", "job-boards.greenhouse.io", "jobs.ashbyhq.com", "jobs.lever.co", "jobs.smartrecruiters.com"]);
    expect(grab(/v_host !~ '\^\[a-z0-9\]\(\[a-z0-9-\]\*\[a-z0-9\]\)\?\\\.\(([^)]+)\)\$'/, "tenant families")).toBe("bamboohr\\.com|recruitee\\.com|teamtailor\\.com");
  });

  const ACME: Org = { domain: "acme.com", verified: true };
  const long = `https://acme.com/${"a".repeat(2000)}`;
  // [url, kind, org, tick, expected]. "ts-only" cases are refused by the TypeScript validator but not by SQL (shorteners, job boards, IP hosts, xn-- labels): only the Server Action can reach the function.
  const corpus: Array<[string, string | null, Org, boolean, ReturnType<typeof sqlModel>]> = [
    ["https://acme.com/careers", "company", ACME, false, "accept"],
    ["https://careers.acme.com/jobs/1", "company", ACME, false, "accept"],
    ["https://a.b.acme.com/x", "company", ACME, false, "accept"],
    ["https://acme.com", "company", ACME, false, "accept"],
    ["https://acme.com?team=eng", "company", ACME, false, "accept"],
    ["https://xn--bcher-kva.acme.com/x", "company", ACME, false, "AE005"], // G1b-2: an xn-- label is refused in SQL too (it was "accept" in gate 1; the TypeScript rule always refused it)
    ["https://acme.xn--p1ai/x", "company", { domain: "acme.xn--p1ai", verified: true }, false, "AE005"],
    ["https://xn--abc.bamboohr.com/x", "ats", ACME, true, "AE005"],
    ["https://acme.com/a\u0001b", "company", ACME, false, "AE005"], // G1b-3: a control character in the path
    ["https://acme.com/a\u007fb", "company", ACME, false, "AE005"],
    ["https://acme.com/a\u0000b", "company", ACME, false, "AE005"],
    ["https://acme.com/a%20b?x=1#top", "company", ACME, false, "accept"],
    ["https://www.bamboohr.com/careers", "ats", ACME, true, "AE005"], // G1b-1: a vendor's own label on a tenant host
    ["https://login.recruitee.com/", "ats", ACME, true, "AE005"],
    ["https://docs.teamtailor.com/x", "ats", ACME, true, "AE005"],
    ["https://acme-app.bamboohr.com/x", "ats", ACME, true, "accept"],
    ["https://acme.com.evil.com/x", "company", ACME, false, "AE005"],
    ["https://evilacme.com/x", "company", ACME, false, "AE005"],
    ["https://notacme.com/x", "company", ACME, false, "AE005"],
    ["https://acme.co/x", "company", ACME, false, "AE005"],
    ["http://acme.com/x", "company", ACME, false, "AE005"],
    ["https://acme.com:8443/x", "company", ACME, false, "AE005"],
    ["https://user:pass@acme.com/x", "company", ACME, false, "AE005"],
    ["https://user@acme.com/x", "company", ACME, false, "AE005"],
    ["https://1.2.3.4/x", "company", ACME, false, "AE005"],
    ["https://ACME.com/x", "company", ACME, false, "AE005"],
    ["https://acme.com./x", "company", ACME, false, "AE005"],
    ["https://bücher.acme.com/x", "company", ACME, false, "AE005"],
    ["https:// acme.com/x", "company", ACME, false, "AE005"],
    ["https://acme.com/a b", "company", ACME, false, "AE005"],
    ["", "company", ACME, false, "AE005"],
    ["https://-acme.com/x", "company", ACME, false, "AE005"],
    ["https://acme-.com/x", "company", ACME, false, "AE005"],
    ["https://acme..com/x", "company", ACME, false, "AE005"],
    ["https://localhost/x", "company", ACME, false, "AE005"],
    [long, "company", ACME, false, "AE005"],
    ["https://acme.com/x", "company", { domain: "acme.com", verified: false }, false, "AE006"],
    ["https://acme.com/x", "company", { domain: "", verified: true }, false, "AE006"],
    ["https://acme.com/x", "company", { domain: null, verified: true }, false, "AE006"],
    ["https://acme.com/x", "other", ACME, false, "AE005"],
    ["https://acme.com/x", null, ACME, false, "AE005"],
    ["https://acme.com/x", "company", { domain: "Acme.COM ", verified: true }, false, "accept"],
    ["https://bit.ly/abc", "ats", ACME, true, "AE005"],
    ["https://boards.greenhouse.io/acme", "ats", ACME, true, "accept"],
    ["https://boards.greenhouse.io/acme", "ats", ACME, false, "AE007"],
    ["https://boards.greenhouse.io", "ats", ACME, true, "AE005"],
    ["https://boards.greenhouse.io/", "ats", ACME, true, "AE005"],
    ["https://boards.greenhouse.io/?x=1", "ats", ACME, true, "AE005"],
    ["https://job-boards.greenhouse.io/acme/jobs/1", "ats", ACME, true, "accept"],
    ["https://jobs.lever.co/acme", "ats", ACME, true, "accept"],
    ["https://lever.co/acme", "ats", ACME, true, "AE005"],
    ["https://jobs.lever.co.evil.com/acme", "ats", ACME, true, "AE005"],
    ["https://lever.co.evil.com/x", "ats", ACME, true, "AE005"],
    ["https://evil-jobs.lever.co/x", "ats", ACME, true, "AE005"],
    ["https://apply.workable.com/acme/", "ats", ACME, true, "accept"],
    ["https://jobs.ashbyhq.com/acme", "ats", ACME, true, "accept"],
    ["https://jobs.smartrecruiters.com/Acme", "ats", ACME, true, "accept"],
    ["https://careers.smartrecruiters.com/acme", "ats", ACME, true, "accept"],
    ["https://acme.bamboohr.com/careers", "ats", ACME, true, "accept"],
    ["https://acme.bamboohr.com", "ats", ACME, true, "accept"],
    ["https://bamboohr.com/careers", "ats", ACME, true, "AE005"],
    ["https://evilbamboohr.com/x", "ats", ACME, true, "AE005"],
    ["https://a.b.bamboohr.com/x", "ats", ACME, true, "AE005"],
    ["https://acme.recruitee.com/o/job", "ats", ACME, true, "accept"],
    ["https://acme.teamtailor.com/jobs", "ats", ACME, true, "accept"],
    ["https://acme.teamtailor.com.evil.com/x", "ats", ACME, true, "AE005"],
    ["https://acme.com/x", "ats", ACME, true, "AE005"],
    ["https://boards.greenhouse.io/acme", "company", ACME, true, "AE005"],
  ];

  it.each(corpus.map((c, i) => [i + 1, ...c] as const))("case %i: %s as %s", (_n, url, kind, org, tick, expected) => {
    expect(sqlModel(url, kind, org, tick)).toBe(expected);
  });
  it("G1b-1: the vendor-own labels are exactly the approved ten, and every one is refused on every tenant vendor (a real tenant label still passes)", () => {
    expect([...VENDOR].sort()).toEqual(["accounts", "api", "app", "blog", "docs", "help", "login", "status", "support", "www"]);
    for (const vendor of ["bamboohr.com", "recruitee.com", "teamtailor.com"]) {
      for (const label of VENDOR) expect(sqlModel(`https://${label}.${vendor}/careers`, "ats", ACME, true), `${label}.${vendor}`).toBe("AE005");
      expect(sqlModel(`https://acme.${vendor}/careers`, "ats", ACME, true), `acme.${vendor}`).toBe("accept");
    }
  });
  it("G1b-2: any xn-- label in the host is refused, at any position, on both paths", () => {
    expect(XN.source).toBe("(^|\\.)xn--");
    for (const host of ["xn--a.acme.com", "careers.xn--a.acme.com", "acme.xn--p1ai"]) expect(XN.test(host), host).toBe(true);
    for (const host of ["acme.com", "boxn--a.acme.com", "axn--.com"]) expect(XN.test(host), host).toBe(false);
  });
  it("G1b-3: the path part of the shape pattern refuses control characters as well as whitespace", () => {
    expect(fnText.replace(/\s+/g, " ")).toContain("([/?#][^[:space:][:cntrl:]]*)?$'");
    expect(fnText).not.toContain("[^[:space:]]*)?$'");
  });
  it("the corpus has more than 50 cases and covers every outcome", () => {
    expect(corpus.length).toBeGreaterThan(50);
    expect(new Set(corpus.map((c) => c[4]))).toEqual(new Set(["accept", "AE005", "AE006", "AE007"]));
  });

  it("the company-domain match agrees with normalizeDomain: what the organisation typed becomes the stored domain, and the dot-boundary rule is the SQL's", () => {
    expect(fnText.replace(/\s+/g, " ")).toContain("v_domain := lower(btrim(coalesce(v_org.domain, '')));");
    expect(fnText.replace(/\s+/g, " ")).toContain("not (v_host = v_domain or right(v_host, char_length(v_domain) + 1) = '.' || v_domain)");
    const typed = ["Acme.com", "https://www.acme.com/", "hr@acme.com", "acme.com.", "ACME.COM/careers", "www.acme.com"];
    for (const input of typed) {
      const stored = normalizeDomain(input);
      expect(stored, input).toBe("acme.com");
      expect(sqlModel("https://careers.acme.com/x", "company", { domain: stored, verified: true }, false), input).toBe("accept");
      expect(sqlModel("https://evilacme.com/x", "company", { domain: stored, verified: true }, false), input).toBe("AE005");
      expect(sqlModel("https://acme.com.evil.com/x", "company", { domain: stored, verified: true }, false), input).toBe("AE005");
    }
    expect(normalizeDomain("gmail")).toBeNull();
  });
});
