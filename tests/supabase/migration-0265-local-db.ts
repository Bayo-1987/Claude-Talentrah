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
