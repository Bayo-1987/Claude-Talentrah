#!/usr/bin/env python3
"""Tally a flaky test across CI first attempts, bucketed by whether the tested commit contained a given fix.

READS ONLY PUBLIC CI DATA of this (public) repository through the GitHub CLI (`gh api`). It holds no token and
writes nothing; `gh` uses the caller's own login purely for rate limits.

    python3 scripts/ci-flake-tally.py --since 2026-09-30T13:37:34Z --until 2026-10-02T13:37:34Z --fix-sha 03df723169490013a1479a5641f143d5c804211d

What is counted
  * every `ci.yml` run created in [since, until] on `main` (event `push`) and on PRs (event `pull_request`);
    `workflow_dispatch` runs are excluded;
  * FIRST ATTEMPTS ONLY (attempt 1 of the `Typecheck, lint, unit tests` job) — a re-run only happens after a failure,
    so counting re-runs would bias the rate upward;
  * A = first-attempt unit jobs that completed (success or failure);
    B = those that REACHED the unit tests (the `Unit tests (Vitest)` step ran) — a job that died earlier (e.g. in
    `Build app`) cannot fail the test;
  * a failure = the job's own log contains `FAIL <test-file>`.

Which commit a job actually tested
  * `push`: the pushed commit (`head_sha`);
  * `pull_request`: this workflow's `actions/checkout` fetches `refs/pull/N/merge`, i.e. the MERGE of the PR head into the
    base at trigger time. The checkout step's log names all three: `Merge <head> into <base>`. The merge contains the fix
    iff the PR head OR the base contains it (an ancestor of a merge is an ancestor of one of its parents).
  Containment is tested with GitHub's compare API (`compare/<fix>...<sha>`: `ahead`/`identical` = <sha> contains <fix>,
  `behind`/`diverged` = it does not), which is `git merge-base --is-ancestor` evaluated server-side, so it also works for
  PR-head commits that are not on any branch of a local clone. Verify against a local clone with
  `git merge-base --is-ancestor <fix> <sha>` for any commit that is fetchable.

Three modes (`--mode`):
  * `test` (default): count jobs whose log has `FAIL <--test file>` — the refresh-job tally;
  * `pool`: count jobs whose unit-job log has a failure block of one of the test-user-pool classes below. Counted over the
    unit job's own log only (not the e2e job's), one count per job however many blocks match, so the `##[error]`
    repeats at the end of a log and a failing test that quotes a class name in its message are not double-counted:
      drained               `drained the entire pool` (claimUntilTarget, the pre-#602 drain)
      claim-user-not-found  `user_not_found` / `User not found` with a `claimFromPool` frame (updateUserById on a deleted user)
      claim-retryable       `AuthRetryableFetchError` with a `claimFromPool` or `createAuthedTestUser` frame
      resumes-fkey          `resumes_user_id_fkey` (a fixture user deleted under its file's setup)
    A block is a vitest `FAIL …` entry up to the next `FAIL` or `⎯⎯⎯` rule. `--classify-pool` reads a log on stdin and prints
    the classes as JSON (used by tests/scripts/ci-flake-tally.test.ts against real log snippets).
  * `font`: count jobs whose log has the `next/font/google` build failure (#585): the Turbopack error
    `Can't resolve '@vercel/turbopack-next/internal/font/google/font'`. Both the `Typecheck, lint, unit tests` job and the
    `Playwright e2e` job build the app on their own, so BOTH are counted (each first attempt is one observation).
    A = first-attempt jobs of those two names that completed; B = those that REACHED the `Build app` step (a job that never
    got there cannot fail it). `--classify-font` reads a log on stdin and prints `{"font-build": N}`.
  `--exclude-branch` drops runs of a head branch before counting, and says how many: use it for a PR that deliberately
  contains red-state tests (#602's own first runs), so they are not read as baseline failures.

Buckets: `with-fix` (tested commit contains --fix-sha), `without-fix`, and `unknown` (the tested commit could not be
determined or compared — reported separately, never silently folded into either).

Per bucket it prints A, B, failures with a Wilson 95% interval, the failing runs, and the counts of two diagnostic log
lines from the refresh job (`[match-score-refresh] recovered`, `could not verify stale postings` = "URI too long"). When
there are 0 failures it prints the rule-of-three upper bound (3/N) and says whether that bound sits below --baseline-lower.
"""
import argparse
import concurrent.futures as cf
import io
import json
import re
import subprocess
import sys
import zipfile

