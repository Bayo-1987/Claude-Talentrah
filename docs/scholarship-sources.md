# Scholarship sources — evidence and process

Companion to `src/lib/scholarships/sources.config.ts` (the entries) and
`src/lib/scholarships/recheck.ts` (the daily deadline recheck). This file is
the record of **which sources were checked, what was found, and why each is
in, out, or waiting** — the same evidence discipline `docs/phase-1-summary.md`
applies to job sources.

## The decision this implements

On **2026-09-01** the founder directed the catalog to grow from public
scholarship sources — global coverage across Europe, North & South America,
Asia, Australia/Oceania and Africa — with a **daily check that closed
scholarships stop being shown**, and chose **auto-publish for
machine-verified deadlines only** (everything else still lands `pending`).

Two standing rules were kept, deliberately:

1. **Permitted sources only.** A source is ingested or fetched only when its
   robots.txt and terms allow automated access — the same test that
   disqualified Jobberman/MyJobMag/Fuzu on the jobs side. A source that
   prohibits scraping goes on the partnership list instead. §10 item 19 is
   resolved — the founder approved the data policy at the bottom of this
   file on 2026-09-01, and it is the standing rule.
2. **A deadline is confirmed or absent — never guessed.** Unchanged from M10.
   The catalog's worst possible error is a wrong deadline (§6.15).

## How "don't show closed scholarships" works (all shipped)

- **Daily cron** (`vercel.json`, 07:00 UTC) runs the ingest.
- **Expiry sweep** (`markExpiredCycles`): any published listing whose stored
  deadline passed is unpublished on the next run.
- **Deadline recheck** (`recheck.ts`): for listings with a recheck target,
  the official page is re-read daily; an unambiguous new date updates the
  listing (and a change to a published listing goes back to review — a
  change is never auto-published). Fetch failures and ambiguous pages leave
  curated data standing and surface as run notices.
- **Auto-publish** (`UpsertOptions.autoPublishMachineVerified`): a NEW
  listing with a confirmed, still-open deadline publishes on ingest. Opt-in
  by the ingest pipeline only — the admin posting form still cannot publish.

## Sources verified and IN the catalog (2026-09-01 pass)

| Program | Deadline found | Recheck target? | Robots/terms evidence |
|---|---|---|---|
| Chevening Scholarships (UK FCDO) | **2026-10-06** (apply page, 11:00 UTC) | Yes — chevening.org/apply/ | robots.txt allows all but /wp-admin/ (checked 2026-09-01) |
| Gates Cambridge | **2026-12-08** (earlier of 8 Dec / 6 Jan two-round split; note carries both) | Yes — timeline page (multi-date, so recheck will defer to humans by design) | robots.txt allows all but /wp-admin/ (checked 2026-09-01) |
| Knight-Hennessy Scholars (Stanford) | **2026-10-06** (1pm PT) | Yes — admission page | robots.txt permits public content, 30s crawl-delay (one fetch/day complies; checked 2026-09-01) |
| Swiss Government Excellence | Variable — round opened 20 Aug 2026, per-country deadlines on the SERI page | No (variable by design) | Swiss federal site; standard terms (checked 2026-09-01) |
| JJ/WBGSP (World Bank) | Variable — 2027 windows announced, dates in guidelines PDFs | No (dates live in PDFs) | worldbank.org public program page (checked 2026-09-01) |
| Commonwealth Master's (existing M10 entry) | 2026-10-20 (verified 2026-08-24) | Yes — cscuk.fcdo.gov.uk (UK gov, Open Government Licence) | OGL — explicitly reusable |
| **— tranche 2, 2026-09-01 —** | | | |
| Lester B. Pearson (U of Toronto) | **2026-11-06** (scholarship application; school nomination 9 Oct, admission 16 Oct) | No — page carries stale 2025 copy, extractor would see several dates | robots.txt allows content (checked 2026-09-01) |
| ETH Excellence & Opportunity (ESOP) | **2026-11-30** (window opens 1 Nov, 12:59 CET) | No — expressed as a range with an abbreviated month, extractor reads neither | no robots.txt served (404); no stated restriction (checked 2026-09-01) |
| Schwarzman Scholars | **2026-09-09** (3pm EDT, class of 2027–28) | **Yes** — single machine-readable date | robots.txt `Disallow:` empty, `Crawl-delay: 10`; one fetch/day complies (checked 2026-09-01) |
| NYU Abu Dhabi Undergraduate | Variable by plan — ED I 1 Nov, ED II 1 Jan, RD 5 Jan; **page states no year** | No | robots via redirect; page fetched cleanly (checked 2026-09-01) |
| NL Scholarship (Nuffic) | Variable — each Dutch institution sets its own, commonly 1 Feb or 1 May | No (no central date) | studyinnl.org public programme page (checked 2026-09-01) |

