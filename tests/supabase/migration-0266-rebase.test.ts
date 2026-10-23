/**
 * V1-REBASE-1: the marks foundation was written as migration 0241 on a branch cut from origin/main at 867bd97b; the owner decision D1 (23 Oct 2026) renumbers it to 0266 on top of origin/main.
 * What the renumbering changes, pinned here so that it cannot half-happen: the files, every mention of the number, the register rows (and the hashes in them), and the grants posture (0266 is after
 * the grants-new-rule cutoff in ci.yml, so every object it adds must carry its own explicit grants). Reads files only (no database).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
const read = (p: string) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : "");
const sha = (p: string) => (existsSync(join(ROOT, p)) ? createHash("sha256").update(readFileSync(join(ROOT, p))).digest("hex") : "missing");
const MIGRATION = "supabase/migrations/0266_verification_marks.sql";
const ROLLBACK = "supabase/rollbacks/0266_verification_marks.rollback.sql";
const strip = (t: string) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const flat = (t: string) => strip(t).replace(/\s+/g, " ").toLowerCase();

describe("the files carry the new number and the old one is gone", () => {
  it("0266 migration and rollback exist; no file of either folder is numbered 0241", () => {
    expect(existsSync(join(ROOT, MIGRATION))).toBe(true);
    expect(existsSync(join(ROOT, ROLLBACK))).toBe(true);
    expect(readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.startsWith("0241"))).toEqual([]);
    expect(readdirSync(join(ROOT, "supabase/rollbacks")).filter((f) => f.startsWith("0241"))).toEqual([]);
    expect(readdirSync(join(ROOT, "tests/supabase")).filter((f) => f.startsWith("migration-0241"))).toEqual([]);
  });
  it("no V1 file names 0241 any more (the one historical report path is the only exception)", () => {
    const files = [MIGRATION, ROLLBACK, "tests/supabase/migration-0266-shape.test.ts", "tests/supabase/migration-0266-rebase.test.ts", "tests/rls/verification-marks.test.ts", "docs/account-deletion-map.md"];
    const hits = files.filter((f) => existsSync(join(ROOT, f))).flatMap((f) => read(f).split("\n").map((l, i) => [f, i + 1, l] as const).filter(([, , l]) => /0241/.test(l.replace("reports/S3-21/raw/0241/", "")) && !/migration-0266-rebase/.test(f)).map(([ff, n]) => `${ff}:${n}`));
    expect(hits).toEqual([]);
  });
  it("the migration and the rollback say 0266 in their messages and their title", () => {
    expect(read(MIGRATION)).toMatch(/^-- 0266: the marks foundation/);
    expect(read(MIGRATION)).toContain("0266 self-check");
    expect(read(ROLLBACK)).toContain("0266 rollback refused");
    expect(read(MIGRATION)).toContain("supabase/rollbacks/0266_verification_marks.rollback.sql");
  });
});

describe("the register", () => {
  const rows = read("docs/database-environments.md").split("\n").filter((l) => /^\| 02(41|66) \|/.test(l));
  const row = (n: string) => rows.find((l) => l.startsWith(`| ${n} |`)) ?? "";
  it("has a 0266 row that names both files and carries their real sha256 values", () => {
    const r = row("0266");
    expect(r).toContain("supabase/migrations/0266_verification_marks.sql");
    expect(r).toContain("supabase/rollbacks/0266_verification_marks.rollback.sql");
    expect(r).toContain(sha(MIGRATION));
    expect(r).toContain(sha(ROLLBACK));
    expect(r).toMatch(/renumbered from 0241/);
  });
  it("the 0266 row is not 'proposed' in both cells (the file is in the tree) and applies nothing: neither cell says applied", () => {
    const cells = row("0266").split("|").map((c) => c.trim()).filter(Boolean);
    const [prod, preview] = cells.slice(-2);
    expect(/^proposed/i.test(prod) && /^proposed/i.test(preview)).toBe(false);
    expect(prod).not.toMatch(/^applied/i);
    expect(preview).not.toMatch(/^applied/i);
  });
  it("the 0241 row is released: it names no file and both cells say n/a", () => {
    const r = row("0241");
    expect(r).toMatch(/renumbered to 0266/);
    expect(r).not.toContain("supabase/migrations/0241");
    const cells = r.split("|").map((c) => c.trim()).filter(Boolean);
    expect(cells.slice(-2).every((c) => /n\/a/i.test(c))).toBe(true);
  });
});

describe("the grants posture of a migration numbered after the grants-new-rule cutoff", () => {
  const ci = read(".github/workflows/ci.yml");
  it("0266 is numbered after GRANTS_CUTOFF, so the new-rule job applies it under the new default", () => {
    const cutoff = Number(/GRANTS_CUTOFF:\s*"(\d{4})"/.exec(ci)?.[1]);
    expect(cutoff).toBeGreaterThan(200);
    expect(266).toBeGreaterThan(cutoff);
  });
  const code = flat(read(MIGRATION));
  it("adds exactly one table, no view, no sequence, no materialized view", () => {
    expect([...code.matchAll(/create table (?:if not exists )?(public\.\w+)/g)].map((m) => m[1])).toEqual(["public.verification_marks"]);
    expect(code).not.toMatch(/create (or replace )?(materialized )?view/);
    expect(code).not.toMatch(/create sequence|\bserial\b|generated (always|by default) as identity/);
  });
  it("creates or replaces exactly these six functions", () => {
    const names = [...code.matchAll(/create (?:or replace )?function (public\.\w+)\(/g)].map((m) => m[1]).sort();
    expect(names).toEqual(["public.applicant_visible_marks", "public.award_verification_mark", "public.employer_visible_marks", "public.resolve_talent_verification", "public.resume_content_hash", "public.verification_mark_is_live"]);
  });
  it("states every grant and revoke of the migration explicitly, and these are all of them", () => {
    const statements = [...code.matchAll(/\b(?:grant|revoke) [^;]+;/g)].map((m) => m[0]);
    expect(statements).toEqual([
      "revoke all on table public.verification_marks from public, anon, authenticated, service_role;",
      "grant select (id, user_id, mark_type, field, level, review_type, earned_at, expires_at) on public.verification_marks to authenticated;",
      "grant select, insert on table public.verification_marks to service_role;",
      "revoke all on function public.verification_mark_is_live(timestamptz, timestamptz) from public, anon, authenticated;",
      "revoke all on function public.resume_content_hash(uuid) from public, anon, authenticated;",
      "revoke all on function public.award_verification_mark(uuid, text, text, text, text, uuid, text, timestamptz) from public, anon, authenticated;",
      "revoke all on function public.resolve_talent_verification(uuid, uuid, boolean, integer, text, uuid, text) from public, anon, authenticated;",
      "revoke all on function public.employer_visible_marks(uuid[]) from public, anon;",
      "revoke all on function public.applicant_visible_marks(uuid) from public, anon;",
      "grant execute on function public.verification_mark_is_live(timestamptz, timestamptz) to service_role;",
      "grant execute on function public.resume_content_hash(uuid) to service_role;",
      "grant execute on function public.award_verification_mark(uuid, text, text, text, text, uuid, text, timestamptz) to service_role;",
      "grant execute on function public.resolve_talent_verification(uuid, uuid, boolean, integer, text, uuid, text) to service_role;",
      "grant execute on function public.employer_visible_marks(uuid[]) to authenticated, service_role;",
      "grant execute on function public.applicant_visible_marks(uuid) to authenticated, service_role;",
    ]);
  });
  it("the table is readable by service_role (the new-rule job selects from it over the Data API): select is granted to it explicitly", () => {
    expect(code).toContain("grant select, insert on table public.verification_marks to service_role;");
  });
});