UNIT = "Typecheck, lint, unit tests"


def api(path):
    r = subprocess.run(["gh", "api", path], capture_output=True, text=True)
    try:
        return json.loads(r.stdout)
    except Exception:
        return {}


def wilson(k, n, z=1.96):
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    m = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5)
    return ((c - m) / d, (c + m) / d)


class Contains:
    """Does <sha> contain the fix commit? Cached compare-API lookups; None when it cannot be determined."""

    def __init__(self, repo, fix):
        self.repo, self.fix, self.cache = repo, fix, {}

    def __call__(self, sha):
        if sha not in self.cache:
            st = api(f"repos/{self.repo}/compare/{self.fix}...{sha}").get("status")
            self.cache[sha] = None if st is None else st in ("ahead", "identical")
        return self.cache[sha]


FONT_BUILD_SIGNATURE = re.compile(r"Can't resolve '@vercel/turbopack-next/internal/font/google/font'")
E2E = "Playwright e2e"


def classify_font_build_failure(log_text):
    """{"font-build": N} where N counts the Turbopack font-resolve errors in the log; empty when there are none."""
    n = len(FONT_BUILD_SIGNATURE.findall(_ANSI.sub("", log_text)))
    return {"font-build": n} if n else {}


POOL_CLASSES = ("drained", "claim-user-not-found", "claim-retryable", "resumes-fkey")
_TS = re.compile(r"^\d{4}-\d\d-\d\dT[\d:.]+Z ?")
_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def pool_blocks(log_text):
    """Vitest failure blocks of a log: lists of lines, from a `FAIL` header to the next header or `⎯⎯⎯` rule."""
    lines = [_TS.sub("", _ANSI.sub("", l)) for l in log_text.splitlines()]
    blocks, cur = [], None
    for l in lines:
        if l.startswith("##[error]"):
            continue  # the log repeats every failure here; counting it would double every block
        if re.match(r"\s*FAIL\s+\S", l):
            cur = [l]
            blocks.append(cur)
        elif cur is not None and "⎯⎯⎯" in l:
            cur = None
        elif cur is not None:
            cur.append(l)
    return blocks


def classify_pool_failures(log_text):
    """{class: number of failure blocks} for the test-user-pool classes; empty when the log has none."""
    found = {}
    for b in pool_blocks(log_text):
        text = "\n".join(b)
        frames = "\n".join(l for l in b if re.match(r"\s*❯\s", l))
        hit = []
        if "drained the entire pool" in text:
            hit.append("drained")
        if re.search(r"user_not_found|User not found", text) and "claimFromPool" in frames:
            hit.append("claim-user-not-found")
        if "AuthRetryableFetchError" in text and re.search(r"claimFromPool|createAuthedTestUser", frames):
            hit.append("claim-retryable")
        if "resumes_user_id_fkey" in text:
            hit.append("resumes-fkey")
        for c in hit:
            found[c] = found.get(c, 0) + 1
    return found