Plus the original M10 eight (DAAD EPOS, Mastercard Foundation, Commonwealth,
MEXT, Rhodes, PTDF, Erasmus Mundus, Aga Khan) — unchanged.

## Checked and EXCLUDED, with reasons

| Program | Reason | Re-check? |
|---|---|---|
| Vanier CGS (Canada) | **Discontinued** — site states "no longer accepting applications" (2026-09-01). A list-copy would have shipped this. | No |
| Manaaki NZ Scholarships | **Nigeria and all African countries absent from the eligible list** — Pacific and Asian countries only (verified on the official eligible-countries page 2026-09-01). Same rule that excluded ADB-JSP. Tertiary applications also currently closed. | Only if the scope rule changes |
| ADB–Japan Scholarship Program | Eligibility is ADB borrowing members (Asia-Pacific citizens) — fails the catalog's eligibility-relevant scope rule for Nigerian/African applicants | Only if scope rule changes |

## Standing workflow: the scheduled sourcing pass, and the sync that follows it

A **scheduled sourcing pass runs Mon/Wed/Fri at 06:04 UTC** in a fresh session.
It works the backlog in this file, verifies against official pages under the
same rules, and does two things with what it finds:

1. **Inserts rows straight into production** — `verified` or `pending` by the
   same publish rules the pipeline uses, with pipeline-matching fingerprints so
   a later sync collides rather than duplicates.
2. **Delivers a `NormalizedScholarship` entries file to the founder** each run.

### The standing job for work sessions: batch-sync those files into config

Take the delivered entries files and fold them into
`src/lib/scholarships/sources.config.ts` **by PR — weekly is fine.** Batching is
deliberate: three passes a week producing three PRs would be churn, and the
rows are already live in production either way. What the sync buys is not
visibility; it is monitoring.

Because the fingerprints match, a synced entry **collides with the row already
in production** rather than inserting a second one. Expect the first ingest
after a sync to report those rows as upserted-same, `autoPublished=0` for them,
and no change in row count. If a sync ever produces new rows instead of
collisions, the fingerprints have drifted — stop and find out why before
merging, because that is how a catalog grows duplicates.

### Until a row is synced it is half-covered, and this is the important part

The two safety mechanisms have **different reach**, and it is not obvious from
their names:

| Mechanism | Reach | Covers a pass-inserted row? |
|---|---|---|
| **Expiry sweep** (`markExpiredCycles`) | **DB-wide** — an unfiltered `UPDATE` over every `verified` row whose `application_deadline` has passed | **Yes, immediately** |
| **Deadline recheck** (`recheckDeadlines`) | **Config-backed** — iterates `RECHECK_TARGETS` and looks each one up in a map built from `SEED_SCHOLARSHIPS` | **No, not until synced** |

So a pass-inserted row **will** be withdrawn when its stored deadline passes —
the "never show a closed scholarship" guarantee holds from the moment it lands.
What it will **not** get is the daily re-read of its official page, so a
provider *moving* a deadline earlier goes unnoticed until the row is in config
and has a recheck target. That is the gap the weekly sync closes, and it is the
reason the sync is a standing job rather than tidying.

Note that adding the config entry is necessary but not sufficient: a recheck
only happens for programs that ALSO appear in `RECHECK_TARGETS`, and only where
the page publishes a single machine-readable date. The rows above marked
HUMAN-READ ONLY never get one.

## When to run the next tranche — early October 2026

