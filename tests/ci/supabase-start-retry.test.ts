/**
 * `supabase start` in CI, retried ONLY when the registry throttles it.
 *
 * WHY. Each CI job starts a local Supabase stack, which pulls about twelve images in parallel from AWS ECR Public. Anonymous pulls from
 * shared runner IPs are rate limited, and a throttled pull killed the e2e job on #689, #696 and #698 ("toomanyrequests: Rate exceeded",
 * every image refused within a second), each passing on its one rerun. The owner approved retry (option 1): no secret, no cache.
 *
 * THE RULES THESE TESTS PIN, against a fake `supabase` on PATH (no network, no Docker):
 *  - success on the first try: no retry, no cleanup, no waiting, and the log says which attempt succeeded;
 *  - the registry's rate-limit text ("toomanyrequests" or "Rate exceeded") -> clean up what is half started (`supabase stop --no-backup`),
 *    wait 30 s, try again; after a second one wait 60 s; three attempts in all;
 *  - ANY other failure fails fast, with the CLI's own exit code, on the first attempt: no cleanup, no waiting;
 *  - three throttled attempts in a row is still a failure (a persistent throttle must not turn into a hang or a false pass);
 *  - the workflow's composite action runs this script, still runs `supabase db reset`, and uses no secret.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.join(__dirname, "../../.github/actions/local-supabase/start-supabase.sh");
const ACTION = path.join(__dirname, "../../.github/actions/local-supabase/action.yml");

type Step = "ok" | "ratelimit-toomany" | "ratelimit-exceeded" | "other";
let dir = "";

/** A fake `supabase`: `start` behaves per `scenario` (one entry per call), `stop` is recorded. */
function setup(scenario: Step[], otherExit = 7) {
  dir = mkdtempSync(path.join(tmpdir(), "sbstart-"));
  writeFileSync(path.join(dir, "scenario"), scenario.join("\n") + "\n");
  writeFileSync(path.join(dir, "calls"), "");
  const fake = `#!/usr/bin/env bash
cmd="$1"; shift
echo "$cmd $*" >> "${dir}/calls"
if [ "$cmd" = "stop" ]; then exit 0; fi
n=$(grep -c '^start' "${dir}/calls")
step=$(sed -n "\${n}p" "${dir}/scenario")
case "$step" in
  ok) echo "Started supabase local development setup."; exit 0;;
  ratelimit-toomany) echo "Error response from daemon: toomanyrequests: Rate exceeded"; echo "failed to pull image"; exit 1;;
  ratelimit-exceeded) echo "Retrying after 4s: public.ecr.aws/supabase/gotrue:v2.196.0"; echo "Rate exceeded"; exit 1;;
  other) echo "Bind for 0.0.0.0:54322 failed: port is already allocated"; exit ${otherExit};;
esac
`;
  writeFileSync(path.join(dir, "supabase"), fake);
  chmodSync(path.join(dir, "supabase"), 0o755);
  // A `sleep` that only records, so the test is instant and the requested waits can be asserted.
  writeFileSync(path.join(dir, "fakesleep"), `#!/usr/bin/env bash\necho "$1" >> "${dir}/sleeps"\n`);
  chmodSync(path.join(dir, "fakesleep"), 0o755);
}

function run() {
  const r = spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SUPABASE_START_SLEEP: path.join(dir, "fakesleep") },
  });
  const calls = readFileSync(path.join(dir, "calls"), "utf8").split("\n").filter(Boolean);
  const sleeps = existsSync(path.join(dir, "sleeps")) ? readFileSync(path.join(dir, "sleeps"), "utf8").split("\n").filter(Boolean) : [];
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? ""), calls, sleeps };
}

beforeEach(() => {
  dir = "";
});
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("start-supabase.sh", () => {
  it("success on the first try: one start, no cleanup, no waiting, and the log names the attempt", () => {
    setup(["ok"]);
    const r = run();
    expect(r.code).toBe(0);
    expect(r.calls).toEqual(["start "]);
    expect(r.sleeps).toEqual([]);
    expect(r.out).toMatch(/succeeded on attempt 1 of 3/);
  });

  it("a rate limit once: cleans up, waits 30 s, retries, and says it succeeded on attempt 2", () => {
    setup(["ratelimit-toomany", "ok"]);
    const r = run();
    expect(r.code).toBe(0);
    expect(r.calls).toEqual(["start ", "stop --no-backup", "start "]);
    expect(r.sleeps).toEqual(["30"]);
    expect(r.out).toMatch(/succeeded on attempt 2 of 3/);
    expect(r.out).toMatch(/rate limit/i);
  });

  it("two rate limits: waits 30 s then 60 s, succeeds on attempt 3", () => {
    setup(["ratelimit-exceeded", "ratelimit-toomany", "ok"]);
    const r = run();
    expect(r.code).toBe(0);
    expect(r.calls).toEqual(["start ", "stop --no-backup", "start ", "stop --no-backup", "start "]);
    expect(r.sleeps).toEqual(["30", "60"]);
    expect(r.out).toMatch(/succeeded on attempt 3 of 3/);
  });

  it("recognises both spellings of the throttle on their own", () => {
    for (const first of ["ratelimit-toomany", "ratelimit-exceeded"] as const) {
      setup([first, "ok"]);
      const r = run();
      expect(r.code, first).toBe(0);
      expect(r.calls.filter((c) => c.startsWith("start")).length, first).toBe(2);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("any OTHER failure fails fast with the CLI's own exit code: one attempt, no cleanup, no waiting", () => {
    setup(["other", "ok"], 7);
    const r = run();
    expect(r.code).toBe(7);
    expect(r.calls).toEqual(["start "]);
    expect(r.sleeps).toEqual([]);
    expect(r.out).toMatch(/not a registry rate limit/i);
  });

  it("a failure that is not the throttle after a throttled attempt also fails fast, without a third try", () => {
    setup(["ratelimit-toomany", "other", "ok"], 3);
    const r = run();
    expect(r.code).toBe(3);
    expect(r.calls.filter((c) => c.startsWith("start")).length).toBe(2);
    expect(r.sleeps).toEqual(["30"]);
  });

  it("three throttled attempts in a row is a failure that says so (no hang, no false pass)", () => {
    setup(["ratelimit-toomany", "ratelimit-toomany", "ratelimit-exceeded", "ok"]);
    const r = run();
    expect(r.code).not.toBe(0);
    expect(r.calls.filter((c) => c.startsWith("start")).length).toBe(3);
    expect(r.calls.filter((c) => c.startsWith("stop")).length).toBe(2);
    expect(r.sleeps).toEqual(["30", "60"]);
    expect(r.out).toMatch(/rate limit/i);
    expect(r.out).toMatch(/all 3 attempts/i);
  });
});

describe("the composite action uses it", () => {
  const action = readFileSync(ACTION, "utf8");

  it("runs start-supabase.sh instead of a bare `supabase start`", () => {
    expect(action).toMatch(/start-supabase\.sh/);
    expect(action).not.toMatch(/^\s*run:\s*supabase start\s*$/m);
  });

  it("still runs `supabase db reset` and exports the connection details", () => {
    expect(action).toMatch(/supabase db reset/);
    expect(action).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("adds no secret", () => {
    expect(action).not.toMatch(/secrets\./);
  });
});
