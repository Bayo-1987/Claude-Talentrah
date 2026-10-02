<!--
Copy this file to docs/handoff/<yyyy-mm-dd>-pr-<n>.md (the date is the merged-at date, UTC; <n> is the PR number) inside the PR that carries the change.
While the PR is open, head it "## Opened ..." and leave the merge facts as "(filled at merge)"; the merger changes it to "## Merged ..." and fills them.
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
