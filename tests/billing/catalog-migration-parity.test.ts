/**
 * Template library PR 3 of 3 — the regression guard for the exact bug class
 * PR2 shipped and fixed (see `src/lib/billing/catalog.ts`'s own header, and
 * `supabase/migrations/0105_resume_template_library.sql`'s header).
 *
 * THE BUG THIS GUARDS AGAINST. `scripts/seed-catalog.ts` upserts
 * `RESUME_TEMPLATES` on every CI job, against a fresh-per-job ephemeral
 * Supabase stack, BEFORE the unit tests run. A per-slug migration `UPDATE`
 * (or an `INSERT` whose values only a migration ever wrote) can set
 * `ats_safe`/`structure_schema` correctly on every database that already has
 * the row — and still be silently wrong for CI, because on a truly fresh
 * stack the row does not exist yet when the migration runs, the `UPDATE`
 * matches zero rows, and `seed-catalog.ts`'s later upsert creates the row
 * from `RESUME_TEMPLATES` alone. If `RESUME_TEMPLATES` and the migration ever
 * disagree, CI and production would silently render two different
 * `ats_safe`/`structure_schema` values for the same slug — and nothing
 * before this test would notice, because `template-registry.test.ts`'s
 * DB-backed assertions only check the LIVE catalog against application code,
 * never the migration file against `RESUME_TEMPLATES` directly.
 *
 * WHY THIS TEST NEEDS NO DATABASE. It reads two files: the migration's own
 * SQL text, and `RESUME_TEMPLATES`. Deliberately independent of both
 * `npm run db:local` and the hosted projects, so it runs in every
 * environment, including one with no Supabase reachable at all.
 *
 * SABOTAGE-PROOF, PERFORMED LIVE DURING THIS PR. Temporarily changed
 * `product-tech`'s `ats_safe` in `RESUME_TEMPLATES` from `false` to `true`
 * (leaving the migration's own `false` untouched) and ran this file alone —
 * it failed immediately with `ats_safe: RESUME_TEMPLATES says true, migration
 * 0105 says false`, then passed again once reverted. See the PR description
 * for the full transcript.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { RESUME_TEMPLATES } from "@/lib/billing/catalog";

const MIGRATION_PATH = path.resolve(
  __dirname,
  "../../supabase/migrations/0105_resume_template_library.sql",
);

/**
 * Slugs this migration is NOT the source of truth for:
 *   - `clean-professional`'s structure_schema/ats_safe live in migration 0104.
 *   - The six pre-PR2 bespoke components never got a structure_schema at all
 *     (they stay `{}` — see catalog.ts, they are not skeleton-configured).
 */
const OUT_OF_SCOPE_SLUGS = new Set([
  "clean-professional",
  "clinical",
  "statute",
  "critical-path",
  "public-record",
  "portfolio-grid",
  "pipeline",
]);

