/**
 * `supabase start` in CI, retried when Docker cannot bind the database's host port (CI-RUNNER-DOCKER-NET-1).
 *
 * WHAT HAPPENED, from the real logs (reports/S2/2026-11-15-docker-net-error-lines.md; runs 43755341931, 43759233492, 43767632112). Image pulls were throttled first ("error from registry: Rate exceeded"), the CLI retried
 * each pull and every one succeeded. The job then died on a different error, when Docker started the database container:
 *   failed to start docker container "supabase_db_...": Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint
 *   supabase_db_... (<id>): failed to bind host port 0.0.0.0:54322/tcp: address already in use
 * The old script saw the throttle text in attempt 1's output, called the attempt "a registry rate limit", cleaned up with `supabase stop` and retried once; attempt 2 hit the SAME bind error, which no longer
 * contains the throttle text, so it failed fast. So: a second class of retryable failure, named for what it is, with a cleanup that can free the port.
 *
 * THE RULES THESE TESTS PIN, against a fake `supabase` AND a fake `docker` on PATH (no network, no Docker):
 *  (a) the bind error on attempt 1 and success on attempt 2 is exit 0, after a cleanup;
 *  (b) the registry rate-limit retry still works, and it does NOT touch Docker (its cleanup is unchanged);
 *  (c) any other error (a port that is "already allocated", a config error, a near-miss of the bind text) still exits at once, with the CLI's exit code, without a retry or a docker call;
 *  (d) three bind errors in a row is a failure that says so, after exactly three attempts and the same 30 s and 60 s waits;
 *  (e) the extra cleanup removes ONLY containers named supabase_* and networks named supabase_network_*, by id, and runs no prune.
 * What a fake cannot prove is written at the end of this file's report, not here: that the retry frees the real port.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.join(__dirname, "../../.github/actions/local-supabase/start-supabase.sh");

/** The two lines the real logs show, verbatim apart from the container id and the digest. */
const BIND_LINE =
  'failed to start docker container "supabase_db_Claude_Talentrah": Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint supabase_db_Claude_Talentrah (aaacbdf0ff126e2d0be7814be3cc17aeb317cbca721cf880744e45b07bf40538): failed to bind host port 0.0.0.0:54322/tcp: address already in use';

type Step = "ok" | "bind" | "bind-after-throttle" | "ratelimit" | "other-port" | "other-config" | "near-miss";
let dir = "";

const CONTAINERS = [
  ["c1", "supabase_db_Claude_Talentrah"],
  ["c2", "supabase_kong_Claude_Talentrah"],
  ["c3", "postgres_app"],
  ["c4", "myapp-web-1"],
  ["c5", "supabase"], // no underscore: not one of the stack's names
  ["c6", "notsupabase_x"], // contains the word but does not start with it
] as const;
const NETWORKS = [
  ["n1", "supabase_network_Claude_Talentrah"],
  ["n2", "bridge"],
  ["n3", "host"],
  ["n4", "app_default"],
  ["n5", "supabase"],
] as const;

