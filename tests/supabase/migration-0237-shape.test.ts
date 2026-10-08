/**
 * Migration 0237 (the employer job-list widget, database part) — its shape, read from the files (no database). The behaviour is in tests/rls/employer-widgets.test.ts (database-backed, CI only); this pins what a
 * behavioural test would not catch until somebody was hurt by it:
 *
 *   - the one public read states EVERY gate itself (a SECURITY DEFINER function does not run row level security: 0109), and its output has exactly the agreed keys, so no applicant or internal field can ever be added by accident;
 *   - the table is closed by COLUMN grants (a row policy does not restrict columns), with no table-level grant, no DELETE and no client write to the timestamps;
 *   - nothing here reaches job_postings through a trigger, an outbox or a poller (plan v2.1 item d);
 *   - the rollback removes the function before the table it reads.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(__dirname, "../../supabase/migrations/0237_employer_job_widget.sql");
const ROLLBACK = join(__dirname, "../../supabase/rollbacks/0237_employer_job_widget.rollback.sql");
const strip = (t: string) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const raw = existsSync(MIGRATION) ? readFileSync(MIGRATION, "utf8") : "";
const rawRollback = existsSync(ROLLBACK) ? readFileSync(ROLLBACK, "utf8") : "";
const code = strip(raw);
const flat = code.replace(/\s+/g, " ").toLowerCase();
const rollback = strip(rawRollback).replace(/\s+/g, " ").toLowerCase();

/** The body of org_job_widget, between its dollar quotes. */
const fnBody = (() => {
  const start = code.indexOf("$f$");
  const end = code.lastIndexOf("$f$");
  return start >= 0 && end > start ? code.slice(start + 3, end) : "";
})();
const fnFlat = fnBody.replace(/\s+/g, " ").toLowerCase();

describe("0237: the files", () => {
  it("exist under the registered number, and name no placeholder number anywhere", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(existsSync(ROLLBACK)).toBe(true);
    expect(raw).not.toMatch(/NNNN/);
    expect(rawRollback).not.toMatch(/NNNN/);
    expect(fnBody.length).toBeGreaterThan(200);
  });
});