/** Read a single-quoted SQL string literal starting at `text[start] === "'"`, handling `''` as an escaped quote. Returns the unescaped value and the index just past the closing quote. */
function readSqlString(text: string, start: number): { value: string; end: number } {
  if (text[start] !== "'") throw new Error(`expected a quote at index ${start}`);
  let i = start + 1;
  let out = "";
  while (i < text.length) {
    if (text[i] === "'") {
      if (text[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      return { value: out, end: i + 1 };
    }
    out += text[i];
    i += 1;
  }
  throw new Error(`unterminated string literal starting at ${start}`);
}

/** Split a parenthesized SQL tuple's top-level fields on commas, respecting quoted strings (so a comma inside a JSON payload is not a field separator). */
function splitTopLevelFields(inner: string): string[] {
  const fields: string[] = [];
  let depth = 0;
  let current = "";
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === "'") {
      const { value, end } = readSqlString(inner, i);
      current += `'${value.replace(/'/g, "''")}'`;
      i = end;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      fields.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  if (current.trim().length > 0) fields.push(current.trim());
  return fields;
}

/** A field that is a quoted string, optionally with a trailing `::jsonb` cast. */
function parseQuotedField(field: string): string {
  const trimmed = field.trim();
  const { value } = readSqlString(trimmed, 0);
  return value;
}

interface ParsedRow {
  slug: string;
  atsSafe: boolean;
  structureSchema: unknown;
}

function parseInsertBlock(sql: string): ParsedRow[] {
  const startMarker = "insert into public.resume_templates";
  const start = sql.indexOf(startMarker);
  if (start === -1) throw new Error("migration has no resume_templates INSERT block");
  const valuesIdx = sql.indexOf("values", start);
  const endMarker = "on conflict (slug) do nothing;";
  const end = sql.indexOf(endMarker, valuesIdx);
  if (end === -1) throw new Error("could not find end of INSERT block");
  const body = sql.slice(valuesIdx + "values".length, end);

  // Scan top-level parenthesized tuples: '(' at depth 0 opens one, matching
  // ')' at depth 0 closes it. Quoted strings are skipped whole so a `(`/`)`
  // inside a JSON payload's own text never confuses the depth counter.
  const rows: ParsedRow[] = [];
  let i = 0;
  while (i < body.length) {
    if (body[i] === "'") {
      i = readSqlString(body, i).end;
      continue;
    }
    if (body[i] === "(") {
      let depth = 1;
      const tupleStart = i + 1;
      let j = i + 1;
      while (j < body.length && depth > 0) {
        if (body[j] === "'") {
          j = readSqlString(body, j).end;
          continue;
        }
        if (body[j] === "(") depth += 1;
        if (body[j] === ")") depth -= 1;
        j += 1;
      }
      const tuple = body.slice(tupleStart, j - 1);
      const fields = splitTopLevelFields(tuple);
      // (name, slug, industry_category, is_premium, unlock_cost_credits, ats_safe, structure_schema::jsonb)
      if (fields.length !== 7) {
        throw new Error(`expected 7 fields in INSERT tuple, got ${fields.length}: ${tuple.slice(0, 80)}...`);
      }
      const slug = parseQuotedField(fields[1]);
      const atsSafe = fields[5].trim() === "true";
      const schemaJson = parseQuotedField(fields[6]);
      rows.push({ slug, atsSafe, structureSchema: JSON.parse(schemaJson) });
      i = j;
      continue;
    }
    i += 1;
  }
  return rows;
}

function parseFixedSlugUpdates(sql: string): ParsedRow[] {
  const atsSafeBySlug = new Map<string, boolean>();
  const atsRe = /update public\.resume_templates set ats_safe = (true|false) where slug = '([a-z0-9-]+)';/g;
  for (const m of sql.matchAll(atsRe)) {
    atsSafeBySlug.set(m[2], m[1] === "true");
  }

  const schemaBySlug = new Map<string, unknown>();
  const schemaMarker = "update public.resume_templates\nset structure_schema = ";
  let searchFrom = 0;
  for (;;) {
    const idx = sql.indexOf(schemaMarker, searchFrom);
    if (idx === -1) break;
    const quoteStart = idx + schemaMarker.length;
    const { value, end } = readSqlString(sql, quoteStart);
    const afterCast = sql.slice(end, end + "::jsonb\nwhere slug = '".length);
    if (!afterCast.startsWith("::jsonb\nwhere slug = '")) {
      throw new Error(`unexpected text after structure_schema literal: ${afterCast}`);
    }
    const slugStart = end + "::jsonb\nwhere slug = '".length - 1; // position of the opening quote
    const { value: slug, end: slugEnd } = readSqlString(sql, slugStart);
    schemaBySlug.set(slug, JSON.parse(value));
    searchFrom = slugEnd;
  }

  const slugs = new Set([...atsSafeBySlug.keys(), ...schemaBySlug.keys()]);
  return Array.from(slugs).map((slug) => ({
    slug,
    atsSafe: atsSafeBySlug.get(slug)!,
    structureSchema: schemaBySlug.get(slug),
  }));
}

describe("RESUME_TEMPLATES vs the migration that seeds production — must never diverge", () => {
  const migrationSql = readFileSync(MIGRATION_PATH, "utf8");
  const insertRows = parseInsertBlock(migrationSql);
  const fixedRows = parseFixedSlugUpdates(migrationSql);
  const migrationBySlug = new Map<string, ParsedRow>();
  for (const row of [...insertRows, ...fixedRows]) migrationBySlug.set(row.slug, row);

  const catalogSlugs = RESUME_TEMPLATES.map((t) => t.slug).filter((s) => !OUT_OF_SCOPE_SLUGS.has(s));

  it("parsed 58 rows out of the migration (54 inserted + 4 fixed)", () => {
    expect(insertRows).toHaveLength(54);
    expect(fixedRows).toHaveLength(4);
    expect(migrationBySlug.size).toBe(58);
  });

  it("the migration and RESUME_TEMPLATES cover exactly the same set of slugs", () => {
    const migrationSlugs = Array.from(migrationBySlug.keys()).sort();
    expect(catalogSlugs.slice().sort()).toEqual(migrationSlugs);
  });

  it("every slug's ats_safe agrees between RESUME_TEMPLATES and the migration", () => {
    const mismatched: string[] = [];
    for (const t of RESUME_TEMPLATES) {
      if (OUT_OF_SCOPE_SLUGS.has(t.slug)) continue;
      const migrated = migrationBySlug.get(t.slug);
      if (!migrated) {
        mismatched.push(`${t.slug}: not found in migration 0105 at all`);
        continue;
      }
      if (migrated.atsSafe !== t.ats_safe) {
        mismatched.push(`${t.slug}: RESUME_TEMPLATES says ${t.ats_safe}, migration 0105 says ${migrated.atsSafe}`);
      }
    }
    expect(mismatched, "ats_safe has drifted between catalog.ts and the migration").toEqual([]);
  });

  it("every slug's structure_schema agrees between RESUME_TEMPLATES and the migration", () => {
    const mismatched: string[] = [];
    for (const t of RESUME_TEMPLATES) {
      if (OUT_OF_SCOPE_SLUGS.has(t.slug)) continue;
      const migrated = migrationBySlug.get(t.slug);
      if (!migrated) continue; // reported by the previous test
      if (JSON.stringify(migrated.structureSchema) !== JSON.stringify(t.structure_schema)) {
        mismatched.push(t.slug);
      }
    }
    expect(mismatched, "structure_schema has drifted between catalog.ts and the migration").toEqual([]);
  });
});
