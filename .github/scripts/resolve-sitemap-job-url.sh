#!/usr/bin/env bash
#
# Resolves a real, currently-live /jobs/<uuid> URL from a Vercel preview's
# own sitemap.xml — pulled out of lighthouse-budget.yml so it can be unit
# tested (.github/scripts/test-resolve-sitemap-job-url.sh) with a stubbed
# curl, rather than only ever exercised for real inside a full CI run.
#
# Usage: resolve-sitemap-job-url.sh <preview-url>
#   VERCEL_AUTOMATION_BYPASS_SECRET must be set in the environment.
# On success, prints "job_url=<url>" to stdout and exits 0.
# On failure, prints an "::error::..." diagnostic to stdout and exits 1.
#
# `set +e`, not just `-uo pipefail`: GitHub Actions runs every `run:` block
# as `bash -e {0}`, and this script is meant to be safe to invoke directly
# under that same `-e` (the test below does exactly that) — without `+e`,
# a `grep | head` pipeline that "fails" under `pipefail` (no match) would
# kill the script via -e before the intended `if [ -z "$JOB_URL" ]` check
# ever ran, exactly the bug this script's own extraction was fixing.
set +e -uo pipefail

PREVIEW_URL="${1:?usage: resolve-sitemap-job-url.sh <preview-url>}"

CURL_STDERR_FILE=$(mktemp)
RESPONSE=$(curl -sS "$PREVIEW_URL/sitemap.xml" \
  -H "x-vercel-protection-bypass: ${VERCEL_AUTOMATION_BYPASS_SECRET:-}" \
  -w '\n%{http_code}' 2>"$CURL_STDERR_FILE")
CURL_EXIT=$?
CURL_STDERR=$(cat "$CURL_STDERR_FILE")
rm -f "$CURL_STDERR_FILE"

# A genuine network-level failure (DNS, connection refused, timeout, TLS)
# never reaches the -w status line at all — curl's own stderr (captured
# above, previously discarded) is the only diagnostic that exists for it.
if [ "$CURL_EXIT" -ne 0 ]; then
  echo "::error::curl could not reach $PREVIEW_URL/sitemap.xml (exit code $CURL_EXIT): $CURL_STDERR"
  exit 1
fi

STATUS=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')
if [ "$STATUS" != "200" ]; then
  echo "::error::sitemap.xml request failed with HTTP $STATUS. First 500 chars of response: $(echo "$BODY" | head -c 500)"
  exit 1
fi

JOB_URL=$(echo "$BODY" | grep -oE 'https://[^<]*/jobs/[0-9a-f-]{36}' | head -1)
if [ -z "$JOB_URL" ]; then
  echo "::error::No /jobs/<uuid> URL found in the preview's sitemap.xml — cannot pick a job detail page to audit."
  exit 1
fi

echo "job_url=$JOB_URL"