**Run the next full pass in early October, not before.** Tranche 2 was run on
1 September and returned five programs against a target of ten to fifteen, and
the reason was calendar rather than effort: most university and government
cycles for 2027 entry had either just closed or had not yet published dates.
The programs that *were* open all had autumn deadlines.

Early October is when the backlog is likeliest to be answerable in one sitting:

| Waiting on | Expected to publish | Why October |
|---|---|---|
| Eiffel Excellence (France) | autumn 2026 | 2027 campaign publishes in autumn; a October read should find it |
| Nottingham Developing Solutions | autumn/winter | 2026 deadline passed with no next date; cycles have historically reopened for a spring deadline |
| Türkiye Bursları | Dec–Jan window | portal opens ahead of a Jan–Feb window |
| Oxford / Westminster / Melbourne | already published | these are blocked by fetching, not by timing — see below |
| Bocconi, Yenching, Trudeau | already published | blocked by not having found the real URL, not by timing |

**A short-runway hunt is a different job and can be run any time.** Schwarzman
was found eight days before its deadline, and a program that closes inside a
month is worth surfacing the week it is found rather than waiting for a
scheduled tranche. If that is wanted, it is a narrow pass over programs with
known autumn/winter deadlines, not a full backlog sweep.

## Checked — WATCH LIST (cycle closed or unconfirmed; re-verify on schedule)

| Program | Status 2026-09-01 | When to re-check |
|---|---|---|
| Stipendium Hungaricum | 2026/27 deadline (15 Jan 2026) passed; page not yet on next cycle. Nigeria's partner status unconfirmed on the page — do not add until confirmed. | Nov 2026 |
| Eiffel Excellence (France) | 2026 campaign closed (8 Jan 2026); 2027 campaign publishes in autumn | **Oct 2026** |
| Mandela Rhodes | Public pages carry no dates; applications typically open early in the year for the following intake | Jan 2027 |
| Türkiye Bursları | Portal is login-gated; application window typically Jan–Feb | **Dec 2026** |
| Australia Awards (Africa) | **Re-checked 2026-09-01**: 2027 intake closed; official page states the 2028 intake "will open in February 2027" with no exact date. Nigeria's participation not stated on the apply page. DFAT's own robots.txt timed out again. | Feb 2027 |
| Global Korea Scholarship | **Re-checked 2026-09-01** — real domain found (`studyinkorea.go.kr`, robots allows all but `/Sims/`). Graduate cycle runs Feb–Mar per the official page, but the page gives **no exact date** and does not confirm Nigeria's eligibility. Same treatment as Stipendium Hungaricum: not added until eligibility is confirmed. | Jan 2027 |
| Nottingham Developing Solutions | **Re-checked 2026-09-01**: Nigeria IS eligible ("Africa (all nations)"), but the page says "The application deadline has now passed" and publishes no next-cycle date. Nothing blocks adding it once a date appears. | **Oct 2026**, then Jan 2027 |
| Westminster Full International | **HUMAN-READ ONLY** — see below. 403 to automated access despite a permissive robots.txt. | **Oct 2026**, by hand |
| Clarendon Fund (Oxford) | **HUMAN-READ ONLY** — see below. ox.ac.uk returns 403 to automated access. | **Oct 2026**, by hand |
| Melbourne Graduate Research | **HUMAN-READ ONLY** — see below. 403 on robots.txt itself. | **Oct 2026**, by hand |
| Bocconi | Guessed slug 404ed; real URL not yet found — **search for the real page before fetching** | **Oct 2026** |
| Yenching Academy (PKU) | Guessed slug 404ed; real URL not yet found — **search first** | **Oct 2026** |
| Trudeau Foundation | Guessed slug 404ed; real URL not yet found — **search first** | **Oct 2026** |

### HUMAN-READ ONLY sources — do not point a fetcher at these

**Oxford (Clarendon), Westminster, Melbourne.**

All three serve a *permissive* robots.txt and then return **HTTP 403** to an
honestly-identified fetcher. Melbourne returns 403 on `robots.txt` itself. That
combination is the trap worth naming: reading robots alone would tell you these
are fair game, and they are not reachable in practice.

**Do not re-attempt a fetcher against them, and never add them to
`RECHECK_TARGETS`.** A recheck target that always fails adds a notice line to
every daily run for a page that will never answer, which trains whoever reads
the summary to skim past notices that matter.

