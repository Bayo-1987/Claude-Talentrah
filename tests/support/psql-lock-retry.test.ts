/**
 * The runner both CI-only round-trip tests (0224/0225 and 0232) use to reach the local stack's Postgres, with one narrow retry: a lock conflict (deadlock,
 * SQLSTATE 40P01, or a lock timeout, 55P03) between the round trip's transaction and another test file running at the same time is retried, at most three
 * attempts, and each retry is logged. Any other error is thrown at once and unchanged, and so is the last one if every attempt hits a lock conflict: a real
 * migration or rollback failure must never be retried or hidden. The retry is safe because the round trip is one transaction that always rolls back.
 *
 * Why it exists: CI run 37521009413 failed this test with "ERROR: deadlock detected" (AccessExclusiveLock vs RowExclusiveLock against a concurrent test).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCK_TIMEOUT, MAX_ATTEMPTS, isLockConflict, psqlArgs, retryOnLockConflict, withLockTimeout } from "./psql-lock-retry";

const deadlock = () => Object.assign(new Error("Command failed: docker exec ...\nERROR:  40P01: deadlock detected\nDETAIL:  Process 1 waits for AccessExclusiveLock"), { status: 3 });
const lockTimeout = () => Object.assign(new Error("Command failed: docker exec ...\nERROR:  55P03: canceling statement due to lock timeout"), { status: 3 });
const permission = () => Object.assign(new Error("Command failed: docker exec ...\nERROR:  42501: permission denied for table blog_posts"), { status: 3 });

function scripted(outcomes: Array<"ok" | Error>) {
  const calls: number[] = [];
  const run = () => {
    calls.push(calls.length + 1);
    const o = outcomes[calls.length - 1] ?? "ok";
    if (o === "ok") return "OUTPUT";
    throw o;
  };
  return { run, calls };
}

describe("isLockConflict: only SQLSTATE 40P01 and 55P03", () => {
  it.each([
    ["a deadlock", deadlock(), true],
    ["a lock timeout", lockTimeout(), true],
    ["a permission error", permission(), false],
    ["a syntax error", new Error("ERROR:  42601: syntax error at or near"), false],
    ["the word 'deadlock' without the SQLSTATE line", new Error("the test mentions a deadlock in prose"), false],
    ["a non-Error", "40P01", false],
  ])("%s -> %s", (_name, err, expected) => {
    expect(isLockConflict(err)).toBe(expected);
  });
});

describe("retryOnLockConflict", () => {
  it("returns the output at once when nothing fails, without logging", () => {
    const logs: string[] = [];
    const { run, calls } = scripted(["ok"]);
    expect(retryOnLockConflict(run, { log: (l) => logs.push(l) })).toBe("OUTPUT");
    expect(calls).toHaveLength(1);
    expect(logs).toEqual([]);
  });

  it("retries a deadlock once and returns the output, with one visible log line naming the SQLSTATE and the attempt", () => {
    const logs: string[] = [];
    const { run, calls } = scripted([deadlock(), "ok"]);
    expect(retryOnLockConflict(run, { log: (l) => logs.push(l) })).toBe("OUTPUT");
    expect(calls).toHaveLength(2);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/lock conflict/i);
    expect(logs[0]).toContain("40P01");
    expect(logs[0]).toMatch(/attempt 1 of 3/);
  });

  it("retries a lock timeout too", () => {
    const logs: string[] = [];
    const { run, calls } = scripted([lockTimeout(), lockTimeout(), "ok"]);
    expect(retryOnLockConflict(run, { log: (l) => logs.push(l) })).toBe("OUTPUT");
    expect(calls).toHaveLength(3);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain("55P03");
  });

  it("stops after three attempts and throws the LAST error unchanged (same object)", () => {
    const logs: string[] = [];
    const last = deadlock();
    const { run, calls } = scripted([deadlock(), deadlock(), last, "ok"]);
    let thrown: unknown;
    try { retryOnLockConflict(run, { log: (l) => logs.push(l) }); } catch (e) { thrown = e; }
    expect(thrown).toBe(last);
    expect(calls).toHaveLength(3);
    expect(logs).toHaveLength(2); // a log before each retry, none after the last attempt
  });

  it("never retries any other error: thrown at once, unchanged, no log", () => {
    const logs: string[] = [];
    const err = permission();
    const { run, calls } = scripted([err, "ok"]);
    let thrown: unknown;
    try { retryOnLockConflict(run, { log: (l) => logs.push(l) }); } catch (e) { thrown = e; }
    expect(thrown).toBe(err);
    expect(calls).toHaveLength(1);
    expect(logs).toEqual([]);
  });

  it("a lock conflict followed by a real error throws the real error, not a retry loop", () => {
    const err = permission();
    const { run, calls } = scripted([deadlock(), err, "ok"]);
    let thrown: unknown;
    try { retryOnLockConflict(run, { log: () => {} }); } catch (e) { thrown = e; }
    expect(thrown).toBe(err);
    expect(calls).toHaveLength(2);
  });

  it("is bounded: a larger maxAttempts cannot exceed three", () => {
    const { run, calls } = scripted([deadlock(), deadlock(), deadlock(), deadlock(), deadlock()]);
    expect(() => retryOnLockConflict(run, { maxAttempts: 10, log: () => {} })).toThrow();
    expect(calls).toHaveLength(MAX_ATTEMPTS);
    expect(MAX_ATTEMPTS).toBe(3);
  });
});

describe("how psql is called", () => {
  it("asks psql for the SQLSTATE in error messages, and stops at the first error", () => {
    const args = psqlArgs();
    expect(args).toContain("ON_ERROR_STOP=1");
    expect(args.join(" ")).toContain("-v VERBOSITY=verbose");
  });

  it("starts every script with a short lock timeout, so a lock wait fails fast (55P03) instead of hanging", () => {
    expect(LOCK_TIMEOUT).toMatch(/^[1-5]s$/);
    const wrapped = withLockTimeout("BEGIN;\nSELECT 1;\nROLLBACK;\n");
    expect(wrapped.startsWith(`SET lock_timeout = '${LOCK_TIMEOUT}';`)).toBe(true);
    expect(wrapped).toContain("BEGIN;\nSELECT 1;\nROLLBACK;\n");
  });
});

describe("both round-trip files use the shared runner (no private copy of the docker call)", () => {
  const ROOT = join(__dirname, "../..");
  it.each(["tests/supabase/migration-0224-0225-round-trip.test.ts", "tests/supabase/migration-0232-round-trip.test.ts"])("%s", (file) => {
    const src = readFileSync(join(ROOT, file), "utf8");
    expect(src, `${file} must run its SQL through runRoundTripScript`).toContain("runRoundTripScript");
    expect(src, `${file} still has its own docker exec call`).not.toMatch(/execFileSync\(\s*"docker"/);
  });
});
