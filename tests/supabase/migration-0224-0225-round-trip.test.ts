/**
 * 0224 and 0225 round trip, against the real catalogue: take the privileges of mentorship_sessions and mentor_profiles as the local stack has them (every migration applied), run the two rollback
 * files, take them again, apply the two migration files again, take them a third time, and compare (tests/support/privilege-round-trip.ts says what is compared and why that needs no stored copy of
 * the old ACLs). All of it runs inside ONE transaction that always ends in a rollback, so the database is the same afterwards whatever the run found.
 *
 * CI only. It needs the local stack's Postgres, which the CI jobs start (.github/actions/local-supabase) and a developer's machine usually does not have, and it is the one place the rollback files are
 * executed rather than read. Without CI=true the file's tests are skipped and say so; WITH it, anything that stops the run (no Docker, no stack, a script error) FAILS the test, because a round trip that
 * quietly did not run would look exactly like one that passed.
 *
 * How it reaches the database: the CLI names the stack's Postgres container supabase_db_<project>; the script goes in on stdin of `psql` run inside it. No password, no URL, no hosted project involved:
 * the only database this can reach is a container on this machine.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareRoundTrip, parseSnapshots, roundTripScript } from "../support/privilege-round-trip";
import { runRoundTripScript as runScript } from "../support/psql-lock-retry";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const TABLES = ["mentorship_sessions", "mentor_profiles"] as const;
const MIGRATIONS = ["supabase/migrations/0224_mentorship_sessions_column_grants.sql", "supabase/migrations/0225_mentor_profiles_column_grants.sql"];
const ROLLBACKS = ["supabase/rollbacks/0224_mentorship_sessions_column_grants.rollback.sql", "supabase/rollbacks/0225_mentor_profiles_column_grants.rollback.sql"];

describe.skipIf(process.env.CI !== "true")("0224 and 0225: rollback and re-apply on the local stack (CI only)", () => {
  it("the files it runs are the ones on disk, in the order the numbers say", () => {
    expect(MIGRATIONS.map((m) => m.split("/").pop()!.slice(0, 4))).toEqual(["0224", "0225"]);
    expect(ROLLBACKS.map((m) => m.split("/").pop()!.slice(0, 4))).toEqual(["0224", "0225"]);
  });

  it("the rollbacks undo exactly the SELECT narrowing, and the migrations restore it exactly", () => {
    const script = roundTripScript(TABLES, { rollbacks: ROLLBACKS.map(read), migrations: MIGRATIONS.map(read) });
    const output = runScript(script);
    const problems = compareRoundTrip(parseSnapshots(output), TABLES);
    expect(problems).toEqual([]);
  }, 180_000);

  it("leaves nothing behind: the privileges are the same after the run as before it", () => {
    const before = parseSnapshots(runScript(roundTripScript(TABLES, { rollbacks: [], migrations: [] })));
    // With no files the three snapshots are of the same untouched state; a run that changed anything would show in the next one.
    runScript(roundTripScript(TABLES, { rollbacks: ROLLBACKS.map(read), migrations: MIGRATIONS.map(read) }));
    const after = parseSnapshots(runScript(roundTripScript(TABLES, { rollbacks: [], migrations: [] })));
    expect(after.post).toEqual(before.post);
  }, 180_000);
});
