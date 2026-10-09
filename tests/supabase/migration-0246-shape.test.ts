/**
 * Migration 0246 (employer job feeds, database part): its SHAPE, read from the files (no database). The behaviour is in tests/rls/employer-job-feeds.test.ts (CI, a real database).
 * This pins what a behavioural test would only notice after somebody was hurt: no client write on the feed table, no API access to the attempts table, the import markers closed on INSERT through
 * the policy (authenticated holds a table-level INSERT), the widget never listing an imported posting, the whole sync state in one column, and a rollback that refuses to drop imported postings.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(__dirname, "../../supabase/migrations/0246_employer_job_feeds.sql");
const ROLLBACK = join(__dirname, "../../supabase/rollbacks/0246_employer_job_feeds.rollback.sql");
const strip = (t: string) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const raw = existsSync(MIGRATION) ? readFileSync(MIGRATION, "utf8") : "";
const rawRollback = existsSync(ROLLBACK) ? readFileSync(ROLLBACK, "utf8") : "";
const flat = strip(raw).replace(/\s+/g, " ").toLowerCase();
const rollback = strip(rawRollback).replace(/\s+/g, " ").toLowerCase();

describe("0246: the files", () => {
  it("exist under the registered number", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(existsSync(ROLLBACK)).toBe(true);
    expect(raw).not.toMatch(/NNNN/);
  });
  it("is additive: no drop of an existing object, one replaced function, one altered policy", () => {
    expect(flat).not.toMatch(/\bdrop (table|column|function|policy|index)\b/);
    expect((flat.match(/create or replace function public\.[a-z_]+/g) ?? []).sort()).toEqual([
      "create or replace function public.employer_job_feeds_touch_updated_at",
      "create or replace function public.org_job_widget",
      "create or replace function public.prune_employer_job_feed_attempts",
    ]);
    expect((flat.match(/alter policy/g) ?? []).length).toBe(2);
  });
});

describe("0246: employer_job_feeds", () => {
  const table = flat.slice(flat.indexOf("create table public.employer_job_feeds ("), flat.indexOf("create table public.employer_job_feed_attempts"));
  it("holds the whole sync state in one column with exactly the six states", () => {
    expect(table).toContain("state text not null default 'active' check (state in ('active', 'paused_proof', 'paused_unreadable', 'paused_employer', 'disabled_operator', 'removed'))");
    for (const col of ["problem_since", "grace_ends_at", "consecutive_proof_misses", "consecutive_unreadable", "last_success_at", "warning_1_sent_at", "warning_2_sent_at"]) expect(table, col).toContain(`${col} `);
  });
  it("keeps the 14-day clock tied to the first failure: a streak has both problem_since and grace_ends_at, never one", () => {
    expect(table).toContain("(problem_since is null) = (grace_ends_at is null)");
    expect(table).toContain("grace_ends_at >= problem_since");
  });
  it("stores a site-control code of at least 43 base64url characters (32 bytes) and a host that is lower-case with no path", () => {
    expect(table).toContain("site_proof_code text not null check (site_proof_code ~ '^[a-za-z0-9_-]{43,}$')".toLowerCase());
    expect(table).toMatch(/host = lower\(host\)/);
  });
  it("allows one LIVE feed per (organisation, host) and per address; a removed feed frees both", () => {
    expect(flat).toContain("create unique index employer_job_feeds_one_per_org_host on public.employer_job_feeds (organization_id, host) where state <> 'removed'");
    expect(flat).toContain("create unique index employer_job_feeds_url_unique on public.employer_job_feeds (url) where state <> 'removed'");
  });
  it("is closed by column: RLS on, ONE member-select policy, a SELECT column list, and no INSERT, UPDATE or DELETE grant to any API role", () => {
    expect(flat).toContain("alter table public.employer_job_feeds enable row level security");
    expect(flat).toContain("revoke all on table public.employer_job_feeds from public, anon, authenticated");
    expect(flat).toMatch(/grant select \( id, organization_id, kind, url, host, site_proof_code/);
    expect(flat).not.toMatch(/grant [a-z, ()_]*(insert|update|delete)[a-z, ()_]* on (table )?public\.employer_job_feeds/);
    expect(flat).toContain("create policy \"members read their organisation's job feeds\"");
    expect(flat).toContain("using (public.is_org_member(organization_id))");
  });
});

describe("0246: employer_job_feed_attempts", () => {
  it("is unreachable by every API role (RLS on, everything revoked, no policy, no grant)", () => {
    expect(flat).toContain("alter table public.employer_job_feed_attempts enable row level security");
    expect(flat).toContain("revoke all on table public.employer_job_feed_attempts from public, anon, authenticated");
    expect(flat).not.toMatch(/grant [^;]* on (table )?public\.employer_job_feed_attempts/);
    expect(flat).not.toMatch(/create policy [^;]* on public\.employer_job_feed_attempts/);
  });
  it("records no code: the table has no code column", () => {
    const t = flat.slice(flat.indexOf("create table public.employer_job_feed_attempts"), flat.indexOf("comment on table public.employer_job_feed_attempts"));
    expect(t).not.toMatch(/code|token|secret/);
  });
});

describe("0246: the import markers on job_postings", () => {
  it("adds the three columns, both-or-neither, internal only, unique per feed", () => {
    expect(flat).toContain("add column import_feed_id uuid references public.employer_job_feeds (id), add column import_key text, add column employer_closed_at timestamptz");
    expect(flat).toContain("check ((import_feed_id is null) = (import_key is null))");
    expect(flat).toContain("check (import_feed_id is null or source_type = 'internal')");
    expect(flat).toContain("create unique index job_postings_import_unique on public.job_postings (import_feed_id, import_key) where import_feed_id is not null");
  });
  it("makes import_feed_id (and ONLY it) readable by the API roles; no UPDATE grant covers any of the three", () => {
    expect(flat).toContain("grant select (import_feed_id) on public.job_postings to anon, authenticated");
    expect(flat).not.toMatch(/grant select \([^)]*(import_key|employer_closed_at)/);
    expect(flat).not.toMatch(/grant (insert|update) \([^)]*(import_feed_id|import_key|employer_closed_at)/);
  });
  it("closes INSERT through the policy, because authenticated holds a table-level INSERT: the 0221 expression plus the three markers null", () => {
    const policy = flat.slice(flat.indexOf("alter policy"), flat.indexOf("grant select (import_feed_id)"));
    for (const clause of ["source_type = 'internal'::public.job_source_type", "public.is_org_member(organization_id)", "claimed_by_organization_id is null", "claimed_at is null", "import_feed_id is null", "import_key is null", "employer_closed_at is null"]) {
      expect(policy, clause).toContain(clause);
    }
  });
});

describe("0246: the UPDATE policy and the host check and the prune function", () => {
  it("the UPDATE policy requires import_feed_id null in BOTH USING and WITH CHECK, keeping 0190's other conditions", () => {
    const start = flat.indexOf('alter policy "org members can update their org\'s internal postings"');
    expect(start).toBeGreaterThan(-1);
    const policy = flat.slice(start, flat.indexOf("grant select (import_feed_id)"));
    const using = policy.slice(policy.indexOf("using ("), policy.indexOf("with check ("));
    const check = policy.slice(policy.indexOf("with check ("));
    for (const part of [using, check]) {
      expect(part).toContain("source_type = 'internal'::public.job_source_type");
      expect(part).toContain("public.is_org_member(organization_id)");
      expect(part).toContain("and import_feed_id is null");
    }
    expect(using).toContain("status <> 'removed'::public.job_status");
    expect(check).toContain("status in ('open'::public.job_status, 'closed'::public.job_status, 'draft'::public.job_status)");
  });
  it("the host is checked against the host part of the address (no userinfo, no port; the URL must match the pattern)", () => {
    expect(flat).toContain("constraint employer_job_feeds_host_is_url_host check (substring(url from '^https://([^/?#:@]+)([/?#]|$)') is not null and host = lower(substring(url from '^https://([^/?#:@]+)([/?#]|$)')))");
  });
  it("the prune function is service_role only, security definer with an empty search_path, and refuses anything newer than 7 days", () => {
    expect(flat).toContain("revoke all on function public.prune_employer_job_feed_attempts(interval) from public, anon, authenticated");
    expect(flat).toContain("grant execute on function public.prune_employer_job_feed_attempts(interval) to service_role");
    const body = flat.slice(flat.indexOf("create or replace function public.prune_employer_job_feed_attempts"), flat.indexOf("revoke all on function public.prune_employer_job_feed_attempts"));
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = ''");
    expect(body).toContain("p_older_than < interval '7 days'");
  });
});

describe("0246: the widget", () => {
  it("never lists an imported posting, and keeps its grants (service_role only)", () => {
    const body = flat.slice(flat.indexOf("create or replace function public.org_job_widget"), flat.indexOf("comment on function public.org_job_widget"));
    expect(body).toContain("and j.import_feed_id is null");
    expect(body).toContain("revoke execute on function public.org_job_widget(uuid) from public, anon, authenticated");
    expect(body).toContain("grant execute on function public.org_job_widget(uuid) to service_role");
    expect(body).toContain("and j.source_type = 'internal'");
  });
});

describe("0246: the self-check and the rollback", () => {
  it("fails the migration if a client could write a marker or reach the new tables", () => {
    const check = flat.slice(flat.indexOf("do $check$"));
    expect(check).toContain("a client can update an import marker column");
    expect(check).toContain("employer_job_feed_attempts is reachable by an api role");
    expect(check).toContain("the insert policy does not require the import markers to be null");
    expect(check).toContain("the update policy does not require import_feed_id to be null in both using and with check");
  });
  it("the rollback refuses to run while an imported posting exists, restores 0237's widget and 0221's policy, and drops everything it added", () => {
    expect(rollback).toContain("raise exception '0246 rollback refused");
    expect(rollback).toContain("where import_feed_id is not null");
    expect(rollback).not.toContain("import_feed_id is null\n"); // the restored widget has no marker predicate
    const widget = rollback.slice(rollback.indexOf("create or replace function public.org_job_widget"), rollback.indexOf("drop index"));
    expect(widget).not.toContain("import_feed_id");
    const restoredPolicy = rollback.slice(rollback.indexOf("alter policy"), rollback.indexOf("drop function if exists public.prune_employer_job_feed_attempts"));
    expect(restoredPolicy).toContain("claimed_at is null");
    expect(restoredPolicy).toContain("org members can update their org's internal postings");
    expect(restoredPolicy).toContain("status <> 'removed'::public.job_status");
    expect(restoredPolicy).not.toContain("import_");
    for (const dropped of ["drop table if exists public.employer_job_feed_attempts", "drop table if exists public.employer_job_feeds", "drop column if exists import_feed_id", "drop column if exists import_key", "drop column if exists employer_closed_at"]) {
      expect(rollback, dropped).toContain(dropped);
    }
  });
});

describe("0246 rollback: org_job_widget is restored exactly as 0237 defined it", () => {
  /** The function from "create or replace function public.org_job_widget" to the first line that is only "end" (comments and spacing included: a byte-for-byte restore is what a hash-gated rollback wrapper checks). */
  const widget = (sql: string) => {
    const start = sql.indexOf("create or replace function public.org_job_widget(p_org_id uuid)");
    expect(start, "no org_job_widget definition").toBeGreaterThan(-1);
    const rest = sql.slice(start);
    const end = rest.search(/\nend\n/);
    expect(end, "no end of the function body").toBeGreaterThan(-1);
    return rest.slice(0, end + 5);
  };
  it("is byte-identical to the 0237 definition, including its comment lines", () => {
    const original = readFileSync(join(__dirname, "../../supabase/migrations/0237_employer_job_widget.sql"), "utf8");
    expect(widget(rawRollback)).toBe(widget(original));
  });
});
