/**
 * `supabase/rollbacks/` holds the exact undo for a migration, beside the migration it undoes but OUTSIDE `supabase/migrations/`, and nothing that reads
 * migrations may ever see it.
 *
 * Why it matters: a rollback file shares its migration's number (`0212_….rollback.sql`). Anything that listed it as a migration would (a) report a
 * number collision with its own migration, (b) have `supabase db reset` / CI apply the undo straight after the migration it undoes, and (c) have the drift
 * audit look for a ledger row that will never exist. This pins that none of the three can happen: each consumer reads only `supabase/migrations`, the CLI is
 * not told of any other path, and a rollback is rejected from that directory.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { committedMigrations } from "../../scripts/audit-migrations";
import { findCollisions } from "../../scripts/migration-number-collisions";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const rollbacks = existsSync(join(ROOT, "supabase/rollbacks")) ? readdirSync(join(ROOT, "supabase/rollbacks")).filter((f) => f.endsWith(".sql")) : [];

describe("supabase/rollbacks is invisible to everything that reads migrations", () => {
  it("there is at least one rollback to protect (the test is not vacuous)", () => {
    expect(rollbacks).toContain("0212_account_deletion_request.rollback.sql");
  });

  it("no rollback file sits inside supabase/migrations", () => {
    const inMigrations = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => /rollback/i.test(f));
    expect(inMigrations).toEqual([]);
  });

  it("every rollback is named <number>_<name>.rollback.sql and undoes a migration that exists", () => {
    const migrations = readdirSync(join(ROOT, "supabase/migrations"));
    for (const f of rollbacks) {
      const m = /^(\d{4})_(.+)\.rollback\.sql$/.exec(f);
      expect(m, `${f} must be named <number>_<name>.rollback.sql`).not.toBeNull();
      expect(migrations, `${f} undoes a migration that must exist`).toContain(`${m![1]}_${m![2]}.sql`);
    }
  });

  it("the drift audit's list of committed migrations contains no rollback", () => {
    const names = committedMigrations();
    expect(names.length).toBeGreaterThan(100);
    expect(names.filter((n) => /rollback/i.test(n))).toEqual([]);
  });

  it("the numbering check reads only supabase/migrations", () => {
    const script = read("scripts/check-migration-collisions.ts");
    expect(script).toMatch(/const MIGRATIONS_DIR = "supabase\/migrations";/);
    expect(script).not.toMatch(/rollbacks/);
  });

  it("the Supabase CLI is pointed at no other path: the default migrations directory and no schema paths", () => {
    const config = read("supabase/config.toml");
    expect(config).toMatch(/schema_paths = \[\]/);
    expect(config).not.toMatch(/rollbacks/);
  });

  it("no workflow or CI action reaches into supabase/rollbacks", () => {
    for (const f of [".github/workflows/ci.yml", ".github/workflows/migration-drift.yml", ".github/actions/local-supabase/action.yml"]) {
      expect(read(f), f).not.toMatch(/supabase\/rollbacks/);
    }
  });

  it("the reason it must stay out: were a rollback listed as a migration it WOULD collide with its own migration", () => {
    const hits = findCollisions(["supabase/migrations/0212_account_deletion_request.rollback.sql"], ["supabase/migrations/0212_account_deletion_request.sql"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].number).toBe("0212");
  });
});
