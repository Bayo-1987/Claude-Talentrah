#!/usr/bin/env bash
#
# Resolves a real, currently-live /jobs/<uuid> URL from a Vercel preview's
# own sitemap.xml — pulled out of lighthouse-budget.yml so it can be unit
# tested (.github/scripts/test-resolve-sitemap-job-url.sh) with a stubbed
# curl, rather than only ever exercised for real inside a full CI run.
#
# Usage: resolve-sitemap-job-url.sh <preview-url>
#   VERCEL_AUTOMATION_BYPASS_SECRET must be set in the environment.
# On success, prints "job_url=<url>" and "landing_url=<url>" to stdout and exits 0. Both are built from <preview-url>, never from the host the
# sitemap prints.
#   landing_url is the preview's own /jobs/remote when the preview's sitemap lists it, and the static /about page otherwise. The sitemap lists
#   /jobs/remote only when the page itself would render (it needs LANDING_PAGE_MIN_ENTRIES remote jobs), and a preview reads a small test
#   database that can fall below that, so a hardcoded /jobs/remote could 404 for a reason unrelated to the PR. It is always built from the
#   PREVIEW's own host: the sitemap prints the site's canonical origin, which is not necessarily the preview.
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

JOB_PATH=$(echo "$BODY" | grep -oE 'https://[^<]*/jobs/[0-9a-f-]{36}' | head -1 | grep -oE '/jobs/[0-9a-f-]{36}$')
if [ -z "$JOB_PATH" ]; then
  echo "::error::No /jobs/<uuid> URL found in the preview's sitemap.xml — cannot pick a job detail page to audit."
  exit 1
fi

if echo "$BODY" | grep -qE '<loc>[^<]*/jobs/remote</loc>'; then
  LANDING_URL="$PREVIEW_URL/jobs/remote"
else
  LANDING_URL="$PREVIEW_URL/about"
fi

# Built from the PREVIEW's host, like landing_url: the sitemap prints the site's canonical origin (the production host unless the preview sets its
# own site URL), so using the printed URL would audit production's copy of the job, not the preview's.
JOB_URL="$PREVIEW_URL$JOB_PATH"

echo "job_url=$JOB_URL"
echo "landing_url=$LANDING_URL"
