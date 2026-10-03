/**
 * Runs the rescore workflow's REAL `run:` block (extracted from the YAML) against a stubbed curl, so the gates are behaviour, not source text:
 *   - a write run needs a SECOND typed input (confirm_write = "write"); without it the workflow fails before it calls anything;
 *   - a dry run walks the route in bounded pages to completion, merges the shape, and sets the rows the chain visited against an independent
 *     single-query count taken before and after; it fails unless they are equal, and fails if the cursor ever fails to advance;
 *   - nothing it prints contains a user id, and the secret is never printed.
 * Needs bash and jq (both on the CI runner).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const yaml = readFileSync(".github/workflows/rescore-stale-match-scores.yml", "utf8").split("\n");
const start = yaml.findIndex((l) => /^\s+run: \|\s*$/.test(l));
const body: string[] = [];
for (const l of yaml.slice(start + 1)) {
  if (l.trim() !== "" && !l.startsWith(" ".repeat(10))) break;
  body.push(l.slice(10));
}
const script = body.join("\n");
const FAKE_KEY = "not-a-real-key-for-the-stub";
const U1 = "11111111-2222-3333-4444-555555555555";
const U2 = "21111111-2222-3333-4444-555555555555";

const shape = (rows: number, down: number) => ({
  rows,
  up: 0,
  down,
  same: rows - down,
  changeBuckets: { "1-5": 0, "6-10": down, "11-20": 0, over20: 0 },
  labelChanges: down ? { "good -> unscreened": down } : {},
  labelUnchanged: rows - down,
  endingNoTier: 0,
  endingUnscreened: down,
  rowsPerUserRanked: [rows],
  largestDrops: down ? [{ from: 100, to: 79 }] : [],
});
const page = (rowsVisited: number, usersVisited: number, complete: boolean, nextCursor: string | null) => ({
  summary: { dryRun: true, complete, nextCursor, rowsVisited, usersVisited, rowsToRescore: rowsVisited, skippedNoBaseResume: [], skippedPostingGone: 0, skippedStubSkill: 0, shape: shape(rowsVisited, 1) },
});

function runWorkflow(env: Record<string, string>, pages: unknown[], counts: number[]) {
  const dir = mkdtempSync(join(tmpdir(), "rescore-wf-"));
  writeFileSync(join(dir, "pages.jsonl"), pages.map((p) => JSON.stringify(p)).join("\n") + "\n");
  writeFileSync(join(dir, "counts"), counts.join("\n") + "\n");
  writeFileSync(join(dir, "calls"), "");
  writeFileSync(
    join(dir, "curl"),
    `#!/bin/bash
out=""; data=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; -d) data="$2"; shift 2;; *) shift;; esac; done
echo "$data" >> "$STUB_DIR/calls"
if echo "$data" | grep -q '"count"'; then
  n=$(head -1 "$STUB_DIR/counts"); sed -i.bak '1d' "$STUB_DIR/counts"
  echo "{\\"count\\":{\\"staleRows\\":$n}}" > "$out"
else
  n=$(cat "$STUB_DIR/page-n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$STUB_DIR/page-n"
  sed -n "$n"p "$STUB_DIR/pages.jsonl" > "$out"
fi
echo 200
`,
  );
  chmodSync(join(dir, "curl"), 0o755);
  const r = spawnSync("bash", ["-c", script], {
    env: { PATH: `${dir}:${process.env.PATH}`, STUB_DIR: dir, CRON_SECRET: FAKE_KEY, DRY_RUN: "true", VERIFY: "0", MAX_ROWS: "5", CURSOR_IN: "", CONFIRM_WRITE: "", ...env } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  const calls = readFileSync(join(dir, "calls"), "utf8").split("\n").filter(Boolean);
  return { status: r.status, out: `${r.stdout}${r.stderr}`, calls };
}

describe("the workflow's real run block", () => {
  it("a write run without confirm_write = write fails with a clear message and calls NOTHING", () => {
    for (const confirm of ["", "yes", "WRITE ", "writ"]) {
      const r = runWorkflow({ DRY_RUN: "false", CONFIRM_WRITE: confirm }, [], []);
      expect(r.status, `confirm_write=${JSON.stringify(confirm)}`).toBe(1);
      expect(r.out).toMatch(/::error::.*confirm_write/);
      expect(r.calls).toEqual([]);
    }
  });

  it("a write run with confirm_write = write proceeds and sends write:true", () => {
    const done = { summary: { complete: true, nextCursor: null, rowsRescored: 3 } };
    const r = runWorkflow({ DRY_RUN: "false", CONFIRM_WRITE: "write" }, [done], []);
    expect(r.status).toBe(0);
    expect(r.calls.length).toBe(1);
    expect(r.calls[0]).toContain('"write":true');
  });

  it("the confirm gate does not apply to a dry run or a verify", () => {
    const ok = runWorkflow({ CONFIRM_WRITE: "" }, [page(16, 5, true, null)], [16, 16]);
    expect(ok.status).toBe(0);
    const v = runWorkflow({ VERIFY: "20", CONFIRM_WRITE: "" }, [{ verify: { checked: 20, matching: 20, mismatching: 0, unverifiable: 0 } }], []);
    expect(v.status).toBe(0);
  });

  it("a dry run walks the pages to completion, merges the shape, and reconciles the chain total with the single-query count", () => {
    const r = runWorkflow({}, [page(6, 2, false, U1), page(5, 2, false, U2), page(5, 1, true, null)], [16, 16]);
    expect(r.status, r.out).toBe(0);
    expect(r.calls.filter((c) => c.includes('"count"')).length, "one count before, one after").toBe(2);
    expect(r.calls.filter((c) => !c.includes('"count"')).length).toBe(3);
    expect(r.calls.every((c) => !c.includes('"write"'))).toBe(true);
    expect(r.out).toMatch(/chain visited rows=16 users=5 calls=3/);
    expect(r.out).toMatch(/single-query stale rows before=16 after=16/);
    expect(r.out).toMatch(/RECONCILED/);
    // the merged shape adds the pages up
    expect(r.out).toMatch(/"rows":16/);
    expect(r.out).toMatch(/"down":3/);
    expect(r.out).toMatch(/"good -> unscreened":3/);
  });

  it("FAILS when the chain total differs from the single-query count", () => {
    const r = runWorkflow({}, [page(6, 2, false, U1), page(5, 2, true, null)], [16, 16]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/::error::.*chain visited 11 rows.*16/);
    expect(r.out).not.toMatch(/RECONCILED/);
  });

  it("FAILS when the count moved while the chain ran (before differs from after)", () => {
    const r = runWorkflow({}, [page(16, 5, true, null)], [16, 15]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/::error::/);
  });

  it("FAILS when the cursor does not advance (a user would be visited twice)", () => {
    const r = runWorkflow({}, [page(6, 2, false, U2), page(6, 2, false, U1), page(4, 1, true, null)], [16, 16]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/::error::.*cursor/);
  });

  it("prints no user id and never prints the secret", () => {
    const r = runWorkflow({}, [page(6, 2, false, U1), page(5, 2, false, U2), page(5, 1, true, null)], [16, 16]);
    expect(r.out).not.toContain(U1);
    expect(r.out).not.toContain(U2);
    expect(r.out).not.toContain(FAKE_KEY);
    expect(r.out).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });
});

describe("the harness itself", () => {
  it("has bash and jq", () => {
    expect(execFileSync("jq", ["--version"], { encoding: "utf8" })).toMatch(/jq/);
    expect(script.length).toBeGreaterThan(500);
  });
});