describe("0237: org_job_widget states every gate itself", () => {
  it("is SECURITY DEFINER with a pinned search_path, and executable by service_role only", () => {
    expect(flat).toMatch(/create or replace function public\.org_job_widget\(p_org_id uuid\) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as \$f\$/);
    expect(flat).toMatch(/revoke execute on function public\.org_job_widget\(uuid\) from public, anon, authenticated;/);
    expect(flat).toMatch(/grant execute on function public\.org_job_widget\(uuid\) to service_role;/);
    expect(flat).not.toMatch(/grant execute on function public\.org_job_widget\(uuid\) to [^;]*(anon|authenticated|public)/);
  });

  it.each([
    ["the organisation is verified", /\bo\.verified\b/],
    ["the widget row exists and is enabled", /join public\.employer_widgets w on w\.organization_id = o\.id/],
    ["the widget is enabled", /\bw\.enabled\b/],
    ["the creator is not a QA account (0240 rule, called with the same four arguments as everywhere else)", /not public\.is_qa_account\(c\.email, c\.first_name, c\.last_name, c\.referral_leaderboard_display_name\)/],
    ["only the organisation's own postings", /j\.organization_id = p_org_id/],
    ["internal postings only", /j\.source_type = 'internal'/],
    ["open only", /j\.status = 'open'/],
    ["not removed", /j\.removed_at is null/],
    ["not unlisted (a link-only posting never appears in a list)", /j\.unlisted_at is null/],
    ["not superseded", /j\.superseded_at is null/],
    ["within the closing date", /\(j\.expires_at is null or j\.expires_at > now\(\)\)/],
    ["capped at the organisation's own max_items", /limit v_max/],
    ["newest first, with a tie-break", /order by j\.posted_at desc, j\.id desc/],
    ["a failed gate answers NULL, the same for every cause", /if not found then return null;/],
  ])("%s", (_name, re) => {
    expect(fnFlat).toMatch(re);
  });

  it("returns EXACTLY the agreed keys: {org:{name, logo_url}, jobs:[{id, title, location, work_type, employment_type, posted_at}]}", () => {
    const keys = [...fnBody.matchAll(/'([a-z_]+)',\s/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual(["employment_type", "id", "jobs", "location", "logo_url", "name", "org", "posted_at", "title", "work_type"].sort());
  });

  it("never reads a column that could carry applicant, money, internal or description data", () => {
    for (const word of ["description", "salary", "structured_jd", "external_url", "applications", "applicant", "admin_review", "removal_reason", "removed_by", "banner_path", "claimed_by"]) {
      expect(fnFlat, `org_job_widget must not mention ${word}`).not.toContain(word);
    }
  });
});

describe("0237: employer_widgets is closed by column grants and row policies", () => {
  it("has the agreed columns, defaults and constraints", () => {
    expect(flat).toMatch(/organization_id uuid primary key references public\.organizations \(id\) on delete cascade/);
    expect(flat).toMatch(/enabled boolean not null default false/);
    expect(flat).toMatch(/max_items integer not null default 10 check \(max_items between 1 and 20\)/);
    expect(flat).toMatch(/alter table public\.employer_widgets enable row level security;/);
  });

  it("revokes everything first, then grants exactly the agreed columns (no table-level grant, no DELETE)", () => {
    expect(flat).toMatch(/revoke all on table public\.employer_widgets from public, anon, authenticated;/);
    expect(flat).toMatch(/grant select \(organization_id, enabled, max_items, created_at, updated_at\) on public\.employer_widgets to authenticated;/);
    expect(flat).toMatch(/grant insert \(organization_id, enabled, max_items\) on public\.employer_widgets to authenticated;/);
    expect(flat).toMatch(/grant update \(enabled, max_items\) on public\.employer_widgets to authenticated;/);
    const grants = flat.match(/grant [a-z]+ (?:\([^)]*\) )?on (?:table )?public\.employer_widgets to [a-z_, ]+;/g) ?? [];
    expect(grants).toHaveLength(3);
    expect(flat).not.toMatch(/grant (all|delete|truncate|references|trigger)\b[^;]*employer_widgets/);
    expect(flat).not.toMatch(/on public\.employer_widgets to [^;]*(anon|public)/);
  });

  it("has three policies, all TO authenticated and all membership-based; none for anon, none for DELETE", () => {
    const policies = flat.match(/create policy "[^"]+" on public\.employer_widgets for (select|insert|update) to authenticated/g) ?? [];
    expect(policies.map((p) => p.match(/for (\w+)/)![1]).sort()).toEqual(["insert", "select", "update"]);
    expect(flat.match(/create policy/g)?.length).toBe(3);
    expect(flat).not.toMatch(/for delete/);
    // select (using), insert (with check), update (using and with check): four membership checks, and no other condition on any of them
    expect(flat.match(/public\.is_org_member\(organization_id\)/g)?.length).toBe(4);
  });

  it("keeps the timestamps out of client hands: a trigger stamps updated_at, and the trigger function is closed", () => {
    expect(flat).toMatch(/new\.updated_at := pg_catalog\.now\(\);/);
    expect(flat).toMatch(/revoke execute on function public\.employer_widgets_touch_updated_at\(\) from public, anon, authenticated;/);
    expect(flat).toMatch(/create trigger employer_widgets_touch_updated_at before update on public\.employer_widgets for each row/);
  });
});

describe("0237: what it must NOT do", () => {
  it("adds no trigger on job_postings, no outbox, no poller, no cron, and changes no existing policy or grant", () => {
    expect(flat.match(/create trigger/g)?.length).toBe(1);
    expect(flat).not.toMatch(/trigger [a-z_]+ (before|after) [a-z ]+ on public\.job_postings/);
    expect(flat).not.toMatch(/outbox|cron\.|pg_cron|pg_net|http_/);
    expect(flat).not.toMatch(/\balter policy\b|\bdrop policy\b|alter table public\.job_postings|create policy [^;]*on public\.job_postings/);
    expect(flat).not.toMatch(/(grant|revoke) [^;]*on (table )?public\.(job_postings|organizations|profiles)\b/);
  });

  it("adds the partial index the read uses, and only that index", () => {
    expect(flat).toMatch(/create index if not exists job_postings_org_open_internal_posted_idx on public\.job_postings \(organization_id, posted_at desc\) where status = 'open' and source_type = 'internal';/);
    expect(flat.match(/create index/g)?.length).toBe(1);
  });
});

describe("0237: the rollback", () => {
  it("is one transaction and removes the function before the table it reads, then the trigger function and the index", () => {
    expect(rollback.trim().startsWith("begin;")).toBe(true);
    expect(rollback.trim().endsWith("commit;")).toBe(true);
    const order = [
      "drop function if exists public.org_job_widget(uuid);",
      "drop table if exists public.employer_widgets;",
      "drop function if exists public.employer_widgets_touch_updated_at();",
      "drop index if exists public.job_postings_org_open_internal_posted_idx;",
    ].map((s) => rollback.indexOf(s));
    for (const i of order) expect(i).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