/** A fake `supabase` (start behaves per `scenario`, one entry per call; stop is recorded) and a fake `docker` (lists the fixtures above; everything is recorded). */
function setup(scenario: Step[], otherExit = 7) {
  dir = mkdtempSync(path.join(tmpdir(), "sbbind-"));
  writeFileSync(path.join(dir, "scenario"), scenario.join("\n") + "\n");
  writeFileSync(path.join(dir, "calls"), "");
  writeFileSync(path.join(dir, "dockercalls"), "");
  const fake = `#!/usr/bin/env bash
cmd="$1"; shift
echo "$cmd $*" >> "${dir}/calls"
if [ "$cmd" = "stop" ]; then exit 0; fi
n=$(grep -c '^start' "${dir}/calls")
step=$(sed -n "\${n}p" "${dir}/scenario")
case "$step" in
  ok) echo "Started supabase local development setup."; exit 0;;
  bind) echo "Starting database..."; echo "Stopping containers..."; echo '${BIND_LINE}'; echo "failed to start containers: 7bc963a1"; echo "Try rerunning the command with --debug to troubleshoot the error."; exit 1;;
  bind-after-throttle) echo "Error response from daemon: error from registry: Rate exceeded"; echo "Retrying after 4s: public.ecr.aws/supabase/studio:2026.08.24-sha-8ec45b2"; echo "Starting database..."; echo '${BIND_LINE}'; exit 1;;
  ratelimit) echo "Error response from daemon: toomanyrequests: Rate exceeded"; echo "failed to pull image"; exit 1;;
  other-port) echo "Bind for 0.0.0.0:54322 failed: port is already allocated"; exit ${otherExit};;
  other-config) echo "failed to parse config: invalid port in [db]: port = 99999"; exit ${otherExit};;
  near-miss) echo "listen tcp 127.0.0.1:54321: bind: address already in use"; exit ${otherExit};;
esac
`;
  writeFileSync(path.join(dir, "supabase"), fake);
  chmodSync(path.join(dir, "supabase"), 0o755);
  const containers = CONTAINERS.map(([id, name]) => `${id} ${name}`).join("\\n");
  const networks = NETWORKS.map(([id, name]) => `${id} ${name}`).join("\\n");
  const docker = `#!/usr/bin/env bash
echo "$*" >> "${dir}/dockercalls"
case "$1 $2" in
  "ps -a") printf '${containers}\\n'; exit 0;;
  "network ls") printf '${networks}\\n'; exit 0;;
  "rm -f") exit 0;;
  "network rm") exit 0;;
esac
exit 0
`;
  writeFileSync(path.join(dir, "docker"), docker);
  chmodSync(path.join(dir, "docker"), 0o755);
  writeFileSync(path.join(dir, "fakesleep"), `#!/usr/bin/env bash\necho "$1" >> "${dir}/sleeps"\n`);
  chmodSync(path.join(dir, "fakesleep"), 0o755);
}

function run() {
  const r = spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SUPABASE_START_SLEEP: path.join(dir, "fakesleep") },
  });
  const lines = (f: string) => (existsSync(path.join(dir, f)) ? readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean) : []);
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? ""), calls: lines("calls"), docker: lines("dockercalls"), sleeps: lines("sleeps") };
}

beforeEach(() => {
  dir = "";
});
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("(a) a Docker port-bind error once, then success", () => {
  it("exits 0 after a cleanup, one wait of 30 s, and says what it retried", () => {
    setup(["bind", "ok"]);
    const r = run();
    expect(r.code).toBe(0);
    expect(r.calls).toEqual(["start ", "stop --no-backup", "start "]);
    expect(r.sleeps).toEqual(["30"]);
    expect(r.out).toMatch(/port-bind/i);
    expect(r.out).toMatch(/succeeded on attempt 2 of 3/);
    expect(r.docker.some((c) => c.startsWith("rm -f"))).toBe(true);
  });

  it("the real log shape (throttled pulls first, then the bind error) is named for what it is, not as a registry rate limit", () => {
    setup(["bind-after-throttle", "ok"]);
    const r = run();
    expect(r.code).toBe(0);
    const warning = r.out.split("\n").find((l) => l.startsWith("::warning::")) ?? "";
    expect(warning).toMatch(/port-bind/i);
    expect(warning).not.toMatch(/registry rate limit/i);
    expect(r.docker.some((c) => c.startsWith("rm -f"))).toBe(true);
  });

  it("a bind error, then a registry throttle, then success: three attempts, both waits", () => {
    setup(["bind", "ratelimit", "ok"]);
    const r = run();
    expect(r.code).toBe(0);
    expect(r.sleeps).toEqual(["30", "60"]);
    expect(r.out).toMatch(/succeeded on attempt 3 of 3/);
  });
});

describe("(b) the registry rate-limit retry still works and does not touch Docker", () => {
  it("a throttle once: stop, wait 30 s, retry, succeed, and no docker call at all", () => {
    setup(["ratelimit", "ok"]);
    const r = run();
    expect(r.code).toBe(0);
    expect(r.calls).toEqual(["start ", "stop --no-backup", "start "]);
    expect(r.sleeps).toEqual(["30"]);
    expect(r.out).toMatch(/rate limit/i);
    expect(r.docker).toEqual([]);
  });
});

