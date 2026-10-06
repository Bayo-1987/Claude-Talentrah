/**
 * The comparison behind the 0224/0225 rollback round trip (tests/supabase/migration-0224-0225-round-trip.test.ts), checked on made-up snapshots so it runs without a database.
 *
 * The database test takes three snapshots of the two tables' privileges, inside one transaction it then rolls back: AFTER the migrations (as the stack is built), AFTER the two rollbacks, and AFTER the
 * migrations applied again. This file pins what the comparison accepts and, as importantly, each way it must complain, so a comparison that can only ever say "fine" cannot pass.
 */
import { describe, expect, it } from "vitest";
import { compareRoundTrip, parseSnapshots, roundTripScript, snapshotSql, type SnapshotText } from "./privilege-round-trip";

const TABLES = ["alpha", "beta"] as const;

/** One column line: table, column, column-level ACL entries, and the effective privileges of anon and authenticated (S I U R, a dash where absent). */
const col = (table: string, name: string, acl: string, anon: string, auth: string) => `C|${table}|${name}|${acl}|anon=${anon};authenticated=${auth}`;

/** The state after the migrations: authenticated reads only the named columns, by column grant; anon reads nothing; authenticated may UPDATE col "a". */
const POST: string[] = [
  "T|alpha|authenticated:INSERT,authenticated:UPDATE",
  col("alpha", "a", "authenticated:SELECT,authenticated:UPDATE", "----", "S-U-"),
  col("alpha", "b", "authenticated:SELECT", "----", "S---"),
  col("alpha", "secret", "-", "----", "----"),
  "T|beta|authenticated:INSERT",
  col("beta", "x", "authenticated:SELECT", "----", "S---"),
  col("beta", "secret", "-", "----", "----"),
];

/** The state after the rollbacks: SELECT on the whole table for both roles, no column-level SELECT; every other privilege as it was. */
const ROLLED_BACK: string[] = [
  "T|alpha|anon:SELECT,authenticated:INSERT,authenticated:SELECT,authenticated:UPDATE",
  col("alpha", "a", "authenticated:UPDATE", "S---", "S-U-"),
  col("alpha", "b", "-", "S---", "S---"),
  col("alpha", "secret", "-", "S---", "S---"),
  "T|beta|anon:SELECT,authenticated:INSERT,authenticated:SELECT",
  col("beta", "x", "-", "S---", "S---"),
  col("beta", "secret", "-", "S---", "S---"),
];

const text = (post: string[], rolledBack: string[], postAgain: string[]): SnapshotText =>
  ["@@SNAP post", ...post, "@@SNAP rolledback", ...rolledBack, "@@SNAP postagain", ...postAgain].join("\n");

const problems = (post = POST, rolledBack = ROLLED_BACK, postAgain = POST) => compareRoundTrip(parseSnapshots(text(post, rolledBack, postAgain)), TABLES);
const swap = (lines: string[], from: string, to: string) => lines.map((l) => (l === from ? to : l));

describe("compareRoundTrip", () => {
  it("accepts a clean round trip", () => {
    expect(problems()).toEqual([]);
  });

  it("complains when the rollback changed nothing", () => {
    expect(problems(POST, POST, POST).join("\n")).toMatch(/rollback changed nothing/);
  });

  it("complains when the starting state is already the pre-migration shape, so the round trip proves nothing", () => {
    expect(problems(ROLLED_BACK, ROLLED_BACK, ROLLED_BACK).join("\n")).toMatch(/migrations were not applied/);
  });

  it("complains when a column is still unreadable to a role after the rollback", () => {
    const bad = swap(ROLLED_BACK, col("alpha", "secret", "-", "S---", "S---"), col("alpha", "secret", "-", "----", "S---"));
    expect(problems(POST, bad).join("\n")).toMatch(/alpha\.secret.*anon cannot read/);
  });

  it("complains when authenticated still cannot read a column after the rollback", () => {
    const bad = swap(ROLLED_BACK, col("beta", "x", "-", "S---", "S---"), col("beta", "x", "-", "S---", "----"));
    expect(problems(POST, bad).join("\n")).toMatch(/beta\.x.*authenticated cannot read/);
  });

  it("complains when re-applying the migrations leaves the table-level ACL different", () => {
    const bad = swap(POST, "T|beta|authenticated:INSERT", "T|beta|authenticated:INSERT,authenticated:SELECT");
    expect(problems(POST, ROLLED_BACK, bad).join("\n")).toMatch(/re-applying.*beta \(table\)/);
  });

  it("complains when a column-level SELECT grant survives the rollback", () => {
    const bad = swap(ROLLED_BACK, col("beta", "x", "-", "S---", "S---"), col("beta", "x", "authenticated:SELECT", "S---", "S---"));
    expect(problems(POST, bad).join("\n")).toMatch(/beta\.x.*column-level SELECT/);
  });

  it("complains when the rollback changed a privilege other than SELECT", () => {
    const bad = swap(ROLLED_BACK, col("alpha", "a", "authenticated:UPDATE", "S---", "S-U-"), col("alpha", "a", "-", "S---", "S---"));
    expect(problems(POST, bad).join("\n")).toMatch(/other than SELECT.*alpha\.a/);
  });

  it("complains when the table-level ACL lost or gained a non-SELECT privilege across the rollback", () => {
    const bad = swap(ROLLED_BACK, "T|beta|anon:SELECT,authenticated:INSERT,authenticated:SELECT", "T|beta|anon:SELECT,authenticated:SELECT");
    expect(problems(POST, bad).join("\n")).toMatch(/other than SELECT.*beta \(table\)/);
  });

  it("complains when applying the migrations again does not restore the original state", () => {
    const bad = swap(POST, col("alpha", "b", "authenticated:SELECT", "----", "S---"), col("alpha", "b", "-", "----", "----"));
    expect(problems(POST, ROLLED_BACK, bad).join("\n")).toMatch(/re-applying.*alpha\.b/);
  });

  it("complains when a snapshot is missing a table, a column, or a whole section", () => {
    expect(problems(POST.filter((l) => !l.startsWith("T|beta") && !l.startsWith("C|beta"))).join("\n")).toMatch(/beta/);
    expect(problems(POST, ROLLED_BACK.filter((l) => !l.startsWith("C|alpha|secret"))).join("\n")).toMatch(/alpha\.secret/);
    expect(() => parseSnapshots(["@@SNAP post", ...POST].join("\n"))).toThrow(/rolledback/);
  });
});

