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

### Second live confirmation of the NGO M&E gap (2026-09-06) — no vocabulary change made

A separate, founder-reported production incident on 2026-09-06 (job id
`3e593f15-c114-4bff-b2b2-ec1a7cb750cd`, One Acre Fund, "Global MEL
Manager/Senior Manager") re-confirmed the exact gap this doc already named
above: a real PM/FinTech/HealthTech resume with no research background
scored **99% · Excellent** against this posting. Its `structured_jd.skills`
were `operations, project management, leadership, communication` — three
filtered by `NON_SCREENABLE_SKILLS`, leaving the single generic tag "project
management" as the entire denominator. The posting's real, differentiating
requirements (RCT/quasi-experimental research design, Stata, R, survey
design, multi-country people management) were never extracted, because none
of them are in `SKILL_VOCABULARY` even after step 1a's expansion. A separate
LLM call (the Tailor flow, which reads the full JD prose) scored the same
pairing 68% with six genuine gaps in the same call that surfaced this —
independent confirmation that the requirements really were sitting in the
prose the whole time, just never tagged.

This was checked against step 1a's vocabulary deliberately, not assumed: `git
grep -in "rct\|stata\|survey design\|quasi-experimental\|\bmel\b"
src/lib/jobs/extract-jd.ts` returns nothing. **No vocabulary change was made
for this PR**, for the same reasons already given above when this exact
occupation (NGO M&E specialists) was sampled and deliberately left out of
step 1a:

- It is the same rare, occupation-specific case already named in "Why
  heuristic expansion alone won't close the rest of the gap" above — a
  second real occurrence doesn't change that it was 1-2/184 on the sampled
  board, not a systemic term this board asks for broadly.
- The obvious candidate terms are not a safe, trivial add. "Stata" and
  "survey design" are plausible (multi-word, low collision risk, the same
  shape as terms already added in step 1a), but "R" — the language most
  distinctive to this actual gap — is a bare single letter. Even with the
  existing word-boundary regex, a term that short is exactly the kind of
  addition step 1a's own header comment already warned against ("a résumé
  skills field is unlikely to echo back verbatim" for bare/ambiguous terms),
  compounded here by "R" being a live false-positive risk against ordinary
  English text in a way "sap" already was flagged for at low frequency.
  Vetting that properly needs the same document-frequency measurement step
  1a used, not a guess added under an unrelated PR.
- This is exactly the shape of gap step 1b (LLM-assisted extraction,
  proposed immediately below, not built) exists to close generically,
  rather than chasing one more occupation into a hand-maintained list. This
  incident is additional evidence FOR building step 1b, not a reason to
  special-case M&E roles into the heuristic.

The fix shipped for this incident is display-only (see `match-tier.ts`'s
`isThinScreenableTagSet` and `MatchTierBadge`'s use of it): an Excellent
label computed from a screenable-tag denominator this thin is now qualified
("Excellent — thin match") rather than shown bare next to a sub-score line
that already says "thin". It does not change what gets extracted or scored —
that gap is still open and is what this section documents.

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

## Step 1c — ESCO skills taxonomy: measured coverage against real thin postings (MEASUREMENT ONLY, 2026-09-15)

This is the founder-approved "measure before build" pass on the ESCO
("ATS-model") path step 1a's own header comment deliberately deferred rather
than assumed. **Nothing in `extract-jd.ts` changed for this pass** — this
section is a report, following the same measure-before-build discipline as
step 1a itself, and the same recommend-don't-decide posture as step 1b above.
No LLM calls were used (this is explicitly the non-LLM path the founder chose
over step 1b).

### Source and licensing

ESCO's own download portal (`esco.ec.europa.eu/en/use-esco/download`) gates
every file behind an interactive form that requires an email address before
issuing a download link — not a bulk file this task's scope could fetch
without submitting personal data to a third party, so that path was not used.
Instead this measurement uses
[`tabiya-tech/tabiya-open-dataset`](https://github.com/tabiya-tech/tabiya-open-dataset),
a public GitHub mirror republishing ESCO v1.1.1's classification as CSV under
the same CC BY 4.0 terms ESCO itself publishes under (the repo states the
license and origin plainly; ESCO's own copyright notice permits redistribution
with attribution). Its `skills.csv` contains **13,896 skill/knowledge
concepts** with `PREFERREDLABEL` and `ALTLABELS` columns — 98,404 unique
label strings (English) once preferred + all alt labels are counted
individually. This is v1.1.1, one point release behind ESCO's current
v1.2.1 (~13,939 skills per the already-confirmed licensing note above); close
enough in size and vintage that a version delta is very unlikely to change any
conclusion below, but it should be treated as a v1.1.1 measurement, not
v1.2.1, if this is ever re-verified against the live portal.

For the one French-language posting in the sample, no French bulk file was
available in this mirror (English only). Coverage there was spot-checked
directly against ESCO's own live public API
(`ec.europa.eu/esco/api/search?language=fr`), which needs no authentication —
sufficient to answer the specific terms below, but **not equivalent to a full
French label-set scan**, and flagged as such rather than silently skipped (see
group 3 below and "Language scope" under the false-positive pass).

### Method — replicating `extractStructuredJd` exactly, not approximating it

For each of 98,404 ESCO labels, against each posting's `description` (already
`stripHtml`-plain-text at rest — the same string `extractStructuredJd` itself
receives, per `src/lib/jobs/sources/*.ts`), the exact production regex was
rebuilt: `new RegExp('\\b' + label.replace(/[.+]/g, '\\$&') + '\\b', 'i')`,
tested with a substring pre-filter for speed and the real regex as the
deciding check (16 postings × 98,404 labels ran in ~4s; full script kept in
this PR's description for reproducibility, not committed to the repo per the
task's scope). "Screenable tags" below means the same thing it means
everywhere else in this doc: `structured_jd.skills` minus
`NON_SCREENABLE_SKILLS` (`communication`, `leadership`, `operations`).

### Sample note — 14 postings measured, not 17

The task brief asked for 17 postings; re-deriving the id list from its own
"terms worth specifically checking" groups (1 MEL, 1 plant breeding, 1
French, 2 illustration, 3 Reliance Health, 2 education, 1 language, 2 trades,
1 Evidence Action) sums to **14 distinct ids**, confirmed by re-listing the
groups twice rather than trusting the first count (the doc's own standing
rule on empty/miscounted results). The two data-quality-bug postings are
additional and separate, bringing the total pulled to 16. Flagging the
discrepancy explicitly rather than padding the sample to 17.

### Per-posting coverage table

"Safe adds" = ESCO labels that (a) appear verbatim in the posting's real
`description`, (b) are an exact `PREFERREDLABEL`/`ALTLABEL` match under the
real regex, (c) are not already in `SKILL_VOCABULARY`, and (d) pass the
false-positive filter below (multi-word or unambiguous, not bare/generic).
"Screenable, after" adds those to the posting's current screenable count.

| # | Posting | Current screenable | Safe ESCO adds found | After | Crosses thin (>2)? |
|---|---|---|---|---|---|
| 1 | Global MEL Manager (One Acre Fund) — **the incident posting** | 1 (`project management`) | `capacity building`, `knowledge management`, `change management` | 4 | **Yes** |
| 2 | Research Associate – Plant Breeding (IITA) | 1 (`agriculture`) | `genetics`, `statistical analysis` | 3 | **Yes** (exactly at the boundary) |
| 3 | Superviseur Mécanique (D2M, French) | 0 | none (English-only scope; see below) | 0 | No |
| 4 | Senior Illustrator (Moniepoint) | 0 | `adobe illustrator`, `fine arts`, `visual design` | 3 | **Yes** |
| 5 | Conceptual Marketing Artist (Loomer) | 0 | `adobe illustrator`, `adobe photoshop`, `typography`, `graphic design`, `design principles` | 5 | **Yes** |
| 6 | Freelancer Telemedicine Doctor (Reliance Health) | 0 | none | 0 | No |
| 7 | Associate Medical Officer (Reliance Health) | 0 | `community health`, `health education`, `medical ethics`, `primary care`, `medicines` | 5 | **Yes** |
| 8 | Associate Medical Laboratory Scientist (Reliance Health) | 0 | `label samples`, `quality management` | 2 | No (right at the boundary) |
| 9 | Talent Pool: SPARK Life Sciences Educator | 0 | `child protection`, `health and safety` | 2 | No |
| 10 | Learning Scientist (ALX Africa) | 0 | `pedagogy` | 1 | No |
| 11 | Customer Support Consultant, German/English C1 (SupportYourApp) | 0 | `customer service` (language terms flagged separately, not counted here) | 1 | No |
| 12 | Driver (Alaro City) | 0 | `customer service`, `road traffic laws`, `types of vehicles` | 3 | **Yes** |
| 13 | Storekeeper (Renmoney) | 0 | none | 0 | No |
| 14 | Senior Manager, New Program Development (Evidence Action) | 0 | `international development`, `social sciences` | 2 | No |

**6 of 14 cross out of "thin," 5 more gain at least one real tag but stay
thin, 3 gain nothing** (Superviseur Mécanique under English-only scope,
Telemedicine Doctor, Storekeeper). That is a materially different picture
from "12 of 17 gain a tag" read as a single number — most of the gains are
small (1-2 tags), and two structurally distinct occupation families
(Nigeria-specific medical licensing, and trades/retail operations
vocabulary) get essentially nothing.

Two postings excluded from the table entirely, per the task's own
instruction, because they are not vocabulary evidence:
`95318935-744a-4b47-abe5-b0da2877cfa3` (ATS-template placeholder text) and
`c1ee6ece-d0e2-4d27-b076-4d65c53b7791` (empty `description`) — both confirmed
real and logged as new items 6–7 in `docs/phase-1-summary.md`'s "Known
defects, not fixed" list.

### The incident posting specifically — a partial, structurally limited win

This is the posting the founder was shown directly, so it gets its own
paragraph rather than just a table row. ESCO genuinely adds three real,
verbatim, low-collision-risk tags (`capacity building`, `knowledge
management`, `change management` — all three literally present in the JD
text, e.g. "non-technical capacity building," "(change management)"), enough
to move the posting from 1 screenable tag to 4 and out of the "thin" band
entirely. **But every one of the posting's actual differentiating
requirements is absent from ESCO**, confirmed by direct field-level lookup,
not by trusting an empty match list: `stata`, `randomized/randomised
controlled trial`, `quasi-experimental`, `propensity-score matching`,
`difference-in-differences`, and the exact phrase `survey design` all return
zero `PREFERREDLABEL`/`ALTLABEL` matches in the full 13,896-skill set. (A raw
whole-file `grep` for "stata" and "propensity" each returns one hit — both
false alarms from the `DESCRIPTION` prose column, not the label columns; the
field-level check is what actually matters and it found nothing, which is
the kind of empty result this doc's own conventions say needs a second
method before it's trusted — done here.)

That means the fix this specific denominator gets is real but **orthogonal
to the reason it was flagged**: a candidate with `capacity building` /
`knowledge management` / `change management` on their resume and zero
research-methodology background could still score the same falsely-high
match this incident originally reported, just against a denominator of 4
generic-ish operational terms instead of 1. The qualitative problem Stage 8
exists to fix — a PM/FinTech resume reading as a near-perfect match against
an M&E research role — is not resolved by this import; only the "thin
denominator" symptom is.

### False-positive pass

Running all 98,404 labels against real JD text, unfiltered, produces exactly
the failure mode step 1a's own header comment already found at a smaller
scale with "Stripe"/"Sequoia"/"Partech" — just much worse, because ESCO's
labels are individually broader and there are ~1,400× more of them. A sample
of what the raw, unfiltered match list actually contained, before any
filtering (not hypothetical — these are real hits from the run above):

- `data` → canonical ESCO skill "statistics"; `it` → "computer technology";
  `re` → "instrumentation equipment" / "reverse engineering"; `design` →
  "think creatively"; `scale` / `light` / `space` / `form` → all four
  variously collide with "design principles"; `term` → "terminology";
  `access` → "Microsoft Access"; `conduct` → "programme work according to
  incoming orders"; `clean` → "conduct cleaning tasks"; `current` →
  "electricity principles"; `patterns` → "dies"; `source` → "Source (digital
  game creation systems)"; `google` → "search engines" (from a Driver
  posting almost certainly meaning Google Maps); `security` → "securities"
  (from a customer-support posting meaning data-handling security, matched
  to the finance term); `saas` → "service-oriented modelling".
- A genuinely funny, concretely-found instance of the exact Wave-boilerplate
  failure mode: the SPARK Schools posting's own company name, "SPARK," is a
  real ESCO alt-label (for Apache Spark, the data-processing tool) and
  matched as a false "skill."

None of the above are hypothetical or estimated — every one is a real match
this run produced and then discarded. **This is the central finding of the
false-positive pass: an unfiltered ESCO import would not be a modest
worsening of the "sap"/"tax"/"loan" problem step 1a already flagged — it
would reproduce it at a much larger scale**, because ESCO's ~98k label
strings include large numbers of short, generic, or structurally ambiguous
words that were never meant to stand alone as skill tags (many ESCO labels
are themselves full verb phrases like "advise on curriculum development" or
"manage correctional procedures" — a structural mismatch with a resume/JD
skill line that step 1a's hand-picked list, being written for this exact
regex from the start, doesn't have).

**The Stata-vs-R case, reasoned through as the task asked:** `stata` is not
in ESCO at all — moot, ESCO offers nothing to add or reject here. `R` **is**
a real ESCO skill (`key_5722`, preferred label "R", alt label "R" — the
programming language), and it did match the incident posting's real text
("Proficiency in both Stata and R"). This is exactly the false-positive risk
step 1a's own header comment already named for this term, now checked
empirically rather than assumed: a bare `\bR\b` regex run against the same
fresh 500-posting production sample used for the before/after measurement
below produced **14 raw matches across 500 postings**, and inspecting all 14
by hand found one genuine false positive — `R.Zozo@cgiar.org` (a contact
person's initial in an email signature) matched twice in the same posting
purely because `.` and `@` are non-word characters, so `\bR\b` reads the "R"
in "R.Zozo" as a standalone word. The other 12 were real references to the R
language. **Conclusion: "R" is a real skill ESCO knows about, correctly
matches most of the time, and is still not safe to add** — a roughly 1-in-13
false-positive rate on a single bare-letter term, on real production text, is
exactly the kind of cost step 1a's own reasoning already ruled out this term
for, now with a measured number behind it instead of an assumption. It was
excluded from the candidate list below on that basis, even though ESCO
"has" it.

**Language scope (flagging, not deciding, per the task):** ESCO does model
`German` and `English` as skills with real labels, and both appear verbatim
in the SupportYourApp posting (which explicitly requires "German and English
(C1 or higher)"). Whether a language name belongs in the same denominator as
"agriculture" or "capacity building" is a real design question, not just a
vocabulary-completeness one: `SKILL_VOCABULARY`'s existing terms are mostly
things a resume either has or doesn't, whereas a bare `English`/`German`
match would fire on nearly every resume regardless of fluency — the
posting's actual bar (C1, a CEFR proficiency level ESCO does not model at
all) would stay invisible either way, so adding the language name alone risks
manufacturing a false sense of coverage closer to how `NON_SCREENABLE_SKILLS`
already treats `communication` than to how it treats `sql`. Not counted in
the "safe adds" column above; left for a founder/engineering call rather than
decided here.

**Multilingual homonym risk, concretely found, not hypothesized:** the D2M
French posting needs "alignement de lignes d'arbres" (shaft-line alignment,
a naval/mechanical term) and literally contains "métrologie" and "HSE."
Querying ESCO's own live API in French found `métrologie` as a real, exact
French label (safe, if French support were ever built) — but "chantier
naval" and "HSE" return no matches, and searching for "alignement d'arbre"
returns only tree-related results (*climb trees*, *inspect trees*, *plant
trees*), because French "arbre" means both "tree" and mechanical "shaft," and
ESCO's taxonomy skews toward the arboriculture sense. Even in the
best case (French support built, `métrologie` added), this specific posting
would gain exactly one tag and remain thin (0 → 1). **Under the English-only
scope this measurement actually used, this posting gains nothing.**

### A second, independent NGO/research posting — same gap, not a One-Acre-Fund artifact

The task asked whether Evidence Action's "Senior Manager, New Program
Development" posting would confirm or contradict the incident finding.
Result: it confirms it. ESCO adds two genuine, safe tags
(`international development`, `social sciences` — both exact labels, both
verbatim in the text), but `cost-effectiveness analysis`, `epidemiological
modeling`/`modelling`, and `program`/`programme evaluation` are **all absent
from ESCO** — not present as exact labels, and not present even as
substrings of any longer label (checked both ways). The pattern is
consistent across two independent NGO/quantitative-development-economics
postings: ESCO covers the generic professional layer (`international
development`, `capacity building`, `knowledge management`) but has no
coverage at all of the specific quantitative-methods vocabulary that
actually differentiates these roles from a generic ops/PM posting — which is
the exact gap Stage 8 exists to close.

### Occupational-diversity check — trades and Nigeria-specific credentials

Two more findings worth stating precisely rather than folding into the table:

- **Trades roles get a mixed result, not a uniform one.** Driver gains three
  real, safe tags (`customer service`, `road traffic laws`, `types of
  vehicles`) and crosses out of thin. Storekeeper gains **zero** — `inventory
  management` and `stock control` are both completely absent from ESCO as
  exact labels (checked directly, not inferred from absence in the match
  run), so a simple retail/warehouse posting gets no benefit at all. ESCO's
  own *occupation* taxonomy does model "storekeeper" as a job title
  (`occupations.csv`, not scanned in depth for this pass), but its *skill*
  labels for what that job actually does don't lexically match how a real
  Nigerian job posting phrases it.
- **All three Reliance Health medical postings confirm the same absence**:
  `MBBS`, `MDCN` (Medical and Dental Council of Nigeria), `MLSCN` (Medical
  Laboratory Science Council of Nigeria), `LIMS`, and `QMS` all appear
  verbatim in real posting text and are all completely absent from ESCO —
  unsurprising once stated plainly, since MDCN/MLSCN are Nigeria-specific
  professional licensing bodies and ESCO is an EU classification system, but
  worth naming because it's the same *shape* of blind spot this whole
  exercise is meant to close, recurring inside the fix itself. Where ESCO
  does help these postings (`community health`, `health education`, `medical
  ethics`, `primary care`, `label samples`) is generic clinical/public-health
  vocabulary, not anything Nigeria-specific.

### Realistic scope for a build, if one is approved

Importing anything close to the full ~13,900-term/~98,000-label set is
**not** supportable — the false-positive pass above demonstrates why at
concrete, not estimated, scale. What this measurement's per-posting review
actually surfaced, after filtering, is a **27-term curated candidate list** —
coincidentally close to step 1a's own 22-term addition, which is a useful
scale reference: `capacity building`, `knowledge management`, `change
management`, `genetics`, `statistical analysis`, `adobe illustrator`, `adobe
photoshop`, `fine arts`, `visual design`, `typography`, `graphic design`,
`design principles`, `label samples`, `quality management`, `community
health`, `health education`, `medical ethics`, `primary care`, `medicines`,
`child protection`, `health and safety`, `pedagogy`, `customer service`,
`road traffic laws`, `types of vehicles`, `international development`,
`social sciences`.

Two things about this list matter more than its size:

1. **Every term on it was found by looking at only 14 postings by hand.**
   That is a strong signal a full document-frequency pass — step 1a's own
   method, seeded from ESCO's ~98,000 labels instead of a blank slate,
   against the same kind of 150-300 posting sample step 1a used — would
   surface meaningfully more than 27 real, safe, board-relevant terms. This
   could plausibly be **semi-automated**: run every ESCO label against a real
   sample the way this measurement's script already does, rank by document
   frequency the same way step 1a did, and hand-vet only the labels that
   clear a frequency floor (discarding the long low-frequency tail
   automatically) rather than reading all ~98,000 by hand. That vetting step
   cannot be skipped — the false-positive pass above shows raw frequency
   alone would still surface "data," "design," "it" at the top.
2. **The list's own composition already shows the ceiling.** It is
   overwhelmingly generic-professional and creative/medical-adjacent
   vocabulary — none of it is plant-breeding-specific, NGO-quantitative-
   methods-specific, or Nigeria-credential-specific, because ESCO itself
   doesn't have those terms to offer. A larger curated import would likely
   still land in the same territory: real, incremental, and structurally
   incapable of closing the exact gap (rare domain-specific requirements)
   step 1a already identified as the one heuristic expansion can't reach.

### Before/after — measured, not projected

Re-ran the doc's own methodology: a fresh 500-`open`-posting production
sample (`order by created_at desc limit 500`, pulled 2026-09-15), current
screenable-tag distribution as a baseline, then the same distribution with
the 27-term candidate list above applied as an in-memory/script-level regex
check — **not** committed to `extract-jd.ts`. The baseline reproduces the
already-confirmed 34.0% thin share exactly (36 at zero, 57 at exactly one —
identical to the numbers already confirmed before this task began, a strong
internal-consistency check that this is the same real data, not a
resampling artifact):

```
              0 tags        1 tag         2 tags        3+ tags
before:    36 (7.2%)     57 (11.4%)    77 (15.4%)    330 (66.0%)
after:     16 (3.2%)     50 (10.0%)    78 (15.6%)    356 (71.2%)

0-2-tag (thin) share: 34.0% -> 28.8%
postings gaining >=1 new screenable tag: 140/500 (28.0%)
postings crossing from thin (<=2) to non-thin (3+): 26/500 (5.2%)
```

A real, measured, **5.2-percentage-point** improvement — genuine, but far
smaller than step 1a's own 61.7% → 37.9% (23.8 points) from a comparably-sized
term list. No single candidate term dominates the effect (`customer service`
is the highest at 47/500 matches, in line with how common that occupation
family already is on this board; the rest range from 1-23 matches each),
which is a reasonable indicator the list isn't secretly leaning on one
overbroad term to inflate the headline number.

### Recommendation

Mirroring how step 1b above was written up — a recommendation, not a
decision, left to the founder:

**Proceed, but with a narrower scope than "import ESCO," and with the
qualitative caveat stated plainly rather than implied.** The measured
evidence supports a **curated, document-frequency-seeded subset** (get to
the 27-term list's scale and composition by running step 1a's own frequency
method against ESCO's label set instead of a blank slate, then hand-vetting
the output the same way step 1a's own header comment already did) — not a
bulk import of the full taxonomy, which the false-positive pass above shows
concretely would be worse than doing nothing. Expected real effect, based on
this measurement: **another few-percentage-point reduction in the thin-tag
share**, on the same order as the 5.2 points measured here, not a second
23.8-point jump — ESCO's genuine incremental value is real but bounded, and
this measurement found and named the boundary rather than assuming it.

Separately, and more important than the vocabulary-size question: **this
import would improve the thin-tag statistic without touching the underlying
problem that motivated Stage 8** for exactly the postings the founder is
most likely to notice, because the flagship incident posting's real
differentiators (Stata, R, RCT/quasi-experimental design,
propensity-score matching, difference-in-differences, survey design) are
*structurally absent from ESCO*, confirmed by direct field-level lookup, not
inferred. Anyone deciding whether to build this should weigh that a green
"thin-tag %" number after this ships would not mean the 99%-Excellent
false-positive class of failure is fixed — only that its denominator got
a little larger with mostly-generic terms. If closing that specific gap is
the actual goal (as opposed to the aggregate thin-tag metric), step 1b's
LLM-assisted extraction — which reads the free-text prose directly rather
than matching against any fixed vocabulary — remains the only proposal on
the table that reaches it, and this measurement is independent evidence
strengthening that case rather than replacing it.

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