describe("(c) any other error still exits at once", () => {
  it.each([
    ["a port that is already allocated", "other-port", 7],
    ["a config error", "other-config", 2],
    ["a near-miss of the bind text (another message that also says address already in use)", "near-miss", 5],
  ] as const)("%s: the CLI's exit code, one attempt, no cleanup, no wait, no docker call", (_label, step, exit) => {
    setup([step, "ok"], exit);
    const r = run();
    expect(r.code).toBe(exit);
    expect(r.calls).toEqual(["start "]);
    expect(r.sleeps).toEqual([]);
    expect(r.docker).toEqual([]);
    expect(r.out).toMatch(/not retried/i);
  });

  it("after a bind error, a different error on attempt 2 also stops there", () => {
    setup(["bind", "other-config", "ok"], 3);
    const r = run();
    expect(r.code).toBe(3);
    expect(r.calls.filter((c) => c.startsWith("start")).length).toBe(2);
  });
});

describe("(d) three bind errors in a row", () => {
  it("is a non-zero exit with a clear message, after exactly three attempts and the same waits", () => {
    setup(["bind", "bind", "bind", "ok"]);
    const r = run();
    expect(r.code).not.toBe(0);
    expect(r.calls.filter((c) => c.startsWith("start")).length).toBe(3);
    expect(r.calls.filter((c) => c.startsWith("stop")).length).toBe(2);
    expect(r.sleeps).toEqual(["30", "60"]);
    expect(r.out).toMatch(/port-bind/i);
    expect(r.out).toMatch(/all 3 attempts/i);
    expect(r.out).toMatch(/::error::/);
  });
});

describe("(e) the cleanup removes only supabase_* containers and supabase_network_* networks", () => {
  it("removes exactly c1 and c2 and the one stack network, by id, and nothing else", () => {
    setup(["bind", "ok"]);
    const r = run();
    expect(r.code).toBe(0);
    const rm = r.docker.filter((c) => c.startsWith("rm "));
    const removed = rm.flatMap((c) => c.split(/\s+/).slice(1).filter((a) => !a.startsWith("-")));
    expect(removed.sort()).toEqual(["c1", "c2"]);
    const netRm = r.docker.filter((c) => c.startsWith("network rm"));
    const removedNets = netRm.flatMap((c) => c.split(/\s+/).slice(2).filter((a) => !a.startsWith("-")));
    expect(removedNets).toEqual(["n1"]);
  });

  it("runs only read-only listings and those two removals: no prune, no stop, no kill, no system command, no other container touched", () => {
    setup(["bind", "ok"]);
    const r = run();
    const verbs = new Set(r.docker.map((c) => c.split(/\s+/).slice(0, 2).join(" ")));
    for (const v of verbs) expect(["ps -a", "network ls", "rm -f", "network rm"], v).toContain(v);
    expect(r.docker.join("\n")).not.toMatch(/prune|kill|\bstop\b|system|\brmi\b|volume/);
    for (const keep of ["c3", "c4", "c5", "c6", "n2", "n3", "n4", "n5"]) expect(r.docker.join(" ").split(/\s+/), keep).not.toContain(keep);
  });

  it("with nothing of ours to remove it removes nothing and still retries", () => {
    setup(["bind", "ok"]);
    // an empty listing: the fake prints nothing for ps / network ls
    writeFileSync(path.join(dir, "docker"), `#!/usr/bin/env bash\necho "$*" >> "${dir}/dockercalls"\nexit 0\n`);
    chmodSync(path.join(dir, "docker"), 0o755);
    const r = run();
    expect(r.code).toBe(0);
    expect(r.docker.filter((c) => c.startsWith("rm ") || c.startsWith("network rm"))).toEqual([]);
  });
});

describe("the script stays in its lane", () => {
  const script = readFileSync(SCRIPT, "utf8");
  it("keeps three attempts and the waits 30 and 60", () => {
    expect(script).toMatch(/^MAX_ATTEMPTS=3$/m);
    expect(script).toMatch(/^WAITS=\(30 60\)$/m);
  });
  it("holds no secret and no registry login", () => {
    expect(script).not.toMatch(/secrets\.|docker login|ecr get-login|AWS_/);
  });
});
