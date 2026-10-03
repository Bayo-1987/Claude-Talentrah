<!--
Copy this file to docs/handoff/<yyyy-mm-dd>-pr-<n>.md (the date is the merged-at date, UTC; <n> is the PR number) inside the PR that carries the change.
An entry ships inside its own PR, so it cannot quote its own merge commit. While the PR is open, head it "## Opened ..." (or write "(filled at merge)" in both the merged-at and SHA cells); a follow-up docs commit changes the heading to "## Merged ..." and fills the real facts.
Placeholders do not live forever: `npm run handoff-fill-merge-facts` (dry run; add `-- --write` to apply) reads each merged PR's time and SHA from the GitHub API (GET only) and rewrites just those two cells.
This file is NOT a handoff entry: tests/docs/handoff-format.test.ts skips it and checks that it keeps the headings below.
-->

## Merged <yyyy-mm-dd> — PR #<n>, <the PR's title in one line> (<send-id or session>)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#<n>](https://github.com/Bayo-1987/Claude-Talentrah/pull/<n>) | `<branch>` | <yyyy-mm-dd hh:mm:ss> | `<40-hex merge commit sha>` |

### What changed
What the PR did and why, in a paragraph or two. What was deliberately left alone.

### Verification
**1. GitHub API:** `pulls/<n>` reports `merged: true`, with `merged_at` and `merge_commit_sha`.
**2. Fresh clone:** a fresh shallow clone of `main`, with the PR's files asserted present (and any file it removed asserted absent).
**3. Production:** a live probe of what the change does, with the deployment id and its state, or "not observable from outside" with the reason.
**4. Full suite on merged main:** the push run for the merge commit, with its link and counts.

### Flakes and reruns
Each flaky failure by name, the head it happened on, and the one allowed rerun; or "none".

### Follow-ups
What is left open, with its issue or PR number, or "none".

### Migration apply record
Only if the PR carries a migration (see docs/database-environments.md for the order); otherwise delete this section.

| Where | Applied at (UTC) | sha256 of the applied SQL |
|---|---|---|
| production (`nytwbbzfpytctjsoczzq`) | <yyyy-mm-dd hh:mm:ss> | `<64 hex>` |
| talentrah-preview (`gtiksnbhnqmwpeckfqwk`) | <yyyy-mm-dd hh:mm:ss> | `<64 hex>` |
