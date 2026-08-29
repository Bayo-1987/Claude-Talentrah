#!/usr/bin/env bash
#
# Run the test suite ONLY when no CI run is in flight. Fails closed.
#
# WHY THIS EXISTS. Every suite in this repo hits the one shared CI Supabase
# project, and so does CI itself. Running locally while a CI run is live
# contaminates both: the local run sees state another run is mutating, and the
# CI run sees state this one is. That has produced, on identical code, full
# suites reporting 9, then 1, then 17 failures, with every implicated suite
# passing in isolation — and hours spent by two sessions hunting causes in
# diffs that were never involved.
#
# It is not that nobody knew. It was noticed three times, disclosed twice, and
# repeated anyway — including once by a command that PRINTED the queue state
# and then ran the suite regardless. A check whose result nothing depends on is
# decoration; the failure was not ignorance, it was a check that could not stop
# anything.
#
# So this gates. If the queue is not clear it exits non-zero and runs nothing.
#
#   npm run test:when-clear              # the whole suite
#   npm run test:when-clear -- tests/rls # or a subset, args pass through
#
# The override exists because there are real reasons to run anyway — a suite
# that touches no database, or a deliberate reproduction of contention. It has
# to be typed, so it cannot happen by drift:
#
#   ALLOW_CONCURRENT_CI=yes-i-mean-it npm run test:when-clear
#
set -euo pipefail

if [ "${ALLOW_CONCURRENT_CI:-}" = "yes-i-mean-it" ]; then
  echo "[test-when-clear] override set — running without checking the queue."
  exec npx vitest run "$@"
fi

if ! command -v gh >/dev/null 2>&1; then
  # Fail closed, not open. Not being able to SEE the queue is not evidence that
  # it is empty, and the whole point of this script is that it refuses when it
  # cannot be sure.
  echo "[test-when-clear] REFUSING: gh is not installed, so the CI queue cannot be checked." >&2
  echo "  Install gh, or override with ALLOW_CONCURRENT_CI=yes-i-mean-it if you are sure." >&2
  exit 1
fi

live=$(gh run list --limit 20 --json number,headBranch,status \
        --jq '.[] | select(.status != "completed") | "  #\(.number)  \(.status)  \(.headBranch)"' 2>/dev/null) || {
  echo "[test-when-clear] REFUSING: could not query the CI queue." >&2
  echo "  Override with ALLOW_CONCURRENT_CI=yes-i-mean-it if you are sure." >&2
  exit 1
}

if [ -n "$live" ]; then
  echo "[test-when-clear] REFUSING: CI runs are in flight against the shared project." >&2
  echo "$live" >&2
  echo "" >&2
  echo "  Wait for them to drain, or override with ALLOW_CONCURRENT_CI=yes-i-mean-it." >&2
  exit 1
fi

echo "[test-when-clear] queue is clear — running."
exec npx vitest run "$@"
