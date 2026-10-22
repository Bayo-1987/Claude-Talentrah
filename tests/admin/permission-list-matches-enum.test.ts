import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requireN1Db, runN1Sql } from "../supabase/migration-0265-local-db";

/**
 * The TypeScript permission list (`AdminPermission` in src/lib/admin/session.ts) must equal the values of the database enum. A permission the type does not name is
 * typed `never` for no one and is easy to miss in a switch or a role editor; the generated types (enum and constants) must carry it too. Three views are compared
 * with the live enum: the union in session.ts, the generated enum union, and the generated constants list. Nothing else grants anything here.
 */
const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const sessionList = (): string[] => {
  const src = read("src/lib/admin/session.ts");
  const start = src.indexOf("export type AdminPermission =");
  const end = src.indexOf("export interface AdminIdentity", start);
  return [...src.slice(start, end).matchAll(/\|\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
};
const generatedEnum = (): string[] => {
  const src = read("src/lib/supabase/types.ts");
  const start = src.indexOf("      admin_permission:\n");
  const block = src.slice(start, src.indexOf("\n      applicant_review_status:", start));
  return [...block.matchAll(/\|\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
};
const generatedConstants = (): string[] => {
  const src = read("src/lib/supabase/types.ts");
  const start = src.indexOf("      admin_permission: [");
  const end = src.indexOf("],", start);
  return [...src.slice(start, end).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
};
const databaseEnum = (): string[] => {
  requireN1Db();
  const r = runN1Sql("select e.enumlabel::text from pg_catalog.pg_enum e where e.enumtypid = 'public.admin_permission'::regtype order by 1;");
  if (!r.ok) throw new Error(r.stderr);
  return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean).sort();
};

describe("the permission list in TypeScript equals the database enum", () => {
  it("the live enum is read (control: it holds the label from 0264)", () => {
    expect(databaseEnum()).toContain("user_messaging");
  });
  it("the AdminPermission union in session.ts equals the enum", () => expect(sessionList()).toEqual(databaseEnum()));
  it("the generated enum union equals the enum", () => expect(generatedEnum()).toEqual(databaseEnum()));
  it("the generated constants list equals the enum", () => expect(generatedConstants()).toEqual(databaseEnum()));
});
