/**
 * The columns 0232 withholds from signed-out visitors and signed-in users are written in THREE places, and a list that drifts from the others is a test that
 * checks the wrong thing:
 *   - tests/support/fake-grants-client.ts `WITHHELD`: what the call-site tests simulate the new grants as refusing;
 *   - tests/support/identifier-column-guard-titles.ts `WITHHELD_IDENTIFIER_COLUMNS`: what the database guard (tests/rls/identifier-column-grants.test.ts) holds the real grants to;
 *   - supabase/migrations/0232_public_identifier_column_grants.sql: what the migration actually withholds (the list its own self-check enforces).
 * This file pins all three to each other: the same tables, and for each table the same set of columns. ORDER does not matter (they are sets), but a column
 * added, dropped or moved to another table in any one place fails here, naming the table and the column.
 *
 * Pure source reads, no database: it runs everywhere.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WITHHELD } from "../support/fake-grants-client";
import { WITHHELD_IDENTIFIER_COLUMNS } from "../support/identifier-column-guard-titles";

const MIGRATION = readFileSync(join(__dirname, "..", "..", "supabase/migrations/0232_public_identifier_column_grants.sql"), "utf8");

/** The `('table', array['a', 'b'])` pairs of the migration's self-check: the withheld columns the migration enforces. */
export function migrationWithheld(sql: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of sql.matchAll(/\(\s*'([a-z_]+)'\s*,\s*array\[([^\]]*)\]\s*\)/g)) {
    out[m[1]] = [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  }
  return out;
}

const asSets = (o: Record<string, readonly string[]>) => Object.fromEntries(Object.entries(o).map(([t, c]) => [t, [...new Set(c)].sort()]));

/** Every disagreement between two lists, as sentences; empty means they agree. */
export function disagreements(nameA: string, a: Record<string, readonly string[]>, nameB: string, b: Record<string, readonly string[]>): string[] {
  const out: string[] = [];
  const A = asSets(a);
  const B = asSets(b);
  for (const t of new Set([...Object.keys(A), ...Object.keys(B)])) {
    if (!A[t]) out.push(`${nameB} withholds columns of ${t}, ${nameA} has no such table`);
    else if (!B[t]) out.push(`${nameA} withholds columns of ${t}, ${nameB} has no such table`);
    else {
      for (const c of A[t]) if (!B[t].includes(c)) out.push(`${t}.${c} is withheld in ${nameA} but not in ${nameB}`);
      for (const c of B[t]) if (!A[t].includes(c)) out.push(`${t}.${c} is withheld in ${nameB} but not in ${nameA}`);
    }
  }
  return out;
}

describe("the three lists of withheld columns agree", () => {
  const sql = migrationWithheld(MIGRATION);

  it("finds the lists it is supposed to compare (the check is not empty): four tables, ten columns (nine distinct names), in each", () => {
    for (const list of [WITHHELD, WITHHELD_IDENTIFIER_COLUMNS, sql]) {
      expect(Object.keys(list).sort()).toEqual(["blog_posts", "mentorship_reviews", "organizations", "scholarships"]);
      expect(Object.values(list).flat()).toHaveLength(10);
    }
  });

  it("the simulated grants (fake-grants-client) and the database guard withhold the same columns", () => {
    expect(disagreements("fake-grants-client WITHHELD", WITHHELD, "identifier-column-guard-titles WITHHELD_IDENTIFIER_COLUMNS", WITHHELD_IDENTIFIER_COLUMNS)).toEqual([]);
  });

  it("the migration withholds the same columns as the simulated grants", () => {
    expect(disagreements("fake-grants-client WITHHELD", WITHHELD, "the 0232 migration's self-check", sql)).toEqual([]);
  });

  it("the migration withholds the same columns as the database guard", () => {
    expect(disagreements("identifier-column-guard-titles WITHHELD_IDENTIFIER_COLUMNS", WITHHELD_IDENTIFIER_COLUMNS, "the 0232 migration's self-check", sql)).toEqual([]);
  });

  it("the comparison itself catches each way two lists can differ, and ignores order (checked on made-up lists, not on the repo)", () => {
    const base = { a: ["x", "y"], b: ["z"] };
    expect(disagreements("A", base, "B", { a: ["y", "x"], b: ["z"] }), "reordering is not a difference").toEqual([]);
    expect(disagreements("A", base, "B", { a: ["x"], b: ["z"] })).toEqual(["a.y is withheld in A but not in B"]);
    expect(disagreements("A", base, "B", { a: ["x", "y", "w"], b: ["z"] })).toEqual(["a.w is withheld in B but not in A"]);
    expect(disagreements("A", base, "B", { a: ["x", "y"], b: ["y"] }).sort()).toEqual(["b.y is withheld in B but not in A", "b.z is withheld in A but not in B"]);
    expect(disagreements("A", base, "B", { a: ["x", "y"] })).toEqual(["A withholds columns of b, B has no such table"]);
    expect(disagreements("A", base, "B", { ...base, c: ["q"] })).toEqual(["B withholds columns of c, A has no such table"]);
  });

  it("reads the migration's lists in the form the self-check writes them (a reformatted migration that hides them fails here, not silently)", () => {
    expect(migrationWithheld("('t', array['a', 'b']), ('u', array['c'])")).toEqual({ t: ["a", "b"], u: ["c"] });
    expect(migrationWithheld("nothing like a list")).toEqual({});
  });
});
