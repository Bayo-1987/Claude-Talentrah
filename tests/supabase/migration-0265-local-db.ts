/**
 * The guarded entry to the local database for the N1 tests (migrations 0264 and 0265).
 *
 * WHY A WRAPPER AND NOT A CHANGE TO tests/support/local-psql.ts. That shared helper already refuses a host that is not 127.0.0.1 or localhost, and refuses a container that is not the stack at
 * NEXT_PUBLIC_SUPABASE_URL. It has no port range, and giving it one would break every other session, whose stacks sit on 54321. The N1 tests are written on a machine that runs other
 * sessions' stacks, so they take one more rule: the stack is one of ports 55421 to 55429.
 *
 * N1-R26a: the range applies ONLY when the environment variable CI is not exactly "true". CI's own stack is on 54321, and there the shared helper's rules alone apply.
 *
 * Nothing here prints a key, a password or a connection string.
 */
import { execFileSync } from "node:child_process";
import { haveLocalDb, localDbContainer, runSql, type SqlResult } from "../support/local-psql";

export const N1_PORT_MIN = 55421;
export const N1_PORT_MAX = 55429;
const LOOPBACK = new Set(["127.0.0.1", "localhost"]);

export class LocalGuardError extends Error {
  constructor(reason: string) {
    super(`N1 local database guard: ${reason}`);
    this.name = "LocalGuardError";
  }
}

/**
 * Refuses unless `url` is the address of a local stack: plain http, no user info, host exactly 127.0.0.1 or localhost, an explicit port and, unless CI is "true", a port in
 * 55421 to 55429. Returns the parsed host and port.
 */
export function assertLocalGuard(url: string | undefined, env: Readonly<Record<string, string | undefined>> = process.env): { host: string; port: number } {
  let parsed: URL;
  try {
    parsed = new URL(url ?? "");
  } catch {
    throw new LocalGuardError("the Supabase URL is missing or cannot be parsed");
  }
  if (parsed.protocol !== "http:") throw new LocalGuardError(`the scheme is ${parsed.protocol}, not http:`);
  if (parsed.username !== "" || parsed.password !== "") throw new LocalGuardError("the URL carries user info");
  if (!LOOPBACK.has(parsed.hostname)) throw new LocalGuardError(`the host is ${parsed.hostname}, not 127.0.0.1 or localhost`);
  const port = Number(parsed.port);
  if (parsed.port === "" || !Number.isInteger(port)) throw new LocalGuardError("the URL has no port");
  if (env.CI !== "true" && (port < N1_PORT_MIN || port > N1_PORT_MAX)) {
    throw new LocalGuardError(`port ${port} is outside ${N1_PORT_MIN} to ${N1_PORT_MAX}`);
  }
  return { host: parsed.hostname, port };
}

/** SQL against the guarded local stack. The shared helper still refuses a container that is not this stack. */
export function runN1Sql(script: string): SqlResult {
  assertLocalGuard(process.env.NEXT_PUBLIC_SUPABASE_URL);
  return runSql(script);
}

/** True when the guard passes AND a usable local database container exists (so a suite can skip on a machine without one). */
export function haveN1Db(): boolean {
  try {
    assertLocalGuard(process.env.NEXT_PUBLIC_SUPABASE_URL);
  } catch {
    return false;
  }
  return haveLocalDb();
}

/**
 * A database-backed test that cannot reach its database FAILS; it never skips. A skip would look exactly like a pass (N1-R27). Throws a LocalGuardError the test runner reports as the failure.
 * `check` is injectable so the rule itself can be tested.
 */
export function requireN1Db(check: () => boolean = haveN1Db): void {
  if (!check()) {
    throw new LocalGuardError(
      "the local database is not usable (the guard refused the URL, or there is no stack container); a database test FAILS rather than skipping: start the scratch stack and set NEXT_PUBLIC_SUPABASE_URL and LOCAL_DB_CONTAINER",
    );
  }
}

export type ServiceSet = { project: string; services: string[]; label: "reduced" | "full" };

function dockerNames(): string[] {
  return execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8", timeout: 60_000 })
    .split("\n")
    .map((n) => n.trim())
    .filter(Boolean);
}

/**
 * The services the stack of `container` (supabase_db_<project>) is running, read from docker and not typed. Labelled "full" only when realtime, pg_meta and inbucket run as well as the
 * five every N1 test needs; otherwise "reduced". Every local proof result names this set.
 */
export function localServiceSet(listContainers: () => string[] = dockerNames, container: string = localDbContainer()): ServiceSet {
  const project = container.replace(/^supabase_db_/, "");
  const services: string[] = [];
  for (const name of listContainers()) {
    const m = /^supabase_(.+)_([^_]+(?:_[^_]+)*)$/.exec(name);
    if (!m || !name.endsWith(`_${project}`)) continue;
    services.push(name.slice("supabase_".length, name.length - project.length - 1));
  }
  services.sort();
  const full = ["realtime", "pg_meta", "inbucket"].every((s) => services.includes(s));
  return { project, services, label: full ? "full" : "reduced" };
}

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* Scratch databases. A migration REPLAY (drop and re-create the tables, then probe them) must not run in the shared `postgres` database: a table with a foreign key to profiles, */
/* admin_users or auth.users takes heavy locks on those tables for as long as the replay lasts, and the auth service (creating and deleting users for every other suite) deadlocked */
/* with it (40P01, seen in two whole-suite runs). So a replay runs in a private database on the SAME stack, which shares no table, row or lock with anything else.                  */
/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------ */

