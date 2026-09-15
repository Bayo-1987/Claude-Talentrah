# Ingest-time LLM enrichment (Stage 8, Step 1b)

Infrastructure for `docs/stage8-match-accuracy.md`'s own "Step 1b" proposal:
for a job posting that is still thin (`isThinScreenableTagSet`) after the
heuristic extraction pipeline (`extractStructuredJd`, `SKILL_VOCABULARY`) has
already run, make one LLM call at ingest time to pull additional real
requirements out of the free-text description, and merge them into the same
`structured_jd.skills` field `computeMatchScore` already reads.

**Built and tested. NOT enabled.** The `ingest_llm_enrichment` feature flag
(0164, `feature_flags` table) is `false`. Read this whole document — both
open blockers below — before flipping it.

## What exists

- `src/lib/llm/jd-extraction/` — a JD-extraction provider abstraction,
  deliberately separate from `src/lib/llm/index.ts`'s `getLLMProvider()`
  (Farah's own provider singleton). Two implementations:
  - `StubJdExtractionProvider` — deterministic, zero real calls. The default
    whenever `JD_EXTRACTION_LLM_PROVIDER` is unset or not `"groq"`.
  - `GroqJdExtractionProvider` — a real provider, reading its OWN env var
    (`JD_EXTRACTION_GROQ_API_KEY`) rather than reusing `GROQ_API_KEY`, and
    refusing to start if the two happen to be equal (see "Isolation" below).
- `src/lib/jobs/enrich-thin.ts` — the enrichment run itself:
  `selectEnrichmentCandidates` (pure, oldest-thin-first, capped) and
  `enrichThinPostings` (the DB-touching orchestration, gated on the feature
  flag checked first and before any query).
- `src/lib/jobs/ingest.ts`'s `ingestAllSources()` calls `enrichThinPostings()`
  once per run, after every configured source has been fetched and upserted
  — wrapped so a failure there can never take down the ingest run itself.
- `supabase/migrations/0164_ingest_time_llm_enrichment.sql` — the additive
  schema this needs: `job_postings.llm_enrichment_attempted_at` (nullable,
  marks an attempt so a posting is never retried automatically) and the
  `ingest_llm_enrichment` feature-flag row (`enabled = false`).
- `runCostProbe`'s `"jd_extraction"` probe group
  (`src/lib/llm/cost-probe.ts`), for measuring real cost once a real account
  exists — see "Cost probe status" below.
- Tests: `tests/jobs/enrich-thin.test.ts`,
  `tests/llm/jd-extraction-provider.test.ts`.

## Why it stays off — two independent blockers

### 1. Isolation — not provisioned in this PR

The original framing ("a dedicated key, isolated from Farah's quota") is not
precise enough to build against safely. Per CLAUDE.md's own incident
history, Groq's 200,000 TPD ceiling is shared **ACCOUNT-WIDE**, not per API
key — a second key on the *same* Groq account as production's
`GROQ_API_KEY` shares the same daily budget as Farah chat, tailoring, gap
analysis, scholarship eligibility, bullet rewriting, and the resume-parse
fallback. That is not isolation; it is a second consumer of a budget that
has already caused two real Farah outages (send-109, send-112). Building
against "a second key on the existing account" would silently risk a third.

**Real isolation needs a genuinely separate account** — a new Groq sign-up
under its own billing — or a different provider entirely. Provisioning
either requires a human (account creation, email/phone verification, and in
most cases a payment method) — not something a background coding agent can
do on its own, and this PR does not do it.

What this PR does instead, per the task's own explicit instruction to build
the infrastructure and hold off on the real integration:

- `GroqJdExtractionProvider` reads `JD_EXTRACTION_GROQ_API_KEY`, a
  structurally distinct env var from `GROQ_API_KEY`, so the two can never be
  confused by code that reads the wrong one.
- It refuses to start (throws at call time, not silently) if
  `JD_EXTRACTION_GROQ_API_KEY === GROQ_API_KEY` — the single most likely
  real mistake (pasting the existing, "already working" key into the new
  variable) is a loud failure, not a silent budget-sharing bug. This cannot
  detect "same account, different key" (Groq's key format carries no visible
  account id), but it is real defense against the mistake most likely to
  actually happen.
- The default provider (`JD_EXTRACTION_LLM_PROVIDER` unset or anything but
  `"groq"`) is the offline stub — the OPPOSITE default from Farah's own
  `pickProvider()`, which defaults an unset `LLM_PROVIDER` to a REAL
  provider (Gemini) because Farah must always answer something. This
  feature has no such requirement, so its safe default is "do nothing real."

**Status: blocked, not run.** No real Groq (or other provider) call has ever
been made by this code. Whoever provisions a genuinely separate account
should update this section with which provider was chosen and how isolation
was verified (not just "it's a new key" — see the "how to verify" note
below), then proceed to the cost probe.

**How to actually verify isolation, when a candidate account exists:** a new
API key is not sufficient evidence on its own. Confirm the account is
separate by checking Groq's own console shows a distinct organization/account
id and a distinct billing relationship from the one `GROQ_API_KEY` belongs
to — not just that the key string differs.

### 2. ESCO sequencing — this targets an upper-bound ceiling, not the real population

This has a real, structural dependency on `docs/stage8-match-accuracy.md`'s
own "Step 1c" section (PR #415, ESCO skills-taxonomy validation — a
measurement-only pass, not yet acted on as of this writing). #415 measured
that a curated ESCO-derived vocabulary addition would shrink the thin-posting
share from **34.0% to 28.8%** on its sampled board, entirely without an LLM
call. That decision (whether to build the ESCO addition) has not been made.

**What this means concretely:** "thin after extraction" in this feature's own
trigger condition should mean whatever the current best heuristic/taxonomy
pipeline produces — today that's `SKILL_VOCABULARY` alone, but if ESCO terms
ship, the population this should enrich is the SMALLER residual left after
ESCO, not today's larger pre-ESCO thin population. Nothing in this PR's code
hard-codes "pre-ESCO" as an assumption — `selectEnrichmentCandidates` just
reads live `structured_jd.skills` at run time, so it automatically sees
whatever the extraction pipeline produces at that moment, ESCO-expanded or
not. The dependency is on **capacity planning**, not code: the cap
(`DEFAULT_MAX_ENRICHMENTS_PER_RUN`, `INGEST_LLM_ENRICHMENT_MAX_PER_RUN`) and
any account-level budget expectation should be sized against whichever
population is live when the flag is actually flipped on, not against the
number in this document.

**The ~34% figure (confirmed 2026-09-15 against production,
`nytwbbzfpytctjsoczzq`, 170/500 sampled postings) is a ceiling, not the
expected steady state** — it is almost certainly an overestimate of what
this feature will actually need to handle once/if ESCO ships. Re-confirm the
live thin-share number at whatever point this flag is actually considered
for enabling, rather than trusting either that number or this document's.

### Recommendation

Not blocking anything else in Stage 8. Worth enabling once (a) a genuinely
isolated account/provider exists and is verified, not assumed, and (b) the
ESCO decision has landed (approved or explicitly declined) so the batching
cap is sized against the real target population.

## Cost probe status

`runCostProbe("jd_extraction")` exists and is exercised by
`tests/llm/jd-extraction-provider.test.ts` against the stub provider (and
against a mocked HTTP layer for the Groq path — no real network call in any
test). **No real cost probe has been run against a live provider** — that
requires the genuinely isolated account from blocker 1 above, which does not
exist yet. Once it does:

```
JD_EXTRACTION_LLM_PROVIDER=groq JD_EXTRACTION_GROQ_API_KEY=<isolated key> \
  curl -X POST "$APP_URL/api/admin/estimate-llm-costs?group=jd_extraction" \
  -H "x-admin-secret: $ADMIN_CRON_SECRET"
```

Run it deliberately (it spends real quota on the isolated account, though at
the volumes this feature expects that cost is small — see
`docs/stage8-match-accuracy.md`'s own estimate) and record the real
input/output token counts here, replacing this paragraph, before treating
any cost number for this feature as measured rather than estimated.

## What must not change, and didn't

- `computeMatchScore`'s formula, `getMatchTier`, `match_scores.tier` — this
  feature only ever writes to `structured_jd.skills`/`keywords`, the same
  field the heuristic extractor already writes. No second scoring path.
- Farah's own Groq usage/budget — `GroqJdExtractionProvider` never touches
  `getLLMProvider()`, `generateWithFailover`, or `GROQ_API_KEY`, and refuses
  to start if misconfigured to share the latter (see "Isolation" above).
- No LLM call at scoring/render time — `enrichThinPostings` is called only
  from `ingestAllSources` (a background/cron path), never from a request
  path a seeker's feed load touches.
