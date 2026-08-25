# Auto-Apply — build summary

Phase 2's first milestone. Written 2026-08-25, in the same honest-accounting
style as [phase-1-summary.md](phase-1-summary.md): what shipped, what was
assumed, what is still open.

## The two scoping questions, answered rather than assumed

### 1. "Submit an application" means two different things, and only one of them is a submission

Checked against `src/lib/applications/actions.ts` before building anything.
There are two existing apply paths and they are not equivalent:

| | What it does today |
|---|---|
| `applyInAppAction` (internal) | Creates a real `applications` row. Talentrah owns the posting, so this **is** the application. |
| `markAppliedExternallyAction` (external) | Records that the user applied on the source site **themselves**. No submission happens; there is no ATS integration. |

So Auto-Apply does two different things, and the UI says which:

- **Internal postings** — confirming genuinely submits. An `applications` row is
  created with `source: 'auto_apply'` (a value that has existed unused in the
  enum since the original schema; nothing else writes it — checked).
- **External postings** — confirming **hands off**. The queue entry is marked
  `handed_off`, the posting opens in a new tab, and it is saved to the tracker
  as `saved`. It is deliberately **not** marked applied: claiming the user
  applied when they have only been handed a link would put a false entry in
  their own tracker.

**Greenhouse's and Lever's submission APIs are out of scope, deliberately.** They
exist, but they are opt-in per employer board with no way to tell which
aggregated postings accept one without probing each, and each board carries
custom screening questions this product has no structured answers for. A
malformed automated submission goes out under a real person's name to a real
employer — worse than not applying, and the exact opposite of the
higher-signal-candidate pitch this feature exists to support. Building it for
"whichever ATS the employer happens to use" would also make the behaviour
inconsistent and surprising. Queue-and-handoff, uniformly, for every external
posting.

### 2. There are no job preferences, so targeting is résumé-only

There is no preferences table, and `src/lib/matching/score.ts` computes from
résumé content against JD content — not from stored role/location/salary
intent. **v1 does not invent one.** Auto-Apply targets "scores Excellent against
your résumé, among open postings", and the UI says exactly that rather than
implying a preferences system that does not exist.

Named as the reason targeting is coarse: a user who has pivoted careers, or who
will not relocate, has no way to tell Auto-Apply so. That is the first thing to
fix if this feature gets real usage, and it is a Phase 2 follow-up, not a
deferred part of this one.

## The numbers, stated

All in [`src/lib/auto-apply/config.ts`](../src/lib/auto-apply/config.ts), all
server constants, none of them settable by a user.

| Rule | Value | Why |
|---|---|---|
| Threshold | **Excellent only (≥ 80)** | §6.2 asks for "conservative"; the design system fixes three tiers and forbids a fourth. A Good match is worth *reading*, not applying to unattended. |
| Daily cap | **5 confirmed internal submissions / rolling 24h** | Rolling, not calendar — a midnight boundary allows a 10-in-a-minute burst. |
| Queue cap | **20 pending** | A queue nobody can finish is a queue nobody reviews, which turns review-before-submit back into a volume feature. |
| Free line | **5 free / rolling 7 days, then 2 credits** | §6.9 puts auto-apply beyond a free cap on Credits without naming the cap. The price is the existing `CREDIT_COSTS.autoApplySubmission` anchor, not a new invention. |
| External | **never charged, never capped** | A hand-off is a link. |

## The safety shape, and where each piece actually lives

- **Review before submit** — nothing is ever sent without a confirmation click.
  There is no "silent mode" and no setting that creates one.
- **Threshold** — enforced in `auto_apply_claim_submission` (0034) by re-reading
  `match_scores` **live at confirm time**, not from the snapshot on the queue
  row. The snapshot exists for the audit log; the gate reads the source of
  truth. Migration 0031 locked that table to service-role writes precisely so
  this gate could not be moved by its subject.
- **Cap** — enforced inside the same function, under a per-user row lock. See
  below; this is the part that would most plausibly have shipped broken.
- **Activity log** — the queue table itself. `application_stage_events` was
  checked first and does not fit: it records transitions of applications that
  already exist, and Auto-Apply's whole safety property is a state where no
  application exists yet. Rows are resolved in place rather than deleted, so the
  log survives the decision and records what, when, the outcome and the cost.

### The cap is atomic, because the obvious version isn't a cap

Read-then-decide-then-act permits `cap + 1` whenever two requests interleave —
and the review queue is a list of buttons, so a double-click is enough. The
check and the claim therefore happen together in Postgres under a lock on the
user's settings row.

Proven, not asserted: `tests/auto-apply/enforcement.test.ts` fires **cap + 3**
confirmations simultaneously and asserts exactly `cap` are accepted, then
re-counts in the database rather than trusting the return values.

## What the tests actually prove

| Probe | Result |
|---|---|
| A user inserts their own queue row | refused |
| A user writes the `match_scores` row the gate reads (0031 guard) | refused, insert and update |
| A user calls the claim RPC directly | refused — it is `service_role` only, so its `p_user_id` argument can't be a forgeable authorisation |
| A queued job whose live score fell below 80 | refused at confirm; no application created |
| A job that closed after queueing | refused, marked `expired` |
| An above-threshold internal job (**positive control**) | accepted, free |
| cap+3 concurrent confirmations | exactly `cap` accepted |
| An external match | `handed_off`, 0 credits, not counted against the cap |
| End-to-end through the UI | real `applications` row with `source: 'auto_apply'`, queue row `submitted`, `application_id` linked, and it appears in the tracker |

`tests/rls/column-privileges.test.ts` gained the new tables: a user can create
their settings row and flip `enabled`, and cannot forge a queue entry, backdate
`enabled_at`, or rewrite what the log says happened.

## Two bugs this found in its own implementation

Recorded because both are the kind that read fine and fail live.

1. **The claim function was ambiguous SQL.** `RETURNS TABLE (… job_posting_id
   uuid, source_type …)` puts those names in scope inside the body, shadowing
   the table columns, so unaliased `where job_posting_id = …` failed at runtime
   with *"column reference is ambiguous"* — in four places. Caught on the
   enforcement suite's first run. Every table reference in that function is now
   aliased, and the migration says why.
2. **Two e2e assertions passed for the wrong reason.** Waiting for the "Confirm
   and apply" button to disappear passed *instantly*, because the button
   relabels itself to "Working…" while the action is in flight — so the database
   assertions ran before the submission had happened. Same class again with the
   toggle once it became optimistic: `aria-checked` flips locally and is not
   evidence the server did anything. Both now wait on something only a server
   round-trip can produce.

## Still open

- **No preferences surface** (see §2 above) — targeting is résumé-only.
- **The scan runs on feed load**, not on a schedule. It has to: it reads
  `match_scores`, which is recomputed on feed load and nowhere else. A user who
  never opens the feed never gets a queue. Moving scoring to a background job is
  the prerequisite for a cron-driven scan.
- **`enabled_at` is recorded but nothing reads it yet.** It exists so a support
  question about an unexpected application has an on/off history to consult.
- **Notifications are not wired.** §6.10 would put "N matches waiting" in the
  digest; today the only surfaces are the feed toggle and the queue page.
- **The free/paid line and the caps are researched-anchor guesses**, like every
  other price in this product (§10 item 18). They are stated in one file so a
  pricing test can move them in one place.
