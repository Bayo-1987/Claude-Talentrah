# A zero-screenable-skill posting outranks a real, measured partial match

Investigated at the founder's request, comparing Talentrah's live scoring
against jobright.ai's. Distinct from the 2026-09-06 One Acre Fund MEL
Manager case (a *thin* denominator — 1-2 real tags — inflating a score to
100%, already partially fixed by `isThinScreenableTagSet`/"THIN MATCH" and
`displayMatchScore`'s 99% cap). This is the `jobSkillSet.size === 0` branch
that fix doesn't reach — nothing was measured at all, as opposed to
something narrow being measured.

## The mechanism (`src/lib/matching/score.ts`)

```ts
const skillCoverage = jobSkillSet.size > 0 ? matchedSkills.length / jobSkillSet.size : 0.5;
```

A posting with zero screenable tags (after `NON_SCREENABLE_SKILLS`
filtering) gets a neutral `skillCoverage = 0.5` — "rather than a false 0 or
100," per the code's own comment, which is a reasonable position taken in
isolation. Seniority then adds `+5` (match) / `0` (unknown or adjacent) /
`-15` (2+ levels off), so the final score for a zero-tag posting is always
in **{35, 50, 55}** — always below the 60-point floor `getDisplayMatchTier`
puts on showing any tier badge at all.

That last fact matters: **a zero-tag posting never gets a colored tier
badge or a tier word today** — `MatchTierBadge` already renders it as a
bare, neutral-grey percentage (`"55%"`, no label, `text-ink-soft`), the same
treatment a real 45% partial match gets. So the *badge* doesn't
overclaim. The *sort* does: Recommended/External/Saved rank by this raw
score (Recommended additionally decays it by freshness), and a flat 50-55
routinely outranks a genuinely-measured 25-45.

## Real measurement, production (`nytwbbzfpytctjsoczzq`), 2026-09-08

**Distribution**, same shape as Stage 8's own denominator table, over
today's real feed board (open, unlisted excluded, within the 30-day
freshness floor — 338 postings):

| tags | postings | % |
|---|---|---|
| 0 | 32 | 9.5% |
| 1 | 38 | 11.2% |
| 2 | 56 | 16.6% |
| 3+ | 212 | 62.7% |

**Where the 32 zero-tag postings actually land**, computed from real
`match_scores` rows for every one of the 7 users who have any — the exact
`recommendedRankingKey` formula, not an approximation:

| user (board size) | avg rank, 0 tags | avg rank, 1-2 tags (thin, real) | avg rank, 3+ tags (real) |
|---|---|---|---|
| 338 | **34.0** | 190.9 | 179.9 |
| 198 | **7.5** | 102.1 | 104.7 |
| 190 | **9.5** | 100.1 | 105.5 |
| 54 | **4.5** | 31.1 | 31.4 |
| 54 | **8.5** | 29.2 | 31.8 |

Every single user with real scores shows the same inversion: zero-tag
postings cluster in the **top ~5-10%** of their board; postings with a
genuinely measured (if thin) partial match sit in the bottom half. This is
not a hypothetical — it reproduces the founder's own live examples exactly,
pulled from real stored scores for the highest-coverage user (338/338):

| rank | posting | tags | score |
|---|---|---|---|
| 12 | Primary School Scholar Supervisor Temp (SPARK Schools) | 0 | 55 |
| 15 | **Offline Customer Support Officer (Abuja)**, Moniepoint | 0 | 55 |
| 60 | **Senior Developer**, Rewardsco | 12 (1 matched) | 25 |
| 62 | **Senior Compensation Analyst**, Boldr | 4 (1 matched) | 25 |

(Ranks 1-4, all 100%/1-tag "thin" postings, are the *already-fixed* sibling
case — display-capped to 99% with a "THIN MATCH" qualifier, but note that
fix never touched sort order either: those still legitimately rank at the
very top by raw score today. Out of scope here, shown only for context.)

**Confirmed non-interactions, checked rather than assumed:**
- `promoted_jobs`' sponsored-slot eligibility gate (`score >= 60`) already
  structurally excludes every zero-tag posting — its max score is 55. No
  change needed there.
- Auto-Apply's threshold requires `Excellent` (score ≥ 80), also
  unreachable at a max of 55. No interaction.

## Proposal

**1. Don't remove zero-tag postings from the feed.** A missing skill list
is usually an *extraction* failure (the JD's requirements weren't parsed
into `structured_jd.skills`, not that the role has none), and removing them
from Recommended/External/Saved entirely risks hiding a genuinely relevant
opportunity behind a parsing gap — a false-negative risk with no upside,
the mirror image of the false-positive this whole investigation is about.

**2. Do stop them competing on the same sort axis as measured scores.**
On the three score-based tabs, partition before sorting: everything with
`jobSkillSet.size > 0` (a real measurement exists, however thin) sorts
first, by today's existing comparator, unchanged; everything with
`jobSkillSet.size === 0` sorts after all of it, keeping its own existing
comparator among itself (so freshness decay on Recommended, plain score
elsewhere, still differentiates within that group). This is the direct fix
for the founder's actual complaint — how far a reader scrolls past
zero-signal cards to reach real partial matches — without deleting
inventory. `External` and `Saved` get the identical partition; the problem
is the same shape on all three score-sorted tabs, not Recommended-specific.

**3. Flag it, but not by literally reusing "THIN MATCH."** Checked
`MatchTierBadge` directly: below 60 there is already no tier word, no
color — just a bare percentage (`"55%"`), because `getDisplayMatchTier`
already returns `null`. "THIN MATCH" is a suffix on a real tier word
("Excellent — thin match"); a zero-tag posting has no tier word to suffix.
The badge component's own render already branches on whether `label` is
set (`label ? "…% · label" : "…%"`) — the minimal, consistent change is
giving `label` a value ("Unscreened") specifically when
`jobSkillSet.size === 0`, independent of `tier`, so the card reads `"55% ·
Unscreened"` instead of a bare `"55%"` indistinguishable from a real
measured 55%.

**4. One shared predicate, not a second threshold.** Add
`hasNoScreenableSkills(total: number): boolean => total === 0` next to
`isThinScreenableTagSet` in `match-tier.ts`, and use it in exactly three
places: the new sort partition in `jobs/page.tsx`, the new `MatchTierBadge`
qualifier, and (trivial refactor, same behavior) `match-breakdown.tsx`'s
existing `if (total === 0) return "no screenable skills listed";` line —
mirroring exactly how `THIN_SCREENABLE_TAG_MAX`/`isThinScreenableTagSet`
already keeps the topline badge and the breakdown sub-line from disagreeing
about what counts as thin.

## What this does NOT touch

`getMatchTier`, `getDisplayMatchTier`, `match_scores.tier` (the stored
value), the Auto-Apply threshold, and the already-shipped thin-but-nonzero
handling (`isThinScreenableTagSet`, `displayMatchScore`, the 99% cap) are
all correct and untouched — confirmed above that none of them are even
reachable by a zero-tag posting's score range. This is scoped entirely to
the `jobSkillSet.size === 0` branch and how it competes in sort order and
badge display, nothing upstream (`computeMatchScore`'s arithmetic itself is
unchanged — the 0.5 fallback stays, since it's the persisted `score` and
`tier` that other things key off of) or downstream of it.

## Not built yet

This is the proposal, per the ask — no code changes in this pass. If
approved, the change is small and contained to three files
(`match-tier.ts`, `match-breakdown.tsx`, `match-tier-badge.tsx`) plus the
sort-partition logic in `jobs/page.tsx`'s three score-based tab branches.