const SCRATCH_NAME = /^n1_replay_(\d+)_[a-z0-9]+$/;

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** A fresh scratch database name that carries the creating process's id (so a leftover from a crashed run can be recognised and removed). */
export function newScratchName(pid: number = process.pid): string {
  return `n1_replay_${pid}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function assertScratchName(db: string): void {
  if (!SCRATCH_NAME.test(db)) throw new LocalGuardError(`not an N1 scratch database name: ${db}`);
}

/** SQL against one scratch database of the guarded local stack. Never throws on a SQL error; returns it. */
export function runN1ScratchSql(db: string, script: string): SqlResult {
  assertLocalGuard(process.env.NEXT_PUBLIC_SUPABASE_URL);
  assertScratchName(db);
  const container = localDbContainer();
  try {
    const stdout = execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", db, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], {
      input: script,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, stdout, stderr: "" };
  } catch (err) {
    const e = err as { stdout?: unknown; stderr?: unknown };
    return { ok: false, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
  }
}

/** Creates the scratch database and runs `bootstrap` in it. Two files creating at the same moment can meet "source database is being accessed" (55006); that alone is retried. */
export function createN1Scratch(db: string, bootstrap: string): void {
  assertLocalGuard(process.env.NEXT_PUBLIC_SUPABASE_URL);
  assertScratchName(db);
  let last = "";
  for (let attempt = 1; attempt <= 6; attempt++) {
    const r = runN1Sql(`create database "${db}";`);
    if (r.ok) {
      const b = runN1ScratchSql(db, bootstrap);
      if (!b.ok) throw new Error(`scratch database ${db}: bootstrap failed: ${b.stderr}`);
      return;
    }
    last = r.stderr;
    if (!/ERROR:\s+55006:/.test(r.stderr)) break;
    sleepMs(300 * attempt);
  }
  throw new Error(`scratch database ${db}: create failed: ${last}`);
}

export function dropN1Scratch(db: string): void {
  assertLocalGuard(process.env.NEXT_PUBLIC_SUPABASE_URL);
  assertScratchName(db);
  const r = runN1Sql(`drop database if exists "${db}" with (force);`);
  if (!r.ok) throw new Error(`scratch database ${db}: drop failed: ${r.stderr}`);
}

/** The scratch databases that exist right now (any process's). */
export function listN1Scratch(): string[] {
  const r = runN1Sql(`select datname from pg_database where datname like 'n1\\_replay\\_%' order by 1;`);
  return r.ok ? r.stdout.split("\n").map((l) => l.trim()).filter((l) => SCRATCH_NAME.test(l)) : [];
}

/** Removes scratch databases whose creating process is gone (a crashed or killed run). A database of a live process is left alone. */
export function sweepStaleN1Scratch(isAlive: (pid: number) => boolean = pidAlive): string[] {
  const removed: string[] = [];
  for (const db of listN1Scratch()) {
    const pid = Number(SCRATCH_NAME.exec(db)![1]);
    if (!isAlive(pid)) {
      dropN1Scratch(db);
      removed.push(db);
    }
  }
  return removed;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The one place that deletes append-only audit rows. The audit tables refuse update, delete and truncate for everyone, so a Data API test that commits events cannot remove them as a
 * client; it removes exactly its own rows as the table's owner with triggers off for that single session (`session_replication_role = replica`). That is only ever acceptable on a
 * local stack, so this function checks, BEFORE anything runs, that the database address is 127.0.0.1 or localhost with no user info, and refuses everything else (a hosted project, a
 * private-network address, a lookalike host). It takes uuids only.
 */
export function removeAuditRowsAsOwner(messageIds: readonly string[], url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL, run: (script: string) => SqlResult = runN1Sql): void {
  let parsed: URL;
  try {
    parsed = new URL(url ?? "");
  } catch {
    throw new LocalGuardError("the database address is missing or cannot be parsed; audit rows are not removed");
  }
  if (!LOOPBACK.has(parsed.hostname) || parsed.username !== "" || parsed.password !== "") {
    throw new LocalGuardError(`the database host is ${parsed.hostname}, not 127.0.0.1 or localhost; audit rows are not removed`);
  }
  if (messageIds.length === 0) return;
  for (const id of messageIds) if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new LocalGuardError("an id is not a uuid");
  const list = messageIds.map((m) => `'${m}'`).join(", ");
  const r = run(
    `set session_replication_role = replica; delete from public.admin_message_events where message_id in (${list}); delete from public.admin_message_recipients where message_id in (${list}); delete from public.admin_messages where id in (${list});`,
  );
  if (!r.ok) throw new Error(`removing audit rows failed: ${r.stderr}`);
}