describe("parseSnapshots", () => {
  it("reads the three sections in any amount of surrounding noise (psql headers, blank lines)", () => {
    const s = parseSnapshots(["SET", "", text(POST, ROLLED_BACK, POST), "ROLLBACK"].join("\n"));
    expect(Object.keys(s.post).sort()).toEqual(["alpha", "beta"]);
    expect(s.post.alpha.columns.b.eff).toBe("anon=----;authenticated=S---");
  });

  it("refuses a line it does not understand rather than skipping it", () => {
    expect(() => parseSnapshots(text(["C|alpha|a|only-three-parts"], ROLLED_BACK, POST))).toThrow(/cannot read/);
  });
});

describe("snapshotSql and roundTripScript", () => {
  it("snapshotSql names every table and reads the ACLs the comparison needs", () => {
    const sql = snapshotSql(TABLES);
    expect(sql).toMatch(/'alpha'/);
    expect(sql).toMatch(/'beta'/);
    expect(sql).toMatch(/aclexplode\(c\.relacl\)/);
    expect(sql).toMatch(/aclexplode\(a\.attacl\)/);
    expect(sql).toMatch(/has_column_privilege\('anon'/);
    expect(sql).toMatch(/has_column_privilege\('authenticated'/);
  });

  it("the script is ONE transaction that ends in a rollback, applies the rollbacks before the migrations, and cannot leave anything behind", () => {
    const script = roundTripScript(TABLES, { rollbacks: ["-- RB1\nselect 1;", "-- RB2\nselect 2;"], migrations: ["-- M1\nselect 3;", "-- M2\nselect 4;"] });
    const code = script.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("--"));
    expect(code[0].trim()).toBe("begin;");
    expect(code[code.length - 1].trim()).toBe("rollback;");
    expect(script.indexOf("-- RB1")).toBeLessThan(script.indexOf("-- RB2"));
    expect(script.indexOf("-- RB2")).toBeLessThan(script.indexOf("-- M1"));
    expect(script.indexOf("-- M1")).toBeLessThan(script.indexOf("-- M2"));
    expect(script.indexOf("'@@SNAP post'")).toBeLessThan(script.indexOf("-- RB1"));
    expect(script.indexOf("'@@SNAP rolledback'")).toBeGreaterThan(script.indexOf("-- RB2"));
    expect(script.indexOf("'@@SNAP rolledback'")).toBeLessThan(script.indexOf("-- M1"));
    expect(script.indexOf("'@@SNAP postagain'")).toBeGreaterThan(script.indexOf("-- M2"));
    expect(code.filter((l) => /^\s*commit\s*;/i.test(l))).toEqual([]);
  });

  it("refuses a file that would end the transaction early", () => {
    expect(() => roundTripScript(TABLES, { rollbacks: ["select 1;\ncommit;"], migrations: [] })).toThrow(/transaction/);
    expect(() => roundTripScript(TABLES, { rollbacks: [], migrations: ["begin;\nselect 1;"] })).toThrow(/transaction/);
  });
});
