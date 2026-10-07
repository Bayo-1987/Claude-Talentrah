/**
 * The runner the CI-only round-trip tests use to reach the local stack's Postgres (see psql-lock-retry.test.ts for the rules and the reason).
 *
 *  - Retry ONLY a lock conflict: SQLSTATE 40P01 (deadlock detected) or 55P03 (lock timeout). The SQLSTATE is read from psql's own error line, which `-v VERBOSITY=verbose`
 *    makes "ERROR:  40P01: ..."; no other text counts, so a real migration or rollback failure is never retried.
 *  - At most MAX_ATTEMPTS (3) attempts; every retry is logged, so a recurring conflict stays visible in the CI log; the last error is thrown as it was.
 *  - Every script starts with a short lock timeout, so waiting on another test's lock fails fast and is retried instead of hanging into a deadlock.
 *  - Safe to repeat because every round trip is ONE transaction that always rolls back: a failed attempt leaves nothing behind.
 */
import { execFileSync } from "node:child_process";

export const MAX_ATTEMPTS = 3;
export const LOCK_TIMEOUT = "3s";

type LockState = "40P01" | "55P03";

function errorText(err: unknown): string {
  if (!(err instanceof Error)) return "";
  const e = err as Error & { stderr?: unknown; stdout?: unknown };
  return [err.message, e.stderr, e.stdout].map((p) => (p === undefined || p === null ? "" : String(p))).join("\n");
}

/** The lock-conflict SQLSTATE in psql's error output, or null. Only an "ERROR:  <SQLSTATE>:" line counts. */
function lockConflictState(err: unknown): LockState | null {
  const m = errorText(err).match(/ERROR:\s+(40P01|55P03):/);
  return m ? (m[1] as LockState) : null;
}

export function isLockConflict(err: unknown): boolean {
  return lockConflictState(err) !== null;
}

export function retryOnLockConflict<T>(run: () => T, opts: { maxAttempts?: number; log?: (line: string) => void } = {}): T {
  const max = Math.min(Math.max(1, opts.maxAttempts ?? MAX_ATTEMPTS), MAX_ATTEMPTS);
  const log = opts.log ?? ((line: string) => console.warn(line));
  for (let attempt = 1; ; attempt++) {
    try {
      return run();
    } catch (err) {
      const state = lockConflictState(err);
      if (state === null || attempt >= max) throw err; // not a lock conflict, or the last attempt: thrown as it was
      log(`[round-trip] lock conflict (SQLSTATE ${state}) on attempt ${attempt} of ${max}; retrying`);
    }
  }
}

export function psqlArgs(): string[] {
  return ["-U", "postgres", "-d", "postgres", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
}

export function withLockTimeout(script: string): string {
  return `SET lock_timeout = '${LOCK_TIMEOUT}';\n${script}`;
}

function dbContainer(): string {
  const names = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" })
    .split("\n")
    .map((n) => n.trim())
    .filter((n) => /^supabase_db_/.test(n));
  if (names.length !== 1) throw new Error(`expected exactly one running supabase_db_* container (the local stack's Postgres), found ${names.length}: ${names.join(", ") || "none"}`);
  return names[0];
}

/** Runs a script on the local stack's Postgres, retrying only a lock conflict. */
export function runRoundTripScript(script: string): string {
  const container = dbContainer();
  return retryOnLockConflict(() =>
    execFileSync("docker", ["exec", "-i", container, "psql", ...psqlArgs()], {
      input: withLockTimeout(script),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
    }),
  );
}
