/**
 * 0232 round trip, against the real catalogue: take the privileges of organizations, scholarships, blog_posts and mentorship_reviews, the helper function and the organization_members insert rule as the local stack
 * has them (every migration applied), run the rollback file, take them again, apply the migration file again, take them a third time, and compare. The privilege comparison is
 * tests/support/privilege-round-trip.ts (the same one the 0224/0225 round trip uses: the rollback undoes ONLY SELECT, afterwards both roles can read every column with no column-level SELECT grant left, and applying the
 * migration again restores the original exactly). This file adds what 0232 changes besides privileges: the function is absent after the rollback and present again afterwards, and the insert rule is back to its previous
 * text (the subquery on organizations.created_by) after the rollback and in the migrated shape (the helper function, no created_by) before and after. All of it runs inside ONE transaction that always ends in a rollback,
 * so the database is the same afterwards whatever the run found.
 *
 * CI only, for the reasons the 0224/0225 round trip gives: it needs the local stack's Postgres (a container this machine started; no password, no URL, no hosted project involved), and WITH CI=true anything that stops
 * the run FAILS the test, because a round trip that quietly did not run would look exactly like one that passed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareRoundTrip, parseSnapshots } from "../support/privilege-round-trip";
import { MIGRATION, ROLLBACK, TABLES, objectLines, script } from "../support/migration-0232-round-trip";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function dbContainer(): string {
  const names = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" })
    .split("\n")
    .map((n) => n.trim())
    .filter((n) => /^supabase_db_/.test(n));
  if (names.length !== 1) throw new Error(`expected exactly one running supabase_db_* container (the local stack's Postgres), found ${names.length}: ${names.join(", ") || "none"}`);
  return names[0];
}

function runScript(script: string): string {
  return execFileSync("docker", ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"], {
    input: script,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
  });
}

describe.skipIf(process.env.CI !== "true")("0232: rollback and re-apply on the local stack (CI only)", () => {
  it("the files it runs are the ones on disk", () => {
    expect(MIGRATION.split("/").pop()!.slice(0, 4)).toBe("0232");
    expect(ROLLBACK.split("/").pop()!.slice(0, 4)).toBe("0232");
    expect(read(MIGRATION)).toContain("is_organization_creator");
    expect(read(ROLLBACK)).toContain("drop function public.is_organization_creator(uuid)");
  });

  it("the rollback undoes exactly the SELECT narrowing, and the migration restores it exactly", () => {
    const output = runScript(script([read(ROLLBACK)], [read(MIGRATION)]));
    expect(compareRoundTrip(parseSnapshots(output), TABLES)).toEqual([]);
  }, 180_000);

  it("the helper function and the insert rule: migrated before, previous form after the rollback, migrated again after the migration", () => {
    const lines = objectLines(runScript(script([read(ROLLBACK)], [read(MIGRATION)])));
    expect(lines.post, "the starting state is not the migrated one, so the round trip proves nothing").toBe("O|function|true|policy|helper");
    expect(lines.rolledback).toBe("O|function|false|policy|subquery");
    expect(lines.postagain).toBe("O|function|true|policy|helper");
  }, 180_000);

  it("leaves nothing behind: the privileges are the same after the run as before it", () => {
    const before = parseSnapshots(runScript(script([], [])));
    runScript(script([read(ROLLBACK)], [read(MIGRATION)]));
    const after = parseSnapshots(runScript(script([], [])));
    expect(after.post).toEqual(before.post);
  }, 180_000);
});
