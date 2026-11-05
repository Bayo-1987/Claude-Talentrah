# Admin jobs import (PR-U1)

An admin with the `jobs_import` permission uploads a CSV of jobs (the same 17 columns as `scripts/import-jobs-sheet.ts`), reads a preview, and confirms. The rows go live on the public feed at once.

## Who can use it
`jobs_import` is granted to nobody (migration 0276, one statement; the enum value is left in place on rollback). Only a holder of `operators` can grant it: in *Admin > Operators* tick **Jobs import** on a role and give that role to an operator. Holding `jobs_import` alone cannot grant it to anyone. It is checked in the page (`requirePermission`), in each of the two route handlers (`POST /admin/jobs-import/preview` and `/confirm`, each with its own guard like `/admin/data-export`: own origin, then the admin session, none -> 401, no permission -> 403 and a `jobs.import_denied` audit row), and the nav entry is shown only to holders.

## What it does
- **Limits:** 2 MB and 1,000 data rows, checked before anything is planned; missing columns answer 400 naming the columns, never a cell.
- **Rules:** exactly the script's (`src/lib/jobs/sheet-import/`, moved from `scripts/`, which re-export them): link rows and link-plus-e-mail rows have an external link and never an `apply_email`; an e-mail-only row has no link and its normalised address in `apply_email`, or is skipped as "email address is not one plain address"; the address is never in the description, the preview, a response, an audit row or a log line. Insert-only: `ON CONFLICT (dedup_fingerprint) DO NOTHING`, nothing is ever updated.
- **Preview:** reads only (the fingerprints already on Talentrah, in chunks of 200). Counts by kind, skip reasons, duplicates, the first 100 lines (line, title, company, batch, reason) and a preview CSV.
- **Confirm:** the browser re-sends the file with the three numbers it saw (hash prefix, importable, batches) and a tick. The server recomputes the whole plan and writes nothing unless its own numbers are the same (409). A canary of 10, then batches of at most 50, one at a time, stopping at the first error. The per-upload source key is `manual-upload-<yyyymmdd>-<8 hex of the file hash>`; the `manual-` prefix keeps the stale-posting sweep off these rows.
- **Writes:** only through the service-role client, created after the permission check. No client write grant, no policy, no function.
- **Audit:** `jobs.import_requested` is written BEFORE any write (if it cannot be written, nothing is written); `jobs.import_finished` after, with `completed`, `partial` or `failed`, counts and an error class. Counts and codes only.
- **Failure halfway:** batches already committed stay; the rest are not sent; the page says to run the same file again, and rows already in are skipped by their fingerprint.

## Errors
Every failure path answers, logs and audits an error **class** (its name and a five-character database code), never a message: a database error can quote the failing row, which holds an address.

## Not in this change
Closing all rows of one upload from the page (PR-U2).
