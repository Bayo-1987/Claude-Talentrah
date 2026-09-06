# Stage 8 — match-score accuracy

Working doc for the multi-step fix queued after a live, concrete failure: the
founder's own resume (5+ years Product Management, FinTech/HealthTech, zero
instructional-design content) scored 99% · Excellent against three unrelated
postings, all collapsing to the identical single screenable skill tag
(`"project management"`) after `NON_SCREENABLE_SKILLS` filtering. Auto-Apply
is Excellent-only, so this is a real eligibility signal, not a cosmetic
score.

Order matters: fix the input before touching the scoring (`computeMatchScore`
itself is not broken — it correctly divides matches by a denominator; the
denominator was too small to mean anything on most of the board).

## Step 0 — display the sub-scores (shipped)

See PR that added `src/components/jobs/match-breakdown.tsx`. Display-only,
no scoring change: skill coverage, seniority alignment and an honest
"Not yet measured" for industry alignment, right on the card. Ships
independently of everything below.

## Step 1a — expand JD skill extraction (shipped)

See `SKILL_VOCABULARY`'s own header comment in `src/lib/jobs/extract-jd.ts`
for the full evidence trail. Summary:

- Measured against 184 real "thin" (≤2 screenable tags) postings, 30-day
  fresh+open, production, 2026-09-06.
- The original 48-term vocabulary is tech/product/eng-centric; this board
  spans trades, hospitality, franchise operators, NGO field roles and
  agriculture — occupations a hand-picked tech vocabulary structurally
  cannot see, no matter how many more tech terms are added to it.
- Added 22 terms found by real document-frequency measurement (not guessed),
  after discarding a first unfiltered pass that surfaced Wave's own investor-
  list/country-footprint boilerplate ("Stripe", "Sequoia", "Partech", a run
  of country names) as "frequent" — none of that is a skill anyone is asking
  for.
- **Measured effect, re-run against the real extraction code over the full
  298-job board**: the 0/1/2-screenable-tag share drops from **61.7% to
  37.9%**. A real, substantial improvement — **short of the founder's
  ~15%-under-3 target on its own.**

### Why heuristic expansion alone won't close the rest of the gap

The board's occupational diversity is the structural limit, not a vocabulary
size problem. Sampling the remaining thin postings by hand (Electronics
Technician, Ticketing & Reservations Officer using Amadeus/Sabre/Travelport,
Steward Supervisor needing HACCP, a Plumbing & Mechanical Engineer, an
Illustrator, NGO M&E specialists doing "RCTs, sampling, confidence
intervals") shows requirements that are genuinely domain-specific and, in
several cases, rare enough on this specific board (1-2 real occurrences out
of 184) that adding them to a shared, hand-maintained list has a real
ongoing maintenance cost for a vocabulary a future engineer has to keep
scanning to understand. A vocabulary can chase the board's long tail
indefinitely and still miss the next new occupation that shows up in
tomorrow's ingest.

## Step 1b — proposal: LLM-assisted extraction for postings the heuristic leaves thin (NOT BUILT)

This section is a proposal, not an implementation. Nothing described here has
been wired up; it needs a founder decision on the budget/key question before
any of it is built.

### The idea

For a posting that remains thin (≤2 screenable tags) after the heuristic
above, make ONE LLM call at ingest time — never at scoring/render time, so
`computeMatchScore`'s own "no LLM call per job" guarantee (score.ts's own
header) is unaffected — to extract a short list of real requirements from
the free-text description, in the same shape `SKILL_VOCABULARY` already
produces. This is exactly the "paid once at ingest, not per feed render"
shape the original prompt suggested, and it is a materially smaller ask than
per-render scoring: at 37.9% of a ~298-job board, that is roughly 113
postings needing a call *right now*, and going forward only the NEW postings
each ingest cycle that stay thin after the heuristic.

### The volume estimate — and the real risk in it

`docs/digest/select.ts`'s own measurement: **the board takes a mean of 3.6
new postings/day** (30-day production sample). At the current ~38% thin
rate, that is roughly **1.4 new thin postings/day** needing an LLM call in
steady state — comfortably inside almost any free-tier daily quota on its
own.

**Steady-state average is the wrong number to plan against.** Ingest is not
smooth. The Alaro City source shipped in the same week this doc was written
added **61 real postings in one ingest run** (`sources.config.ts`'s own
Workable-round-2 section) — a single new employer onboarding can spike a
day's thin-posting count by dozens in one run, not 1.4. A synchronous
"enrich every thin posting immediately at ingest" design would turn one
employer's board join into a burst of dozens of LLM calls in the same few
minutes.

