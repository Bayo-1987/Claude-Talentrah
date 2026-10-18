/**
 * Raw SQL against the LOCAL stack's Postgres, for the few tests that need a transaction of their own (an enum value added and used in one transaction; a rollback file).
 *
 * It runs `psql` inside the stack's database container, so no connection string, password or key is involved. Which container:
 *   - LOCAL_DB_CONTAINER when set (a machine running several stacks must say which; `supabase_db_<project id>`), otherwise the ONE running supabase_db_* container;
 *   - and it REFUSES unless that container belongs to the same stack as NEXT_PUBLIC_SUPABASE_URL: the stack's kong container must publish that URL's port, and the URL host
 *     must be 127.0.0.1 or localhost. A script cannot reach a hosted project, or another session's stack on this machine, through here.
 */
import { execFileSync } from "node:child_process";

const LOOPBACK = new Set(["127.0.0.1", "localhost"]);

function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
}

export function localDbContainer(): string {
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  if (!LOOPBACK.has(url.hostname)) throw new Error(`refusing: the Supabase host is ${url.hostname}, not 127.0.0.1 or localhost`);
  const named = process.env.LOCAL_DB_CONTAINER;
  const running = docker(["ps", "--format", "{{.Names}}"]).split("\n").map((n) => n.trim()).filter((n) => /^supabase_db_/.test(n));
  const container = named ?? (running.length === 1 ? running[0] : "");
  if (!container || !running.includes(container)) {
    throw new Error(`no usable local database container (LOCAL_DB_CONTAINER=${named ?? "unset"}; running: ${running.join(", ") || "none"})`);
  }
  const kong = container.replace(/^supabase_db_/, "supabase_kong_");
  const published = docker(["port", kong, "8000/tcp"]);
  if (!published.split("\n").some((l) => l.trim().endsWith(`:${url.port}`))) {
    throw new Error(`refusing: container ${container} is not the stack at ${url.host} (its API publishes ${published.trim()})`);
  }
  return container;
}

export interface SqlResult { ok: boolean; stdout: string; stderr: string }

/** Runs a script with ON_ERROR_STOP and verbose errors, so a failure carries its SQLSTATE ("ERROR:  55P04: ..."). Never throws on a SQL error; returns it. */
export function runSql(script: string): SqlResult {
  const container = localDbContainer();
  try {
    const stdout = execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], {
      input: script, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000, stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, stdout, stderr: "" };
  } catch (err) {
    const e = err as { stdout?: unknown; stderr?: unknown };
    return { ok: false, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
  }
}

/** True when there is a local container this process may use (so a suite can skip cleanly where there is none, e.g. on a machine without Docker). */
export function haveLocalDb(): boolean {
  try { localDbContainer(); return true; } catch { return false; }
}