def tested_commits(run, log_text):
    """Return (kind, [shas whose union is what the job tested]) — one sha for push, head+base for a PR merge ref."""
    if run["event"] == "push":
        return "push", [run["head_sha"]]
    m = re.search(r"Merge ([0-9a-f]{40}) into ([0-9a-f]{40})", log_text)
    if m:
        return "pull_request", [m.group(1), m.group(2)]
    return "pull_request", []


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--since")
    ap.add_argument("--until")
    ap.add_argument("--fix-sha")
    ap.add_argument("--mode", choices=("test", "pool", "font"), default="test")
    ap.add_argument("--classify-font", action="store_true", help="read a log on stdin, print its font-build failure count as JSON, exit")
    ap.add_argument("--classify-pool", action="store_true", help="read a log on stdin, print its pool failure classes as JSON, exit")
    ap.add_argument("--exclude-branch", action="append", default=[], help="drop runs of this head branch before counting (repeatable)")
    ap.add_argument("--repo", default="Bayo-1987/Claude-Talentrah")
    ap.add_argument("--test", default="tests/matching/refresh-job.test.ts", help="test file whose `FAIL` lines are counted")
    ap.add_argument("--baseline-lower", type=float, default=None,
                    help="lower 95%% bound (percent) of the pre-fix rate; defaults to 9.1 in --mode test (the refresh-job baseline) "
                         "and is required in --mode pool to get a verdict")
    a = ap.parse_args()
    if a.classify_pool:
        print(json.dumps(classify_pool_failures(sys.stdin.read()), sort_keys=True))
        return 0
    if a.classify_font:
        print(json.dumps(classify_font_build_failure(sys.stdin.read()), sort_keys=True))
        return 0
    if not (a.since and a.until and a.fix_sha):
        ap.error("--since, --until and --fix-sha are required")
    if a.baseline_lower is None and a.mode == "test":
        a.baseline_lower = 9.1

    runs = []
    for page in range(1, 15):
        d = api(f"repos/{a.repo}/actions/workflows/ci.yml/runs?per_page=100&page={page}&created={a.since}..{a.until}")
        rs = d.get("workflow_runs", [])
        runs += rs
        if len(rs) < 100:
            break
    runs = [r for r in runs if r["event"] in ("push", "pull_request")]
    if a.exclude_branch:
        kept = [r for r in runs if r["head_branch"] not in a.exclude_branch]
        print(f"excluded {len(runs) - len(kept)} run(s) of head branch(es) {a.exclude_branch}")
        runs = kept
    print(f"window {a.since} .. {a.until}: {len(runs)} CI runs (push + pull_request); fix commit {a.fix_sha[:8]}")

    jobs = []
    for r in runs:
        for j in api(f"repos/{a.repo}/actions/runs/{r['id']}/attempts/1/jobs?per_page=50").get("jobs", []):
            wanted = (UNIT, E2E) if a.mode == "font" else (UNIT,)
            if j["name"] in wanted and j["conclusion"] in ("success", "failure"):
                step = "Build app" if a.mode == "font" else "Unit tests (Vitest)"
                reached = any(s["name"] == step and s["conclusion"] in ("success", "failure") for s in j["steps"])
                jobs.append((r, j, reached))

    fail_re = re.compile(r"FAIL\s+" + re.escape(a.test))

    def scan(x):
        r, j, reached = x
        z = subprocess.run(["gh", "api", f"repos/{a.repo}/actions/runs/{r['id']}/attempts/1/logs"], capture_output=True)
        try:
            zz = zipfile.ZipFile(io.BytesIO(z.stdout))
        except Exception:
            return (x, None)
        if a.mode == "pool":
            # the unit job's own log only: the e2e job's log is a different population
            names = [n for n in zz.namelist() if n.endswith(".txt") and "/" not in n and UNIT in n]
        elif a.mode == "font":
            names = [n for n in zz.namelist() if n.endswith(".txt") and "/" not in n and j["name"] in n]
        else:
            names = [n for n in zz.namelist() if n.endswith(".txt")]
        t = "".join(re.sub(r"\x1b\[[0-9;]*m", "", zz.read(n).decode("utf8", "ignore")) for n in names)
        classes = classify_pool_failures(t) if a.mode == "pool" else (classify_font_build_failure(t) if a.mode == "font" else {})
        return (x, {
            "fail": bool(classes) if a.mode in ("pool", "font") else bool(fail_re.search(t)),
            "classes": classes,
            "recovered": len(re.findall(r"\[match-score-refresh\] recovered", t)),
            "uri": len(re.findall(r"could not verify stale postings", t)),
            "tested": tested_commits(r, t),
        })

    with cf.ThreadPoolExecutor(6) as ex:
        scanned = list(ex.map(scan, jobs))

    contains = Contains(a.repo, a.fix_sha)
    buckets = {"with-fix": [], "without-fix": [], "unknown": []}
    for x, v in scanned:
        if v is None:
            buckets["unknown"].append((x, {"fail": False, "classes": {}, "recovered": 0, "uri": 0, "why": "log unavailable"}))
            continue
        kind, shas = v["tested"]
        verdicts = [contains(s) for s in shas]
        if not shas or any(c is None for c in verdicts):
            v["why"] = "tested commit undeterminable" if not shas else "compare failed"
            buckets["unknown"].append((x, v))
        else:
            buckets["with-fix" if any(verdicts) else "without-fix"].append((x, v))

    label_name = {"pool": "pool-class failure (" + ", ".join(POOL_CLASSES) + ")", "font": "font-build failure (Build app)"}.get(a.mode, a.test)
    for name in ("with-fix", "without-fix", "unknown"):
        items = buckets[name]
        A = len(items)
        B = sum(1 for (r, j, reached), _ in items if reached)
        k = sum(1 for _, v in items if v["fail"])
        print(f"\n== bucket: {name}")
        print(f"   first-attempt unit jobs completed (A) = {A}; reached the unit tests (B) = {B}")
        for label, n in (("A", A), ("B", B)):
            if n:
                lo, hi = wilson(k, n)
                print(f"   {label_name}: {k} failing job(s) of {label}={n} = {100*k/n:.1f}%  (Wilson 95% CI {100*lo:.1f}%-{100*hi:.1f}%)")
        if k == 0 and B:
            ub = min(100.0, 300.0 / B)
            if a.baseline_lower is None:
                print(f"   0 failures: rule-of-three upper bound ~ 3/B = {ub:.1f}% (no --baseline-lower given, so no verdict; "
                      f"'fixed' needs this bound to sit clearly below the pre-fix rate's lower bound)")
            else:
                side = "BELOW" if ub < a.baseline_lower else "NOT below"
                print(f"   0 failures: rule-of-three upper bound ~ 3/B = {ub:.1f}%  -> {side} the baseline lower bound {a.baseline_lower}%"
                      + ("" if ub < a.baseline_lower else "  (N too small to call it fixed)"))
        for (r, j, reached), v in sorted(items, key=lambda i: i[0][1]["started_at"]):
            if v["fail"]:
                cl = f" classes={sorted(v['classes'])}" if a.mode in ("pool", "font") else ""
                print(f"   FAILED first attempt: {j['started_at'][:16]}Z run {r['id']} job {j['id']} ({j['name']}) {r['event']} {r['head_branch']}{cl}")
        if a.mode == "pool":
            for c in POOL_CLASSES:
                ids = [r["id"] for (r, j, _), v in items if v["classes"].get(c)]
                print(f"   class {c}: {len(ids)} job(s) {ids}")
        elif a.mode == "font":
            for jn in (UNIT, E2E):
                sub = [(it, v) for it, v in items if it[1]["name"] == jn]
                print(f"   {jn}: A={len(sub)} B(reached Build app)={sum(1 for (r, j, rc), _ in sub if rc)} failures={sum(1 for _, v in sub if v['fail'])}")
        else:
            rec = [(r["id"], v["recovered"]) for (r, j, _), v in items if v["recovered"]]
            uri = [(r["id"], v["uri"]) for (r, j, _), v in items if v["uri"]]
            print(f"   '[match-score-refresh] recovered' lines: {sum(n for _, n in rec)} in {len(rec)} job(s) {[r for r, _ in rec]}")
            print(f"   'could not verify stale postings' (URI too long) lines: {sum(n for _, n in uri)} in {len(uri)} job(s) {[r for r, _ in uri]}")
        if name == "unknown":
            for (r, j, _), v in items:
                print(f"   unknown: run {r['id']} job {j['id']} ({v.get('why')})")


if __name__ == "__main__":
    sys.exit(main())
