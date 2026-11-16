#!/usr/bin/env bash
# Start the local Supabase stack, retrying ONLY for the two failures that were seen on shared runners; anything else fails fast.
#
# WHY. `supabase start` pulls about twelve images in parallel from AWS ECR Public (public.ecr.aws/supabase/*). Anonymous pulls from
# shared runner IPs are rate limited: on #689, #696 and #698 every pull was refused within a second ("toomanyrequests: Rate exceeded")
# and the job died, each passing on its one rerun. A retry is the cheap fix (no secret, no cache); see tests/ci/supabase-start-retry.test.ts.
#
# A SECOND FAILURE, seen on runs 43755341931, 43759233492 and 43767632112 (reports/S2/2026-11-15-docker-net-error-lines.md). The throttled pulls were
# retried by the CLI and all succeeded; the job then died when Docker started the database container:
#   ... failed to set up container networking: driver failed programming external connectivity on endpoint supabase_db_...: failed to bind host port 0.0.0.0:54322/tcp: address already in use
# Because attempt 1's output also held "Rate exceeded", this script called it a registry rate limit, cleaned up with `supabase stop` and retried; attempt 2 hit the same bind error,
# which has no throttle text, and failed fast. The logs do not say what holds the port. So a bind error is now its own retryable class, named for what it is, and its cleanup goes
# further than `supabase stop`: it removes leftover containers named supabase_* and networks named supabase_network_* (nothing else), and prints what is running and what listens
# on the port, so that the next failure says what held it.
#
# THE RULES.
#  - Retry ONLY if the output shows a Docker port-bind error ("failed to set up container networking" and "address already in use" on one line) or "toomanyrequests" / "Rate exceeded".
#    The bind error is checked first: it is the cause when both are present. Any other failure fails fast with the CLI's own exit code (a port "already allocated", a bad config, ...).
#  - Between tries: `supabase stop --no-backup`, for a bind error also the extra cleanup above, then wait 30 s, then 60 s. Three attempts in all.
#  - The log says which attempt succeeded, so the frequency of each failure shows up in the job logs.
#
# SUPABASE_START_SLEEP exists so the tests can record the waits instead of sleeping; CI never sets it.
set -uo pipefail

MAX_ATTEMPTS=3
WAITS=(30 60)
SLEEP_CMD="${SUPABASE_START_SLEEP:-sleep}"

BIND_RE='failed to set up container networking.*address already in use'
THROTTLE_RE='toomanyrequests|Rate exceeded'

# Prints what is running and what listens on the port (read-only), so a repeat of the bind error can be explained from the log.
diagnose_port() {
  local log="$1" port
  port="$(grep -oE 'bind host port [0-9.]+:[0-9]+' "$log" | head -1 | sed 's/.*://')"
  echo "::group::port-bind diagnostics (port ${port:-unknown})"
  if command -v docker >/dev/null 2>&1; then
    docker ps -a --format '{{.ID}} {{.Names}} {{.Status}} {{.Ports}}' 2>&1 || true
  fi
  if [ -n "$port" ] && command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :${port}" 2>&1 || true
  fi
  echo "::endgroup::"
}

# Removes leftovers of the stack and nothing else: containers whose name starts with supabase_, networks whose name starts with supabase_network_. By id, never a prune.
cleanup_stack_docker() {
  command -v docker >/dev/null 2>&1 || return 0
  local id name
  local containers=() networks=()
  while read -r id name; do
    case "$name" in supabase_*) containers+=("$id") ;; esac
  done < <(docker ps -a --format '{{.ID}} {{.Names}}' 2>/dev/null)
  if [ "${#containers[@]}" -gt 0 ]; then
    docker rm -f "${containers[@]}" >/dev/null 2>&1 || true
  fi
  while read -r id name; do
    case "$name" in supabase_network_*) networks+=("$id") ;; esac
  done < <(docker network ls --format '{{.ID}} {{.Name}}' 2>/dev/null)
  if [ "${#networks[@]}" -gt 0 ]; then
    docker network rm "${networks[@]}" >/dev/null 2>&1 || true
  fi
}

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

  if grep -qE "$BIND_RE" "$log"; then
    kind="bind"
    label="Docker port-bind clash (address already in use)"
  elif grep -qiE "$THROTTLE_RE" "$log"; then
    kind="throttle"
    label="registry rate limit"
  else
    echo "::error::supabase start failed (exit ${code}) and the output is not a registry rate limit or a Docker port-bind clash, so it is not retried"
    rm -f "$log"
    exit "$code"
  fi

  if [ "$kind" = "bind" ]; then
    diagnose_port "$log"
  fi
  rm -f "$log"

  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    if [ "$kind" = "bind" ]; then
      echo "::error::supabase start failed with a ${label} on all ${MAX_ATTEMPTS} attempts"
    else
      echo "::error::supabase start was rate limited by the image registry on all ${MAX_ATTEMPTS} attempts"
    fi
    exit "$code"
  fi

  wait_s="${WAITS[$((attempt - 1))]}"
  echo "::warning::${label} on attempt ${attempt} of ${MAX_ATTEMPTS}: cleaning up, then waiting ${wait_s}s"
  supabase stop --no-backup >/dev/null 2>&1 || true
  if [ "$kind" = "bind" ]; then
    cleanup_stack_docker
  fi
  "$SLEEP_CMD" "$wait_s"
  attempt=$((attempt + 1))
done