**This board already has a real, live, shared quota constraint**:
production runs Farah on a **free-tier Gemini key, 20 requests/day, shared**
with every other Farah feature (CLAUDE.md's own standing note). A burst like
Alaro City's would exhaust that entire day's quota in one ingest run and
leave Farah unable to answer a single user question for the rest of the day
— a worse regression than the thin-score problem this is meant to fix.

### What this means for a build, if one is approved

1. **Not on the shared Farah key.** Either a second, dedicated API key
   (its own budget, its own quota, isolated from Farah's availability), or a
   different provider already wired into this codebase for exactly this
   kind of pluggable-provider reason — `src/lib/llm/groq-provider.ts` exists
   today as a real alternative provider, not a stub, and Groq's free-tier
   request limits are materially higter than 20/day on its smaller models,
   which is plausibly enough on its own; this needs a real quote against
   current Groq pricing/limits before being treated as free, not assumed
   from memory.
2. **Rate-limited/batched, not synchronous-per-posting.** Whatever the
   provider, the ingest path should cap LLM-extraction calls per run (e.g.
   "enrich at most N thin postings per ingest cycle, oldest-first") so a
   61-posting employer onboarding degrades to "most of them get enriched
   over the next few days" rather than either blowing a shared quota in one
   run or blocking the ingest job on dozens of sequential LLM calls.
3. **Cost, estimated (not measured — see caveat below).** A JD-extraction
   prompt is far cheaper than the existing tailoring/cover-letter actions
   `src/lib/llm/cost-probe.ts` already measures: input is one job description
   (the postings sampled for this doc ran roughly 900-2,500 characters, so
   call it 300-700 input tokens including a short system prompt) and output
   is a short list of skill strings (well under 100 output tokens), not a
   generated document. At even a conservative small-model rate this is a
   fraction of a cent per call; at the steady-state ~1.4/day volume estimated
   above, full-month cost on a paid key would be low single-digit dollars,
   dominated far more by whichever provider's minimum/base fees apply than
   by token volume itself.

   **This is an estimate from observed JD lengths and public model pricing
   shapes, not a measurement.** `runCostProbe` (`src/lib/llm/cost-probe.ts`)
   already exists in this codebase for exactly this kind of question — it
   runs the real production action against real seeded fixtures and reads
   the provider's own token usage back. The honest next step, if this
   proposal moves forward, is a small new probe group (e.g. `"jd_extraction"`)
   added there, run once deliberately (it spends real quota) rather than
   trusting this doc's arithmetic. Not run as part of this pass — the shared
   Gemini key was flagged as likely near its daily limit from this same
   round's live verification work, and spending more of it on a probe for
   a feature that isn't approved yet is not a good trade.
4. **Extraction, not scoring.** Whatever this produces still feeds the same
   `structured_jd.skills` field and the same `computeMatchScore` denominator
   — it is a richer input to an unchanged formula, not a second scoring
   path.

### Recommendation

Worth building once a decision is made on (a) dedicated key vs. Groq vs.
accepting the current heuristic-only state, and (b) the batching cap. Not
blocking anything else in Stage 8 — the heuristic expansion in step 1a
already shipped a real, independent improvement.

## Step 2 — real full-text search over descriptions (NOT STARTED)

`src/lib/jobs/search.ts` deliberately searches title/company/location only
today, and its own comment already names the fix: move search into the
query with a properly parameterised full-text column (a Postgres `tsvector`
column, indexed, ranked — not a hand-escaped PostgREST `or`, which the same
comment establishes as the security reasoning that must not be weakened).

Not started in this pass. Scoped as its own migration + `search.ts` rewrite,
with its own PR — a schema change belongs in `supabase/migrations/` reviewed
on its own, per this repo's own migrations discipline, not folded into a
scoring/extraction PR. Flagging it here so it isn't lost, not proposing a
design for it yet.

## Step 3 — revisit the score itself (NOT STARTED, GATED)

**Do not change `computeMatchScore`'s formula before step 1/2's real effect
is measured.** `tests/jobs/match-score.test.ts` already pins real, correct
behaviour a guessed threshold change could break. Once postings carry enough
screenable tags for the denominator to mean something (step 1a shipped part
of that; step 1b/2 would carry it further), re-measure the score
distribution across `match_scores` and report whether it still clusters at
the extremes before touching the formula.

When this step is actually reached, it also needs a short **design
proposal** (not code) for whether a job-family/domain-alignment signal —
independent of skill-token overlap entirely — belongs alongside the coverage
ratio. Flagged, not built: "Learning Experience Designer" and "Product
Manager" share close to nothing once generic terms are stripped, however
good the skill tags get, and a domain-alignment axis is the one thing that
would have caught the case that started this whole investigation even with
perfect extraction.

**If step 3 is ever reached and the formula changes, that comes back for
founder review regardless of CI** — it changes what "Excellent" means, and
Auto-Apply is Excellent-only.
