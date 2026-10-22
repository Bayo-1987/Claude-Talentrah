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
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertLocalGuard, haveN1Db, localServiceSet } from "./migration-0265-local-db";

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

  it("CI is true: the shared rules still hold, a hosted-looking host is refused", () => {
    expect(refused("https://abcdefgh.supabase.co", { CI: "true" })).toBe(true);
    expect(refused("http://127.0.0.1.evil.example:54321", { CI: "true" })).toBe(true);
    expect(refused(undefined, { CI: "true" })).toBe(true);
  });
});

describe("a database-backed test must not skip silently", () => {
  it("when LOCAL_DB_CONTAINER is set the local database is reachable (a skip would look like a pass)", () => {
    if (process.env.LOCAL_DB_CONTAINER) expect(haveN1Db()).toBe(true);
    else expect(process.env.LOCAL_DB_CONTAINER).toBeUndefined();
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
