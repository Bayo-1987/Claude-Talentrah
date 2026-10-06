/**
 * The named column lists that replace `*` on the tables 0232 narrows are held to the generated types: each list is every column of its table EXCEPT the
 * withheld ones, and nothing else. A column added to the table later fails here until someone decides whether the pages should read it (and, with 0232's
 * explicit grants, until a migration grants it), instead of being silently picked up by a `*` or silently missed.
 *
 * Pure source scan, no database: it runs everywhere. The same ten column entries (nine distinct names: created_by is withheld on two tables) are withheld in the migration and in the grants fake
 * (tests/support/fake-grants-client.ts), which this file also pins.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WITHHELD } from "../support/fake-grants-client";
import { SCHOLARSHIP_READABLE_COLUMNS } from "@/lib/scholarships/columns";
import { ORGANIZATION_READABLE_COLUMNS } from "@/lib/employer/organization-columns";

const SRC = join(__dirname, "..", "..", "src");
const types = readFileSync(join(SRC, "lib/supabase/types.ts"), "utf8");

/** The column names of a table's Row in the generated types. */
function rowColumns(table: string): string[] {
  const m = new RegExp(`\\n      ${table}: \\{\\n        Row: \\{([\\s\\S]*?)\\n        \\}`).exec(types);
  if (!m) throw new Error(`no Row for ${table} in the generated types`);
  return [...m[1].matchAll(/\n          (\w+):/g)].map((x) => x[1]);
}
const list = (s: string) => s.split(",").map((c) => c.trim()).filter(Boolean);
const sorted = (a: string[]) => [...a].sort();

describe("the generated types still know the tables 0232 narrows", () => {
  it.each(Object.keys(WITHHELD))("%s has every withheld column in its Row", (table) => {
    const cols = rowColumns(table);
    expect(cols.length, `${table}'s Row was not read from the generated types`).toBeGreaterThan(5);
    for (const w of WITHHELD[table]) expect(cols, `${table}.${w} is not a column any more: update WITHHELD and the migration`).toContain(w);
  });
});

describe("a named list equals the table's columns minus the withheld ones", () => {
  it("scholarships: SCHOLARSHIP_READABLE_COLUMNS", () => {
    const expected = rowColumns("scholarships").filter((c) => !WITHHELD.scholarships.includes(c));
    expect(sorted(list(SCHOLARSHIP_READABLE_COLUMNS))).toEqual(sorted(expected));
    expect(new Set(list(SCHOLARSHIP_READABLE_COLUMNS)).size, "a column is listed twice").toBe(list(SCHOLARSHIP_READABLE_COLUMNS).length);
  });

  it("organizations: ORGANIZATION_READABLE_COLUMNS", () => {
    const expected = rowColumns("organizations").filter((c) => !WITHHELD.organizations.includes(c));
    expect(sorted(list(ORGANIZATION_READABLE_COLUMNS))).toEqual(sorted(expected));
    expect(new Set(list(ORGANIZATION_READABLE_COLUMNS)).size, "a column is listed twice").toBe(list(ORGANIZATION_READABLE_COLUMNS).length);
  });

  it("the organizations(...) embed in membership.ts is written out with exactly that list", () => {
    const source = readFileSync(join(SRC, "lib/employer/membership.ts"), "utf8");
    const m = /organizations\(([^)]*)\)"/.exec(source.replace(/\s+/g, " "));
    expect(m, "membership.ts has no organizations(...) embed with a literal list").not.toBeNull();
    expect(sorted(list(m![1]))).toEqual(sorted(list(ORGANIZATION_READABLE_COLUMNS)));
  });

  it("a withheld column is in no list", () => {
    for (const w of WITHHELD.scholarships) expect(list(SCHOLARSHIP_READABLE_COLUMNS)).not.toContain(w);
    for (const w of WITHHELD.organizations) expect(list(ORGANIZATION_READABLE_COLUMNS)).not.toContain(w);
  });
});

describe("the lists the public pages already used stay inside what is readable", () => {
  it("PUBLIC_COLUMNS (scholarship detail) and LANDING_PREVIEW_COLUMNS name no withheld column", () => {
    const publicSrc = readFileSync(join(SRC, "lib/scholarships/public.ts"), "utf8");
    const landing = readFileSync(join(SRC, "lib/seo/landing-page-data.ts"), "utf8");
    const publicList = /export const PUBLIC_COLUMNS =\s*"([^"]+)"/.exec(publicSrc)![1];
    const previewList = /const LANDING_PREVIEW_COLUMNS =\s*"([^"]+)"/.exec(landing)![1];
    for (const l of [publicList, previewList]) {
      for (const w of WITHHELD.scholarships) expect(list(l), `${w} is in a public list`).not.toContain(w);
      for (const c of list(l)) expect(rowColumns("scholarships"), `${c} is not a scholarships column`).toContain(c);
    }
  });

  it("the blog's public reads name only readable columns of blog_posts", () => {
    const source = readFileSync(join(SRC, "lib/blog/posts.ts"), "utf8");
    const lists = [...source.matchAll(/\.from\("blog_posts"\)\s*\.select\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(lists.length, "no blog_posts read found in src/lib/blog/posts.ts").toBeGreaterThanOrEqual(2);
    for (const l of lists) for (const w of WITHHELD.blog_posts) expect(list(l)).not.toContain(w);
  });
});
