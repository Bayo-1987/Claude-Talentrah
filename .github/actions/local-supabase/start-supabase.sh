#!/usr/bin/env bash
# Start the local Supabase stack, retrying ONLY when the image registry throttles the pulls.
#
# WHY. `supabase start` pulls about twelve images in parallel from AWS ECR Public (public.ecr.aws/supabase/*). Anonymous pulls from
# shared runner IPs are rate limited: on #689, #696 and #698 every pull was refused within a second ("toomanyrequests: Rate exceeded")
# and the job died, each passing on its one rerun. A retry is the cheap fix (no secret, no cache); see tests/ci/supabase-start-retry.test.ts.
#
# THE RULES.
#  - Retry ONLY if the output shows "toomanyrequests" or "Rate exceeded". Any other failure fails fast with the CLI's own exit code.
#  - Between tries: clean up anything half-started (`supabase stop --no-backup`), then wait 30 s, then 60 s. Three attempts in all.
#  - The log says which attempt succeeded, so the frequency of the throttle shows up in the job logs.
#
# SUPABASE_START_SLEEP exists so the tests can record the waits instead of sleeping; CI never sets it.
set -uo pipefail

MAX_ATTEMPTS=3
WAITS=(30 60)
SLEEP_CMD="${SUPABASE_START_SLEEP:-sleep}"

attempt=1
while true; do
  log="$(mktemp)"
  supabase start 2>&1 | tee "$log"
  code="${PIPESTATUS[0]}"

  if [ "$code" -eq 0 ]; then
    echo "::notice::supabase start succeeded on attempt ${attempt} of ${MAX_ATTEMPTS}"
    rm -f "$log"
    exit 0
  fi

  if ! grep -qiE 'toomanyrequests|Rate exceeded' "$log"; then
    echo "::error::supabase start failed (exit ${code}) and the output is not a registry rate limit, so it is not retried"
    rm -f "$log"
    exit "$code"
  fi
  rm -f "$log"

  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo "::error::supabase start was rate limited by the image registry on all ${MAX_ATTEMPTS} attempts"
    exit "$code"
  fi

  wait_s="${WAITS[$((attempt - 1))]}"
  echo "::warning::registry rate limit on attempt ${attempt} of ${MAX_ATTEMPTS}: cleaning up, then waiting ${wait_s}s"
  supabase stop --no-backup >/dev/null 2>&1 || true
  "$SLEEP_CMD" "$wait_s"
  attempt=$((attempt + 1))
done