**Their verification path is a person.** An operator opens the official page in
a browser, reads the deadline, and enters the listing through the admin
scholarship form at `/admin/scholarships` — which lands it `pending` and routes
it through review, exactly as the form is designed to. Nothing about the
auto-publish rule applies: that is opt-in by the ingest pipeline only, and a
hand-entered listing never touches it.

Re-test the 403 occasionally rather than assuming it is permanent — a WAF rule
is a configuration, not a policy. But treat a fresh 403 as final for that pass
rather than working around it.

### What tranche 2 learned about the method

Three findings worth carrying forward, because they change what a pass can expect to yield:

1. **September is the wrong month for university tranches.** Most 2027-cycle
   university awards had either just closed (Nottingham, Australia Awards) or
   not yet published dates. The programs that *were* open are the ones with
   autumn deadlines — which is where the next pass should start, not at the
   top of an alphabetical list.
2. **University sites block bots far more often than government ones.** Oxford,
   Westminster and Melbourne all return 403 to an honestly-identified fetcher
   while serving a permissive robots.txt. That is a real constraint on how much
   of this catalog can ever be machine-rechecked, and those entries need a
   human reader rather than a better crawler.
3. **A search summary is not a source, and this pass proved it twice.** One
   search returned a 2028 deadline *earlier than its own opening date*; another
   asserted a program was closed while quoting three future dates. Both were
   resolved only by fetching the page and quoting it. Aggregators discover
   names; official pages settle facts.

**The queue is the process.** Each future pass (a scheduled session, or any
operator) takes rows off this watch list, verifies against the official page,
moves them up into the catalog with evidence, and adds newly found sources to
the end. Nothing is added from memory or from aggregator blogs — official
pages only. Aggregator sites (scholarshiproar, wemakescholars, etc.) may be
used to *discover* program names, never as the source of a deadline or a fact.

## University-hosted scholarships (tranche 2 started, 2026-09-01)

Worked through the founder's named list. **In:** Lester B. Pearson (Toronto),
ETH Excellence, NYU Abu Dhabi. **Blocked by 403:** Westminster, Melbourne,
Oxford Clarendon. **Closed for this cycle:** Nottingham Developing Solutions.
**URL not yet found:** Bocconi.

Still to work through, next pass: Bocconi, Yenching Academy, Trudeau
Foundation, Cambridge Trust, Weidenfeld-Hoffmann (Oxford), Fulbright Foreign
Student (per-country deadlines — Nigeria's is set by the US Mission), and the
university awards attached to Mastercard Foundation partner campuses.

Same rules: verify the live page, record robots/terms, exact deadline or a
verified note, then in. Guessing a slug wasted three fetches this pass —
search for the real page first.

## Data policy for §10 item 19 — APPROVED by the founder, 2026-09-01, as drafted

> Talentrah's scholarship catalog lists factual details of third-party
> scholarship programs — provider, program name, eligibility, funding type,
> and application deadline — always with a link to, and attribution of, the
> official source, which remains the authoritative record. Facts are
> collected only from official program pages whose published terms and
> robots.txt permit automated access, or are entered and verified by
> Talentrah staff. Talentrah does not republish substantial expressive
> content from any source, does not present itself as the application
> channel, and removes or corrects any listing at a provider's request.
> Listings are re-checked on a daily schedule; a listing whose deadline has
> passed is withdrawn from the public catalog automatically.

Approved by the founder on 2026-09-01, in the session that built the sourcing
pipeline ("item 19 approved as drafted"). CLAUDE.md's open-decisions section
now records it as resolved, citing this file. Standing consequences:

- This policy is the operating rule for all scholarship sourcing — the
  scheduled Mon/Wed/Fri passes, the daily recheck, and any manual entry.
- The public scholarship pages (SEO surface) are unblocked on the policy
  side; their PR should surface this paragraph on the public site's legal
  pages so providers and users can read the commitment.
- A formal external legal review remains RECOMMENDED before diaspora
  billing, batched with the spec's other multi-jurisdiction items — this
  approval is the founder's operating decision, not a legal opinion.
