#!/bin/bash
# JOBS-LIFECYCLE-1, stage 1: two concurrent calls of public.job_posting_delete_unreferenced for the same closed row write ONE tombstone and delete it once (migration 0279).
#
#   DB_CONTAINER=<local db container> DB_NAME=<LOCAL scratch database with 0000..0279 applied> bash tests/sql/job-posting-lifecycle-delete.concurrency.sh
#
# Session A calls the function and holds its transaction open for 3 seconds; session B calls it for the same id one second later and has to wait on the row lock A took (FOR UPDATE), then finds the row
# gone. It COMMITS one fixture row and removes it (and its tombstone) again at the end, so run it only on a scratch database, never on a shared one. Exits non-zero on any failed claim.
set -u
C="${DB_CONTAINER:-supabase_db_Claude_Talentrah}"
D="${DB_NAME:?set DB_NAME to a LOCAL scratch database that has migration 0279 applied}"
sql() { docker exec -i "${C}" psql -U postgres -d "${D}" -v ON_ERROR_STOP=1 -At -q; }
fail() { echo "FAIL: $*"; echo "delete from public.job_posting_tombstones where job_id = '${ID:-00000000-0000-0000-0000-000000000000}'; delete from public.job_postings where id = '${ID:-00000000-0000-0000-0000-000000000000}';" | sql >/dev/null 2>&1; exit 1; }

ID="$(echo "insert into public.job_postings (source_type, title, company_name, description, dedup_fingerprint, status, closed_at, external_source) values ('external', 'Concurrency harness', 'Harness Co', 'd', 'harness-conc-' || gen_random_uuid(), 'closed', now() - interval '2 days', 'manual-harness') returning id;" | sql | head -1)"
[ -n "${ID}" ] || fail "could not create the fixture row"

# Session A: takes the lock, holds it, commits.
( printf "begin;\nselect 'A_DELETED=' || count(*) from public.job_posting_delete_unreferenced(array['%s'::uuid], now(), null);\nselect pg_sleep(3);\ncommit;\n" "${ID}" | sql > /tmp/lifecycle-conc-a.out 2>&1 ) &
A_PID=$!
sleep 1
# Session B: same id, started while A holds the row; it waits, then sees nothing to delete.
B_OUT="$(printf "select 'B_DELETED=' || count(*) from public.job_posting_delete_unreferenced(array['%s'::uuid], now(), null);\n" "${ID}" | sql 2>&1)"
wait "${A_PID}"
A_OUT="$(grep -h 'A_DELETED=' /tmp/lifecycle-conc-a.out)"

TOMBS="$(echo "select count(*) from public.job_posting_tombstones where job_id = '${ID}';" | sql | head -1)"
LEFT="$(echo "select count(*) from public.job_postings where id = '${ID}';" | sql | head -1)"
echo "${A_OUT} ${B_OUT} tombstones=${TOMBS} job_rows_left=${LEFT}"
[ "${A_OUT}" = "A_DELETED=1" ] || fail "session A should have deleted exactly one row (${A_OUT})"
[ "${B_OUT}" = "B_DELETED=0" ] || fail "session B should have deleted nothing (${B_OUT})"
[ "${TOMBS}" = "1" ] || fail "expected exactly one tombstone, found ${TOMBS}"
[ "${LEFT}" = "0" ] || fail "the job row is still there"
echo "delete from public.job_posting_tombstones where job_id = '${ID}';" | sql >/dev/null
echo "PASS: two concurrent calls, one delete, one tombstone"
