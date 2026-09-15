# The match-confidence invariant

A standing architectural contract, not a Stage 8 deliverable — this doc stays
current the way [docs/auto-apply.md](auto-apply.md) and
[docs/admin-auth.md](admin-auth.md) do, and CLAUDE.md links to it the same way
it names "hired is terminal except → archived" as a rule to know before
touching the area, not a changelog entry to read once.

## The rule

**No consumer of a match score may present more confidence than the
screenable-tag denominator supports.**

Concretely: a "score" and a "tier" (Excellent/Good/Fair) are not the whole
truth about a match — `computeMatchScore` divides matched skills by a
denominator (`src/lib/matching/score.ts`), and when that denominator is thin
(one or two generic tags after `NON_SCREENABLE_SKILLS` filtering), a high
score is an artifact of having little to measure against, not evidence of a
broad fit. [docs/stage8-match-accuracy.md](stage8-match-accuracy.md) is the
full investigation; the one number worth carrying into every future change
here: **65% of every `match_scores` row this system has ever computed with
`tier = 'excellent'` sits on a screenable-tag denominator of 1 or fewer, and
89% sit at 2 or fewer.** An "Excellent" on this board is, right now,
overwhelmingly a thin-denominator artifact rather than proof of broad domain
fit. Any feature that treats a raw score/tier as a confident fact is
statistically wrong most of the time it fires.

The rule has two enforcement shapes, and a feature must pick the right one:

1. **Cap and qualify the display** — for a passive, browsing surface (a job
   card, a list, an email digest) where an honest, visibly-caveated number
   still belongs in the list. The consumer still shows *something*, just not
   an unqualified confident claim.
