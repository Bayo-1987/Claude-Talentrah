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
   prohibits scraping goes on the partnership list instead. §10 item 19's
   legal review is still owed; the draft policy update below is its input.
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

## Checked — WATCH LIST (cycle closed or unconfirmed; re-verify on schedule)

| Program | Status 2026-09-01 | When to re-check |
|---|---|---|
| Stipendium Hungaricum | 2026/27 deadline (15 Jan 2026) passed; page not yet on next cycle. Nigeria's partner status unconfirmed on the page — do not add until confirmed. | Nov 2026 |
| Eiffel Excellence (France) | 2026 campaign closed (8 Jan 2026); 2027 campaign publishes in autumn | Oct–Nov 2026 |
| Mandela Rhodes | Public pages carry no dates; applications typically open early in the year for the following intake | Jan 2027 |
| Türkiye Bursları | Portal is login-gated; application window typically Jan–Feb | Dec 2026 |
| Australia Awards (Africa) | **Re-checked 2026-09-01**: 2027 intake closed; official page states the 2028 intake "will open in February 2027" with no exact date. Nigeria's participation not stated on the apply page. DFAT's own robots.txt timed out again. | Feb 2027 |
| Global Korea Scholarship | **Re-checked 2026-09-01** — real domain found (`studyinkorea.go.kr`, robots allows all but `/Sims/`). Graduate cycle runs Feb–Mar per the official page, but the page gives **no exact date** and does not confirm Nigeria's eligibility. Same treatment as Stipendium Hungaricum: not added until eligibility is confirmed. | Jan 2027 |
| Nottingham Developing Solutions | **Re-checked 2026-09-01**: Nigeria IS eligible ("Africa (all nations)"), but the page says "The application deadline has now passed" and publishes no next-cycle date. Nothing blocks adding it once a date appears. | Jan 2027 |
| Westminster Full International | Official page returns **HTTP 403 to automated access** despite a permissive robots.txt — the deadline cannot be machine-verified. Needs a human to read the page. | Next pass (by hand) |
| Clarendon Fund (Oxford) | ox.ac.uk returns **HTTP 403 to automated access**. | Next pass (by hand) |
| Melbourne Graduate Research | scholarships.unimelb.edu.au returns **HTTP 403** on robots.txt itself. | Next pass (by hand) |
| Bocconi | Guessed slug 404ed; real URL not yet found | Next pass |
| Yenching Academy (PKU) | Guessed slug 404ed; real URL not yet found | Next pass |
| Trudeau Foundation | Guessed slug 404ed; real URL not yet found | Next pass |

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

## Draft data-policy update for §10 item 19 (founder to approve)

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

Once approved, CLAUDE.md's open-decisions section should move item 19 from
"still open" to resolved-with-policy, citing this file.
