#!/usr/bin/env bash
#
# Proves resolve-sitemap-job-url.sh actually reports its failures instead
# of dying silently — the exact regression this script's own extraction
# (from lighthouse-budget.yml) exists to make testable. Every scenario
# below runs the script with `bash -e`, matching GitHub Actions' own
# invocation of a `run:` block (`shell: /usr/bin/bash -e {0}`, confirmed
# from a real failing run's log) — that -e is what silently killed the
# original inline script the moment a `grep | head` pipeline found no
# match, before its own intended `::error::` line could print. If this
# test is ever run WITHOUT `bash -e` and still passes, it is not actually
# proving anything about that failure mode.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/resolve-sitemap-job-url.sh"
FAKE_BIN_DIR=$(mktemp -d)
trap 'rm -rf "$FAKE_BIN_DIR"' EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

# A bare `OUTPUT=$(cmd)` under this test's own `set -e` has the identical
# footgun this whole test exists to catch in the script under test: if
# `cmd` exits non-zero, the assignment itself trips -e and kills the test
# right here, before STATUS=$? can ever run. Wrapping the assignment as an
# `if` condition is the standard, correct way to capture a command's own
# exit status without -e treating that capture as a failure — see bash(1)
# on which command forms -e does not apply to.
run_script() {
  if OUTPUT=$(PATH="$FAKE_BIN_DIR:$PATH" bash -e "$SCRIPT" "https://example-preview.vercel.app" 2>&1); then
    STATUS=0
  else
    STATUS=$?
  fi
}

# --- Scenario 1: HTTP 404 (non-200) ----------------------------------------
cat > "$FAKE_BIN_DIR/curl" <<'EOF'
#!/usr/bin/env bash
printf 'not found\n404'
EOF
chmod +x "$FAKE_BIN_DIR/curl"

run_script

[ "$STATUS" -eq 1 ] || fail "scenario 1 (HTTP 404): expected exit 1, got $STATUS"
echo "$OUTPUT" | grep -q "::error::sitemap.xml request failed with HTTP 404" \
  || fail "scenario 1 (HTTP 404): expected diagnostic missing. Got: $OUTPUT"
echo "PASS: scenario 1 (HTTP 404) — reports the real status, exit 1"

# --- Scenario 2: HTTP 200, but no /jobs/<uuid> URL in the body -------------
# This is the exact shape of the original bug: a sitemap with real content
# but nothing matching the job-URL pattern (e.g. every dynamic section
# degraded to empty). Under the OLD inline script (bash -e, no `set +e`),
# this scenario killed the step with zero output — see this repo's own
# CLAUDE.md entry on the incident this script was extracted to fix.
cat > "$FAKE_BIN_DIR/curl" <<'EOF'
#!/usr/bin/env bash
printf '<urlset><url><loc>https://example.com/about</loc></url></urlset>\n200'
EOF
chmod +x "$FAKE_BIN_DIR/curl"

run_script

[ "$STATUS" -eq 1 ] || fail "scenario 2 (no job URL): expected exit 1, got $STATUS — this is exactly the silent-exit-1 regression"
echo "$OUTPUT" | grep -q "::error::No /jobs/<uuid> URL found" \
  || fail "scenario 2 (no job URL): expected diagnostic missing (silent failure). Got: $OUTPUT"
echo "PASS: scenario 2 (200, no job URL) — reports the real cause, exit 1, not a silent death"

# --- Scenario 3: curl itself fails (network-level, no HTTP response) -------
cat > "$FAKE_BIN_DIR/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl: (6) Could not resolve host: example-preview.vercel.app" >&2
exit 6
EOF
chmod +x "$FAKE_BIN_DIR/curl"

run_script

[ "$STATUS" -eq 1 ] || fail "scenario 3 (curl network failure): expected exit 1, got $STATUS"
echo "$OUTPUT" | grep -q "::error::curl could not reach" \
  || fail "scenario 3 (curl network failure): expected diagnostic missing. Got: $OUTPUT"
echo "$OUTPUT" | grep -q "Could not resolve host" \
  || fail "scenario 3 (curl network failure): curl's own stderr was not included. Got: $OUTPUT"
echo "PASS: scenario 3 (curl network failure) — curl's own stderr is captured, not discarded"

# --- Scenario 4: success path, unaffected by the +e fix --------------------
JOB_ID="9ae0f6be-8063-4227-95f6-ab21ccb13993"
cat > "$FAKE_BIN_DIR/curl" <<EOF
#!/usr/bin/env bash
printf '<urlset><url><loc>https://example.com/jobs/$JOB_ID</loc></url></urlset>\n200'
EOF
chmod +x "$FAKE_BIN_DIR/curl"

run_script

[ "$STATUS" -eq 0 ] || fail "scenario 4 (success): expected exit 0, got $STATUS. Got: $OUTPUT"
echo "$OUTPUT" | grep -q "job_url=https://example.com/jobs/$JOB_ID" \
  || fail "scenario 4 (success): expected job_url output missing. Got: $OUTPUT"
echo "PASS: scenario 4 (success) — resolves the real job URL, exit 0"

echo ""
echo "All scenarios passed."
