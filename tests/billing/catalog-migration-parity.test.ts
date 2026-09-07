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
 *
 * `is_premium`/`unlock_cost_credits` PARITY (added by the free-tier-cut PR,
 * migration 0110). Until that PR, this file's `structure_schema` string
 * appeared only in this comment — there was no assertion at all comparing
 * `is_premium`/`unlock_cost_credits` between `catalog.ts` and any migration,
 * which is exactly the same drift class this file already guards `ats_safe`/
 * `structure_schema` against, just for the two columns that gate spending
 * credits. See `IS_PREMIUM_OUT_OF_SCOPE_SLUGS` and
 * `IS_PREMIUM_SUPERSEDED_BY_LATER_MIGRATION` below for which migration is
 * each slug's source of truth for those two columns specifically — it is NOT
 * the same set of slugs as `OUT_OF_SCOPE_SLUGS`/
 * `STRUCTURE_SCHEMA_SUPERSEDED_BY_LATER_MIGRATION` above, because 0105 never
 * set `is_premium`/`unlock_cost_credits` for the four pre-existing slugs it
 * only sent `ats_safe`/`structure_schema` UPDATEs for (`structured-admin`,
 * `product-tech`, `field-notes`, `ledger` — see 0105's own header), so a
 * slug can be in-scope for one column pair and out-of-scope for the other.
 *
 * SABOTAGE-PROOF, PERFORMED LIVE DURING THIS PR. Temporarily changed
 * `manifest`'s `unlock_cost_credits` in `RESUME_TEMPLATES` from `10` to `5`
 * (leaving migration 0110's own `10` untouched) and ran this file alone — it
 * failed immediately naming `manifest` and both values, then passed again
 * once reverted. See the PR description for the full transcript.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { RESUME_TEMPLATES } from "@/lib/billing/catalog";

const MIGRATION_PATH = path.resolve(
  __dirname,
  "../../supabase/migrations/0105_resume_template_library.sql",
);

const MIGRATION_0110_PATH = path.resolve(
  __dirname,
  "../../supabase/migrations/0110_template_free_tier_cut.sql",
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

/**
 * Every slug here stays IN scope for the slug-coverage and `ats_safe` checks
 * above — only the `structure_schema` comparison against 0105's own frozen
 * text is excluded, because each one's true current value now lives in a
 * later migration instead. Same reasoning as `clean-professional`'s
 * exclusion above: the slug's true current source of record has moved.
 *
 * `blueprint` alone: 0105 shipped it with a `sectionLabels.certifications`
 * value that named a real licensing body (COREN) the shared demo content
 * can't back up; migration 0106 corrected that.
 *
 * All 11 listed here (`blueprint` included): the "layout retune" pass
 * (`catalog-configs.ts`'s own "LAYOUT RETUNE PASS" header comment) changed
 * `styleTokens` for each of these — dedicated-persona slugs that were still
 * visual near-duplicates of a sibling sharing their skeleton — and migration
 * `0110_persona_layout_token_retune.sql` is what corrected the LIVE data to
 * match. For `blueprint` specifically, 0110 supersedes 0106's own
 * `structure_schema` value too (0110 carries 0106's `sectionLabels` fix
 * forward unchanged, plus the new `styleTokens`), so `blueprint` moves from
 * being checked against 0106 to being checked against 0110 below, alongside
 * the other 10.
 */
const STRUCTURE_SCHEMA_SUPERSEDED_BY_LATER_MIGRATION = new Set([
  "blueprint",
  "business-memo",
  "harvest",
  "site-plan",
  "product-tech",
  "rig-report",
  "specification",
  "foundation",
  "offshore",
  "chambers",
  "schematic",
]);

/** The 11 slugs `0110_persona_layout_token_retune.sql` corrected — every one of `STRUCTURE_SCHEMA_SUPERSEDED_BY_LATER_MIGRATION`'s members. */
const LAYOUT_RETUNE_SLUGS = [
  "blueprint",
  "business-memo",
  "harvest",
  "site-plan",
  "product-tech",
  "rig-report",
  "specification",
  "foundation",
  "offshore",
  "chambers",
  "schematic",
] as const;

/**
 * Slugs whose `is_premium`/`unlock_cost_credits` have NEVER been set by any
 * migration living in this repo — they were free/premium already in 0042
 * (not in this repo; applied straight to the project, per CLAUDE.md), and
 * neither 0105 nor 0110 touches them:
 *   - `clean-professional`, `structured-admin`, `ledger`: the three of the
 *     "four pre-existing free slugs" (0105's own header) that the free-tier
 *     cut (0110) leaves free — 0105 only ever sent them `ats_safe`/
 *     `structure_schema` UPDATEs, never touched `is_premium`.
 *   - `statute`, `critical-path`, `public-record`, `portfolio-grid`,
 *     `pipeline`: the five pre-PR2 bespoke premium slugs, same reasoning as
 *     `OUT_OF_SCOPE_SLUGS` above — untouched by 0105 or 0110.
 * No in-repo migration text exists to compare `RESUME_TEMPLATES` against for
 * these, so they are excluded from the is_premium/unlock_cost_credits checks
 * entirely, rather than being silently checked against the wrong migration.
 */
const IS_PREMIUM_OUT_OF_SCOPE_SLUGS = new Set([
  "clean-professional",
  "structured-admin",
  "ledger",
  "statute",
  "critical-path",
  "public-record",
  "portfolio-grid",
  "pipeline",
]);

/**
 * The 18 slugs the free-tier-cut migration (0110) flips from free to
 * premium. For these, 0110 — not 0105 — is the current source of truth for
 * `is_premium`/`unlock_cost_credits`, same "true current source has moved to
 * a later migration" reasoning as `STRUCTURE_SCHEMA_SUPERSEDED_BY_LATER_MIGRATION`
 * above (blueprint/0106), just for a different column pair and a different
 * later migration. Two of these (`product-tech`, `field-notes`) are also two
 * of the "four pre-existing" slugs 0105 never set `is_premium` for at all —
 * 0110 is their first-ever in-repo `is_premium` value, not a correction of
 * an earlier one. `clinical` is one of the five pre-PR2 bespoke slugs in
 * `OUT_OF_SCOPE_SLUGS` above for `ats_safe`/`structure_schema` purposes, but
 * IS in scope here because 0110 is the first migration to ever touch its
 * `is_premium` value. The other 15 were part of 0105's 54-row INSERT (which
 * did set `is_premium`/`unlock_cost_credits` there, to free/0) and are
 * superseded here by 0110's correction to premium/10.
 */
const IS_PREMIUM_SUPERSEDED_BY_LATER_MIGRATION = new Set([
  "business-memo",
  "filing-system",
  "product-tech",
  "studio-brief",
  "field-notes",
  "help-desk",
  "compliance-brief",
  "clinical",
  "chambers",
  "sprint-board",
  "civic-record",
  "byline",
  "harvest",
  "rig-report",
  "network-ops",
  "site-plan",
  "front-desk",
  "manifest",
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
  /**
   * Only populated from 0105's INSERT block (the 54 new rows) — 0105's
   * fixed-slug UPDATEs (`parseFixedSlugUpdates`) never touch these two
   * columns, so `undefined` here means "this migration has no opinion",
   * not "false"/"0". Callers must check for `undefined`, not falsiness.
   */
  isPremium?: boolean;
  unlockCostCredits?: number;
}

interface PremiumRow {
  slug: string;
  isPremium: boolean;
  unlockCostCredits: number;
}

/** Parses 0110's `update ... set is_premium = ..., unlock_cost_credits = ... where slug = '...';` lines. */
function parsePremiumUpdates(sql: string): PremiumRow[] {
  const re =
    /update public\.resume_templates set is_premium = (true|false), unlock_cost_credits = (\d+) where slug = '([a-z0-9-]+)';/g;
  const rows: PremiumRow[] = [];
  for (const m of sql.matchAll(re)) {
    rows.push({ slug: m[3], isPremium: m[1] === "true", unlockCostCredits: Number(m[2]) });
  }
  return rows;
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
      const isPremium = fields[3].trim() === "true";
      const unlockCostCredits = Number(fields[4].trim());
      const atsSafe = fields[5].trim() === "true";
      const schemaJson = parseQuotedField(fields[6]);
      rows.push({ slug, atsSafe, structureSchema: JSON.parse(schemaJson), isPremium, unlockCostCredits });
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
      if (STRUCTURE_SCHEMA_SUPERSEDED_BY_LATER_MIGRATION.has(t.slug)) continue;
      const migrated = migrationBySlug.get(t.slug);
      if (!migrated) continue; // reported by the previous test
      if (JSON.stringify(migrated.structureSchema) !== JSON.stringify(t.structure_schema)) {
        mismatched.push(t.slug);
      }
    }
    expect(mismatched, "structure_schema has drifted between catalog.ts and the migration").toEqual([]);
  });

  it("the 11 layout-retuned slugs' structure_schema instead agree with their corrective migration, 0110", () => {
    // 0110 uses the exact same `update public.resume_templates\nset
    // structure_schema = '...'::jsonb\nwhere slug = '...';` shape
    // `parseFixedSlugUpdates` above already parses generically (originally
    // written for this same shape elsewhere in 0105) — reuse it rather than
    // hand-rolling a second parser.
    const migration0110 = readFileSync(
      path.resolve(__dirname, "../../supabase/migrations/0110_persona_layout_token_retune.sql"),
      "utf8",
    );
    const rows0110 = parseFixedSlugUpdates(migration0110);
    const bySlug0110 = new Map(rows0110.map((r) => [r.slug, r]));

    expect(
      Array.from(bySlug0110.keys()).sort(),
      "0110 should update exactly the 11 layout-retune slugs, no more, no fewer",
    ).toEqual(Array.from(LAYOUT_RETUNE_SLUGS).sort());

    const mismatched: string[] = [];
    for (const slug of LAYOUT_RETUNE_SLUGS) {
      const t = RESUME_TEMPLATES.find((row) => row.slug === slug);
      if (!t) {
        mismatched.push(`${slug}: not found in RESUME_TEMPLATES`);
        continue;
      }
      const migrated = bySlug0110.get(slug);
      if (!migrated) {
        mismatched.push(`${slug}: not found in migration 0110`);
        continue;
      }
      if (JSON.stringify(migrated.structureSchema) !== JSON.stringify(t.structure_schema)) {
        mismatched.push(`${slug}: RESUME_TEMPLATES and migration 0110 disagree on structure_schema`);
      }
    }
    expect(mismatched, "structure_schema has drifted between catalog.ts and migration 0110").toEqual([]);
  });

  it("blueprint's structure_schema also carries 0106's sectionLabels fix forward", () => {
    const migration0106 = readFileSync(
      path.resolve(__dirname, "../../supabase/migrations/0106_blueprint_certifications_label.sql"),
      "utf8",
    );
    const blueprint = RESUME_TEMPLATES.find((t) => t.slug === "blueprint");
    expect(blueprint, "blueprint should still exist in RESUME_TEMPLATES").toBeDefined();

    // The migration sets structure_schema via a single `set structure_schema
    // = '...'::jsonb` literal — extract and parse it the same way the rest
    // of this file parses 0105's JSON literals.
    const marker = "set structure_schema = ";
    const markerIndex = migration0106.indexOf(marker);
    expect(markerIndex, "expected to find the UPDATE's structure_schema literal in 0106").toBeGreaterThan(-1);
    const openingQuoteIndex = markerIndex + marker.length;
    const { value } = readSqlString(migration0106, openingQuoteIndex);
    const migratedSchema = JSON.parse(value) as { content: unknown };

    // 0106 predates the layout-retune pass (0110), so its own JSON literal
    // still carries blueprint's ORIGINAL styleTokens — comparing the whole
    // object here would fail now that 0110 has retuned them. What 0106 is
    // actually the source of record for is `content.sectionLabels` (the
    // COREN fix); the previous test already proves the current
    // structure_schema's styleTokens agree with 0110. So this test narrows
    // to exactly the part 0106 owns.
    const currentContent = (blueprint!.structure_schema as { content: unknown }).content;
    expect(migratedSchema.content).toEqual(JSON.parse(JSON.stringify(currentContent)));
  });

  const migration0110Sql = readFileSync(MIGRATION_0110_PATH, "utf8");
  const premiumRows0110 = parsePremiumUpdates(migration0110Sql);
  const premiumBySlug0110 = new Map(premiumRows0110.map((r) => [r.slug, r]));

  it("parsed 18 rows out of migration 0110 (the free-tier cut)", () => {
    expect(premiumRows0110).toHaveLength(18);
    expect(premiumBySlug0110.size).toBe(18);
  });

  it("every slug's is_premium and unlock_cost_credits agree between RESUME_TEMPLATES and their source migration (0105, or 0110 where superseded)", () => {
    const mismatched: string[] = [];
    for (const t of RESUME_TEMPLATES) {
      if (IS_PREMIUM_OUT_OF_SCOPE_SLUGS.has(t.slug)) continue;

      if (IS_PREMIUM_SUPERSEDED_BY_LATER_MIGRATION.has(t.slug)) {
        const migrated = premiumBySlug0110.get(t.slug);
        if (!migrated) {
          mismatched.push(`${t.slug}: not found in migration 0110 at all`);
          continue;
        }
        if (migrated.isPremium !== t.is_premium || migrated.unlockCostCredits !== t.unlock_cost_credits) {
          mismatched.push(
            `${t.slug}: RESUME_TEMPLATES says is_premium=${t.is_premium}/unlock_cost_credits=${t.unlock_cost_credits}, migration 0110 says is_premium=${migrated.isPremium}/unlock_cost_credits=${migrated.unlockCostCredits}`,
          );
        }
        continue;
      }

      const migrated = migrationBySlug.get(t.slug);
      if (!migrated || migrated.isPremium === undefined || migrated.unlockCostCredits === undefined) {
        mismatched.push(`${t.slug}: no is_premium/unlock_cost_credits source found in migration 0105`);
        continue;
      }
      if (migrated.isPremium !== t.is_premium || migrated.unlockCostCredits !== t.unlock_cost_credits) {
        mismatched.push(
          `${t.slug}: RESUME_TEMPLATES says is_premium=${t.is_premium}/unlock_cost_credits=${t.unlock_cost_credits}, migration 0105 says is_premium=${migrated.isPremium}/unlock_cost_credits=${migrated.unlockCostCredits}`,
        );
      }
    }
    expect(mismatched, "is_premium/unlock_cost_credits has drifted between catalog.ts and its source migration").toEqual([]);
  });
});