2. **Exclude from eligibility** — for a feature whose premise IS the
   confidence claim itself (an escalation, an autonomous action taken on the
   user's behalf). Here a thin match must not qualify at all, regardless of
   how honestly it would later be displayed — capping the number doesn't fix
   an alert whose entire point is "this is unusually strong," and it doesn't
   fix an autonomous submission whose entire point is "the system is sure
   enough to act without you looking first."

Confusing the two is the mistake to watch for: applying (1)'s logic to a (2)
situation ships a technically-honest but still-wrong feature (a "rare,
exceptional match" alert that fires on a match nobody should call
exceptional), and applying (2)'s logic to a (1) situation needlessly hides
real, if modest, opportunities from a list that has room for nuance.

## The single source of truth

`describeMatchConfidence(score, explanation)` in `src/lib/match-tier.ts` is
the one function every display-shaped consumer calls. Given a raw score and a
`MatchExplanation` (or nothing, for a caller with none to give), it returns:

- `displayScore` — Stage 12's 99-ceiling always applied, and Stage 8's
  `THIN_MATCH_DISPLAY_CEILING` (79) applied on top when the tier is a
  thin-denominator "excellent".
- `tier` — the tier that actually renders, re-derived from the capped score
  when thin-capping applies (landing naturally on "Good", never inventing a
  fourth tier).
- `label` — the exact string to print: `"Excellent"`, `"Good — thin match"`,
  `"Unscreened"`, or `null` below the display floor. This is the only place
  in the codebase that should look `MATCH_TIER_LABEL` up directly to build a
  label — every other renderer takes `label` as given.
- `isThin` / `isUnscreened` — exposed separately for a caller that wants its
  own additional copy (a tooltip, a footnote) beyond the label.

`MatchTierBadge` (`src/components/ui/match-tier-badge.tsx`) is
`describeMatchConfidence`'s original caller and stays the reference
implementation for what "display" enforcement looks like. It carries no
duplicate logic of its own — it calls the function and renders exactly what
comes back.

For eligibility-shaped enforcement, the building block is
`isThinScreenableTagSet` / `screenableTagTotalFromExplanation`, also in
`match-tier.ts` — called directly by a gate deciding whether something
*happens*, rather than through `describeMatchConfidence`, which is about what
gets *shown*.

## What currently implements this, and how

| Consumer | Shape | Mechanism |
|---|---|---|
| `MatchTierBadge` (job cards, job detail, Auto-Apply queue item, employer-applicant view) | Display | Calls `describeMatchConfidence` directly. |
| Weekly job-match digest (`src/lib/digest/template.ts`) | Display | `buildDigestEmail` calls `describeMatchConfidence` per job; `explanation` threaded from `match_scores` through `DigestCandidate`/`DigestJob` (`select.ts`, `send.ts`). |
| Proactive "exceptional match" alert (`src/lib/notifications/proactive-match-alert/`) | **Both** | `isExcellentMatch` (`select.ts`) requires `tier === "excellent"` AND a non-thin denominator — a thin match is never eligible for this alert type at all, regardless of what it would display. Additionally, the template that DOES fire routes its own display score through `describeMatchConfidence` too (Stage 12's ordinary 99-cap), so this consumer implements both enforcement shapes for the two different things it does. |
| Auto-Apply's queue gate (`src/lib/auto-apply/queue.ts`, migration 0164) | Eligibility | A thin-denominator "excellent" is never queued for review at all — `auto_apply_claim_submission` (0034) is the real, atomic backstop regardless of what got queued, but showing a candidate the backstop is only ever going to reject is a worse product than not showing it. |
| Employer-applicant view (`src/app/employer/jobs/[id]/applicants/page.tsx`) | Display | Builds a real `MatchExplanation` and passes it to `MatchTierBadge` — gets the cap/qualifier for free, no separate logic. |
| Farah chat (`src/lib/farah/`, `src/lib/matching/vet-summary.ts`) | N/A — see below | Never exposes a raw score or tier word to Farah at all. |

**Farah chat is the strongest pattern here, not a gap.** It sidesteps the
whole problem by never handing a score or tier word to the model in the
first place — only seniority-alignment prose and matched/missing skill
*counts*, which cannot be misread as a confidence percentage the way "92%
Excellent" can. Every other row in the table above has to actively cap or
gate a number; Farah's own code has nothing to cap because it never computed
a number-shaped claim to begin with. When a future feature has the option to
follow Farah's pattern (describe the underlying facts, not a derived score),
prefer that over adding a new consumer of `describeMatchConfidence` — the
cheapest way to honor this invariant is to have nothing that needs enforcing.

## The enforcement test

[`tests/lib/match-confidence-enforcement.test.ts`](../tests/lib/match-confidence-enforcement.test.ts)
scans every `.ts`/`.tsx` file under `src/` for the two concrete shapes both
real gaps (the digest, the proactive alert) took before they were fixed:

- A direct `MATCH_TIER_LABEL[...]` lookup outside `match-tier.ts` itself.
- A `score`-named value interpolated into a template literal that also
  prints a `%` — the literal `${job.score}%` shape.

Either signal, found outside a short explicit allowlist (each entry
commented with a reason), fails the suite. This is what makes the rule an
enforced invariant rather than a doc promise someone has to remember to
re-read: a new feature that reads `match_scores.score`/`.tier` and builds its
own percent string, the same way the digest and the proactive alert both
independently did, fails CI on the first run rather than waiting to be found
by hand the way these two were.

The test proves it actually catches something, per this repo's own "prove
the test catches the bug" discipline (CLAUDE.md's own standing note): its own
"proof this scan catches a real violation" block reproduces both fixed
lines' pre-fix shape as literal strings and asserts the scan flags them, and
a throwaway file reproducing the same violation was added, confirmed to fail
the suite, then removed and confirmed green again while building this PR.

**What the enforcement test deliberately does not flag**, and why each is a
real, considered exception rather than a blind spot:

- `compute-and-store.ts` / `refresh-job.ts` calling `getMatchTier` to WRITE
  `match_scores.tier` — that IS the tier computation, not a consumer of it.
- `auto-apply/queue.ts` and `proactive-match-alert/select.ts` calling
  `getMatchTier` / `isThinScreenableTagSet` directly for an eligibility
  decision, not a display — a gate is a different kind of consumer than a
  renderer, and match-tier.ts's own predicates are exactly what a gate
  should call directly rather than going through a display-shaped wrapper.
- Farah chat isn't scanned at all, because it never touches a score or tier
  in the first place (see above).

## What must never change because of this doc

- `computeMatchScore` itself, `getMatchTier`'s boundaries, `match_scores.tier`
  as written to the database, and Auto-Apply's own confirm-time threshold.
  This entire contract is about what OTHER features are allowed to *say*
  about a score — never about the scoring formula. If the formula itself
  ever needs to change, [docs/stage8-match-accuracy.md](stage8-match-accuracy.md)'s
  own "Step 3" section is explicit that it comes back for founder review
  regardless of CI, because it changes what "Excellent" means and Auto-Apply
  is Excellent-only.
