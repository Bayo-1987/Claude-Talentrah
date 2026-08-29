#!/usr/bin/env bash
#
# Serialise CI runs against the one shared Supabase project.
#
# WHY THIS EXISTS RATHER THAN `concurrency`. The workflow used
# `concurrency: { group: <constant>, cancel-in-progress: false }`, which does
# serialise correctly — but GitHub keeps only ONE pending run per group and
# CANCELS the rest, and it never re-creates them. So a PR's queued run is
# discarded whenever anything else queues behind it, and no check ever reports.
#
# That is not a nuisance, it is a verification hole: `gh pr checks` on such a
# PR lists only the Vercel entries, every one of them passes, and the PR looks
# green and is mergeable. Observed three times in one afternoon (PRs #50, #51,
# #53). Anyone merging on that signal merges untested code.
#
# So: `concurrency` is now per-ref with cancel-in-progress, which is the
# behaviour you actually want for superseded commits (the newer commit still
# runs), and cross-ref serialisation moves here — to a wait that BLOCKS instead
# of discarding.
#
# ORDERING, AND WHY THERE IS NO DEADLOCK. A run only ever waits for runs with a
# STRICTLY LOWER run number. The oldest run in the system therefore waits for
# nobody and always makes progress, and each run leaves in turn. Two runs can
# never wait on each other.
#
# The wait covers the WHOLE of every earlier run, not just its equivalent job.
# `checks` and `e2e` both touch the database and `e2e` runs after `checks`, so
# waiting only for another run's `checks` would let this run's `checks` overlap
# that run's `e2e`. Waiting for the run to be `completed` is what actually
# closes that.
#
# A SECOND WAY IN THAT THE ORDERING DOES NOT POLICE: A RERUN DOES NOT WAIT.
# (The first is MAX_WAIT_SECONDS below, which exits 0 rather than blocking
# forever — deliberate, and documented there.)
#
# `gh run rerun` re-executes the ORIGINAL run number: it increments
# run_ATTEMPT, not run_NUMBER, and the comparison below uses
# GITHUB_RUN_NUMBER. So the lower-number test admits a rerun immediately — it
# waits only for runs numbered below an id that predates everything currently
# queued. The deadlock argument is unaffected and still holds; what does not
# hold is the assumption that every run ENTERING the system is newer than the
# ones already in it. A rerun can start on top of a live run, and both will
# touch the shared project at once.
#
# Measured on 2026-08-29, same script, same day, the only variable being
# whether the attempt was a rerun:
#
#   run   attempts   attempt 1   rerun
#   #348      2         380s       0s
#   #351      2         520s       0s
#   #353      2         540s       0s
#   #352      1         380s       (never rerun)
#
# Every rerun acquired the lock instantly. Every first attempt waited six to
# nine minutes.
#
# WHAT IT ACTUALLY COST, stated narrowly because the wider claim is wrong. The
# rerun of #348 ran while #352 was still live and produced dirty-state failures
# — "expected length 1 but got 2", "expected 'active' to be 'lapsed'" — in
# suites its own diff never touched. Those results were void, and the expensive
# part is that nothing in the output said so.
#
# It did NOT cause the PR failures of that afternoon: #351's failure completed
# BEFORE the rerun acquired the lock, with the lock properly held. That one
# remains an unexplained flake. Do not let "the rerun explains it" settle in as
# the story — it explains one void run, which is quite enough reason to fix it.
#
# So: serialise reruns BY HAND, one at a time with nothing else in flight, or
# push an empty commit to get a fresh run number that queues properly. Read
# this not as a reason to distrust the ordering rule, but as the entrance it
# does not police.
set -euo pipefail

WORKFLOW_FILE="${WORKFLOW_FILE:-ci.yml}"
THIS_RUN="${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
THIS_NUMBER="${GITHUB_RUN_NUMBER:?GITHUB_RUN_NUMBER is required}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

# Beyond this, proceed anyway rather than blocking forever. A hung run must not
# take CI down with it; a warning plus a possibly-noisy run beats a queue that
# never drains. Comfortably longer than the slowest observed run (~10 min).
MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-1500}"
POLL_SECONDS="${POLL_SECONDS:-20}"

waited=0
while :; do
  # Older runs of this workflow that have not finished. `status` covers both
  # `in_progress` and `queued`; a queued older run still holds its place, and
  # jumping it would reintroduce the overlap this script prevents.
  blockers=$(
    gh api --paginate \
      "repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=100" \
      --jq ".workflow_runs[]
            | select(.status != \"completed\")
            | select(.id != ${THIS_RUN})
            | select(.run_number < ${THIS_NUMBER})
            | \"\(.run_number) \(.status) \(.head_branch)\"" 2>/dev/null || true
  )

  if [ -z "$blockers" ]; then
    echo "::notice::Shared-Supabase lock acquired after ${waited}s (run #${THIS_NUMBER})."
    exit 0
  fi

  if [ "$waited" -ge "$MAX_WAIT_SECONDS" ]; then
    echo "::warning::Waited ${waited}s for the shared-Supabase lock and gave up." \
         "Proceeding anyway — results may be affected by a concurrent run." \
         "Still unfinished:"
    echo "$blockers" | sed 's/^/  /'
    exit 0
  fi

  echo "Waiting ${POLL_SECONDS}s (${waited}s elapsed) — earlier runs still going:"
  echo "$blockers" | sed 's/^/  /'
  sleep "$POLL_SECONDS"
  waited=$((waited + POLL_SECONDS))
done
