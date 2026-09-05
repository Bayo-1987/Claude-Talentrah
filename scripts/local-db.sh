#!/usr/bin/env bash
#
# Give this checkout its own Supabase stack, and point .env.local at it.
#
# THE SAME SHAPE CI USES. .github/actions/local-supabase/action.yml runs
# `supabase start` then `supabase db reset` and exports the four connection
# variables; this does the same thing and writes them into .env.local instead of
# $GITHUB_ENV. Keeping the two in the same shape is the point — a local run that
# reproduces CI has to be running what CI ran.
#
# WHY A LOCAL RUN NEEDS THIS AT ALL. Three sessions work in this repo at once,
# and every local run reads .env.local. While that pointed at the one hosted
# project, those runs shared a database and deleted each other's fixtures. CI
# stopped sharing in #214; local runs had no equivalent until this.
#
# IDEMPOTENT. `supabase start` on an already-running stack is a no-op that still
# prints the connection details, and `supabase db reset` is the point — it
# replays every migration from scratch, so running this again is also how you
# get a clean database between suites.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v supabase >/dev/null 2>&1; then
  cat >&2 <<'MSG'

The Supabase CLI is not installed, and this needs it (and Docker running).

  macOS:  brew install supabase/tap/supabase
  other:  https://supabase.com/docs/guides/local-development

MSG
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running — 'supabase start' needs it. Start Docker and retry." >&2
  exit 1
fi

echo "→ starting the local Supabase stack (first run pulls images; later runs are quick)"
supabase start

echo "→ applying every migration from scratch"
supabase db reset

echo "→ writing connection details into .env.local"
STATUS_ENV="$(mktemp)"
trap 'rm -f "$STATUS_ENV"' EXIT
supabase status -o env > "$STATUS_ENV"
# shellcheck disable=SC1090
source "$STATUS_ENV"

[ -f .env.local ] || {
  echo "  (.env.local did not exist — creating it from .env.example)"
  cp .env.example .env.local
}

# Rewrite ONLY the four connection variables, in place, leaving every other
# line alone. A session's .env.local also holds API keys and DEMO_PASSWORD;
# clobbering the file to set a URL would be a rude way to lose them.
python3 - "$STATUS_ENV" <<'PY'
import os, re, sys

status = {}
with open(sys.argv[1]) as fh:
    for line in fh:
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            status[k.strip()] = v.strip().strip('"')

wanted = {
    "NEXT_PUBLIC_SUPABASE_URL": status.get("API_URL", ""),
    "NEXT_PUBLIC_SUPABASE_ANON_KEY": status.get("ANON_KEY", ""),
    "SUPABASE_SERVICE_ROLE_KEY": status.get("SERVICE_ROLE_KEY", ""),
    "SUPABASE_JWT_SECRET": status.get("JWT_SECRET", ""),
}
missing = [k for k, v in wanted.items() if not v]
if missing:
    sys.exit(f"supabase status did not report: {', '.join(missing)}")

lines = open(".env.local").read().splitlines()
seen = set()
out = []
for line in lines:
    m = re.match(r"\s*([A-Z0-9_]+)\s*=", line)
    key = m.group(1) if m else None
    if key in wanted:
        out.append(f"{key}={wanted[key]}")
        seen.add(key)
    else:
        out.append(line)

for key, value in wanted.items():
    if key not in seen:
        out.append(f"{key}={value}")

open(".env.local", "w").write("\n".join(out).rstrip("\n") + "\n")
print(f"  set {len(wanted)} variables; {len(lines)} existing lines preserved")
PY

echo
echo "✓ .env.local now points at your own stack: ${API_URL}"
echo "  Studio: ${STUDIO_URL:-http://127.0.0.1:54323}"
echo
echo "  Next:  npm run dev        (then 'npm run seed' for demo data)"
echo "         npm test           — every run prints which database it used"
echo
