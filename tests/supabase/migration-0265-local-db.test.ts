/**
 * The local-database guard for the N1 database tests (rows 57 to 61 of the red-first list, and amendment N1-R26a).
 *
 * The shared helper tests/support/local-psql.ts already refuses a host that is not 127.0.0.1 or localhost and a container that is not the stack at NEXT_PUBLIC_SUPABASE_URL. It has no port
 * range, and it must not get one (other sessions' stacks sit on 54321). So the N1 tests go through the wrapper in ./migration-0265-local-db.ts, which adds the rule that, on a developer
 * machine, the stack is one of ports 55421 to 55429. When the environment variable CI is exactly "true" the range is NOT applied: CI's own stack is on 54321 and the shared helper's rules
 * alone apply.
 *
 *   57   the range: accepted inside it, refused outside it (55420, 55430, 54321, no port); both hosts
 *   58   hosted-looking hosts, lookalikes, user info, other schemes, other loopback forms and unparseable values are refused
 *   59   the host is compared as a parsed hostname, never by substring
 *   R26a the range applies when CI is not "true" and only then (both modes tested)
 *   60   .env.local is ignored by git (and the checker can say "not ignored" in a repository that does not ignore it)
 *   61   the service set of the stack is read from docker, named, and labelled reduced or full
 *   scratch  the private databases the replay tests run in: only n1_replay_<pid>_* names are accepted, and a leftover of a dead process is swept (a live one is not)
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  LocalGuardError, assertLocalGuard, createN1Scratch, dropN1Scratch, haveN1Db, listN1Scratch, localServiceSet, newScratchName, removeAuditRowsAsOwner, requireN1Db, runN1ScratchSql, sweepStaleN1Scratch,
} from "./migration-0265-local-db";

const ROOT = join(__dirname, "../..");
const refused = (url: string | undefined, env: { CI?: string } = {}) => {
  try {
    assertLocalGuard(url, env);
    return false;
  } catch {
    return true;
  }
};

describe("row 57: the port range 55421 to 55429 (CI not true)", () => {
  it.each(["http://127.0.0.1:55421", "http://127.0.0.1:55425", "http://127.0.0.1:55429", "http://localhost:55421", "http://localhost:55429"])("accepts %s", (url) => {
    expect(refused(url)).toBe(false);
  });

  it.each(["http://127.0.0.1:55420", "http://127.0.0.1:55430", "http://127.0.0.1:54321", "http://localhost:54321", "http://127.0.0.1:5432", "http://127.0.0.1", "http://localhost"])(
    "refuses %s",
    (url) => {
      expect(refused(url)).toBe(true);
    },
  );
});

describe("row 58: hosts that are not a local stack are refused", () => {
  it.each([
    "https://abcdefgh.supabase.co",
    "https://abcdefgh.supabase.co:55421",
    "http://abcdefgh.supabase.co:55421",
    "http://127.0.0.1.evil.example:55421",
    "http://localhost.evil.example:55421",
    "http://evil.example/127.0.0.1:55421",
    "http://127.0.0.1@evil.example:55421",
    "http://user:secret@127.0.0.1:55421",
    "https://127.0.0.1:55421",
    "http://[::1]:55421",
    "http://0.0.0.0:55421",
    "http://127.0.0.2:55421",
    "ftp://127.0.0.1:55421",
  ])("refuses %s", (url) => {
    expect(refused(url)).toBe(true);
  });

  it.each([undefined, "", "not a url", "127.0.0.1:55421", "//127.0.0.1:55421"])("refuses an unusable value (%s)", (url) => {
    expect(refused(url)).toBe(true);
  });
});

describe("row 59: the hostname is compared exactly, not by substring", () => {
  it("a lookalike that merely contains the loopback address is refused, the address itself is not", () => {
    expect(refused("http://127.0.0.1:55421")).toBe(false);
    expect(refused("http://x127.0.0.1:55421")).toBe(true);
    expect(refused("http://127.0.0.1.nip.example:55421")).toBe(true);
    expect(refused("http://notlocalhost:55421")).toBe(true);
    expect(refused("http://localhost.:55421")).toBe(true);
  });
});

describe("N1-R26a: the range applies when CI is not exactly the string true, and only then", () => {
  it("CI unset, \"false\", \"1\", \"TRUE\" and empty: port 54321 is refused", () => {
    for (const ci of [undefined, "false", "1", "TRUE", ""]) {
      expect(refused("http://127.0.0.1:54321", ci === undefined ? {} : { CI: ci }), `CI=${String(ci)}`).toBe(true);
    }
  });

  it("CI is true: port 54321 (CI's stack) is accepted, and so is a port in the range", () => {
    expect(refused("http://127.0.0.1:54321", { CI: "true" })).toBe(false);
    expect(refused("http://127.0.0.1:55421", { CI: "true" })).toBe(false);
  });

  it("CI is true: a URL with no explicit port is still refused (the range is lifted, the port requirement is not)", () => {
    for (const url of ["http://127.0.0.1", "http://localhost", "http://127.0.0.1/"]) expect(refused(url, { CI: "true" }), url).toBe(true);
  });

  it("CI is true: the shared rules still hold, a hosted-looking host is refused", () => {
    expect(refused("https://abcdefgh.supabase.co", { CI: "true" })).toBe(true);
    expect(refused("http://127.0.0.1.evil.example:54321", { CI: "true" })).toBe(true);
    expect(refused(undefined, { CI: "true" })).toBe(true);
  });
});

describe("N1-R27 Q9: a database-backed test FAILS when the database is unusable, it never skips", () => {
  it("requireN1Db throws a clear error when the database is not usable, and returns when it is", () => {
    expect(() => requireN1Db(() => false)).toThrow(/FAILS rather than skipping/);
    expect(() => requireN1Db(() => true)).not.toThrow();
  });

  it("the database is usable here (this test is unconditional: with no usable database it fails)", () => {
    expect(haveN1Db(), "no usable local database: start the scratch stack and set NEXT_PUBLIC_SUPABASE_URL and LOCAL_DB_CONTAINER").toBe(true);
  });

  // Built from fragments so this file does not match its own scan.
  const SKIP = new RegExp(["\\b(?:describe|it|test)\\.(?:skip", "If|skip|runIf|todo)\\b|\\b(?:x", "describe|x", "it)\\b|\\.skip\\("].join(""));
  const FILES = readdirSync(__dirname).filter((f) => /^migration-026[45]-.*\.ts$/.test(f));

  it("the scan can say yes (control): it flags each skip construct", () => {
    const samples = [["describe", ".skip", "If(!x)(1)"], ["it", ".skip", "(1)"], ["test", ".run", "If(x)(1)"], ["x", "it", "(1)"], ["foo", ".skip", "(1)"]].map((parts) => parts.join(""));
    for (const bad of samples) {
      expect(SKIP.test(bad), bad).toBe(true);
    }
    for (const good of ['describe("a", () => {})', "it.each([1])(...)", "// we never skip"]) expect(SKIP.test(good), good).toBe(false);
  });

  it("no N1 database test file contains a skip construct", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(6);
    const hits = FILES.filter((f) => SKIP.test(readFileSync(join(__dirname, f), "utf8")));
    expect(hits).toEqual([]);
  });

  it("the replay and applied runners fail (throw) with no usable database instead of returning an empty result", () => {
    const src = readFileSync(join(__dirname, "migration-0265-support.ts"), "utf8");
    expect(src).not.toMatch(/return NO_DB/);
    expect((src.match(/requireN1Db\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});


describe("row 60: .env.local is ignored by git", () => {
  const ignored = (cwd: string) => {
    try {
      execFileSync("git", ["check-ignore", "-q", ".env.local"], { cwd, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };

  it("in this repository", () => {
    expect(ignored(ROOT)).toBe(true);
  });

  it("the check can say no: a repository with an empty ignore file does not ignore it (control)", () => {
    const dir = mkdtempSync(join(tmpdir(), "n1-ignore-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      writeFileSync(join(dir, ".gitignore"), "");
      expect(ignored(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("row 61: the service set is named, read from docker", () => {
  const names = (project: string, services: string[]) => services.map((s) => `supabase_${s}_${project}`);

  it("a stack with the five development services is labelled reduced and lists exactly them", () => {
    const set = localServiceSet(() => names("p1", ["db", "kong", "auth", "rest", "storage"]), "supabase_db_p1");
    expect(set.project).toBe("p1");
    expect(set.services).toEqual(["auth", "db", "kong", "rest", "storage"]);
    expect(set.label).toBe("reduced");
  });

  it("a stack that also runs realtime, pg_meta and inbucket is labelled full", () => {
    const set = localServiceSet(() => names("p2", ["db", "kong", "auth", "rest", "storage", "realtime", "pg_meta", "inbucket"]), "supabase_db_p2");
    expect(set.label).toBe("full");
    expect(set.services).toContain("realtime");
  });

  it("another project's containers are not counted", () => {
    const set = localServiceSet(() => [...names("mine", ["db", "kong"]), ...names("other", ["auth", "rest", "storage", "realtime"])], "supabase_db_mine");
    expect(set.services).toEqual(["db", "kong"]);
  });

  it("on the real stack the set is read from docker and contains the five services every test needs", () => {
    if (!process.env.LOCAL_DB_CONTAINER) return;
    const set = localServiceSet();
    for (const s of ["db", "kong", "auth", "rest", "storage"]) expect(set.services, s).toContain(s);
    expect(["reduced", "full"]).toContain(set.label);
  });
});

describe("scratch databases: the names the helpers will touch", () => {
  it("a fresh name matches n1_replay_<pid>_<suffix> and carries the process id", () => {
    const name = newScratchName(4242);
    expect(name).toMatch(/^n1_replay_4242_[a-z0-9]+$/);
    expect(newScratchName(4242)).not.toBe(name);
  });

  it.each(["postgres", "template1", "template0", "", "n1_replay_", "n1_replay_x_abc", "n1_replay_12_ABC", 'n1_replay_12_a"; drop database postgres; --', "n1_replay_12_a b", "other_n1_replay_12_abc"])(
    "refuses %j (nothing but a scratch name is created, run against or dropped)",
    (name) => {
      expect(() => dropN1Scratch(name)).toThrow(/not an N1 scratch database name/);
      expect(() => createN1Scratch(name, "select 1;")).toThrow(/not an N1 scratch database name/);
      expect(() => runN1ScratchSql(name, "select 1;")).toThrow(/not an N1 scratch database name/);
    },
  );
});

describe("scratch databases: creation, sweep and removal on the local stack", () => {
  // Two REAL, live processes stand for the "dead" and the "alive" owner. Other test files sweep with the real liveness check at the same time (whole-suite runs); fake pids looked dead to them, so
  // they could remove a fixture mid-test (an intermittent failure seen once under load). With live pids the other sweeps leave both alone; only THIS test's predicate calls the first one dead.
  const sleepers = [spawn("sleep", ["60"]), spawn("sleep", ["60"])];
  const deadPid = sleepers[0].pid!;
  const dead = newScratchName(deadPid);
  const alive = newScratchName(sleepers[1].pid!);
  afterAll(() => sleepers.forEach((c) => c.kill()));

  it("the sweep removes the scratch database of a dead process and leaves one whose process is alive", () => {
    createN1Scratch(dead, "create table t (id int);");
    createN1Scratch(alive, "create table t (id int);");
    try {
      expect(listN1Scratch()).toEqual(expect.arrayContaining([dead, alive]));
      // only the fake pid of the "dead" fixture counts as dead: another test file in the same run owns a live scratch database, and it must not be touched
      const removed = sweepStaleN1Scratch((pid) => pid !== deadPid);
      expect(removed).toContain(dead);
      expect(removed).not.toContain(alive);
      const left = listN1Scratch();
      expect(left).not.toContain(dead);
      expect(left).toContain(alive);
    } finally {
      dropN1Scratch(dead);
      dropN1Scratch(alive);
    }
    expect(listN1Scratch()).not.toContain(alive);
  });

  it("a script runs in the scratch database it was given, and a failing script reports its SQLSTATE", () => {
    const name = newScratchName(2_000_000_003);
    createN1Scratch(name, "create table t (id int);");
    try {
      const ok = runN1ScratchSql(name, "select current_database();");
      expect(ok.ok).toBe(true);
      expect(ok.stdout.trim()).toBe(name);
      const bad = runN1ScratchSql(name, "select * from table_that_does_not_exist;");
      expect(bad.ok).toBe(false);
      expect(bad.stderr).toMatch(/42P01/);
    } finally {
      dropN1Scratch(name);
    }
  });

  it("dropping a name that is not there is not an error", () => {
    expect(() => dropN1Scratch(newScratchName(2_000_000_004))).not.toThrow();
  });
});

describe("removeAuditRowsAsOwner: the one place that switches triggers off to delete append-only rows", () => {
  const ID = "00000000-0000-4000-8000-0000000000c1";
  const calls: string[] = [];
  const spy = (script: string) => {
    calls.push(script);
    return { ok: true, stdout: "", stderr: "" };
  };
  it.each([
    ["a hosted address", "https://abcdefgh.supabase.co"],
    ["a private network address", "http://10.0.0.5:55421"],
    ["a lookalike host", "http://127.0.0.1.evil.example:55421"],
    ["localhost with user info", "http://user:pw@localhost:55421"],
    ["an empty address", ""],
  ])("refuses %s and runs nothing", (_n, url) => {
    calls.length = 0;
    expect(() => removeAuditRowsAsOwner([ID], url, spy)).toThrow(LocalGuardError);
    expect(calls).toEqual([]);
  });
  it.each(["http://127.0.0.1:55421", "http://localhost:55421"])("runs against %s, with triggers off for that one session only, and only for the ids given", (url) => {
    calls.length = 0;
    removeAuditRowsAsOwner([ID], url, spy);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^set session_replication_role = replica;/);
    expect(calls[0]).toContain(`'${ID}'`);
    expect(calls[0]).not.toMatch(/truncate/i);
  });
  it("refuses an id that is not a uuid, and an empty list does nothing", () => {
    calls.length = 0;
    expect(() => removeAuditRowsAsOwner(["x'; drop table t; --"], "http://127.0.0.1:55421", spy)).toThrow(/uuid/);
    removeAuditRowsAsOwner([], "http://127.0.0.1:55421", spy);
    expect(calls).toEqual([]);
  });
});
