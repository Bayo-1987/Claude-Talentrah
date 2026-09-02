import type { JobSourceConfig } from "./types";

/**
 * Founder decision, 2026-09-02: scale the external job pipeline within the
 * permitted-source rules Moniepoint and Workable were already vetted under —
 * growth comes from upstream and from permitted sources only, never from the
 * four disqualified boards below and never from LinkedIn in any form. This
 * SCALES the mechanism; it does NOT waive CLAUDE.md §10's standing
 * recommendation for an external legal review of schema.org data
 * redistribution before this relies on it commercially at larger scale —
 * that review is still owed, unchanged.
 *
 * Every entry below was vetted the same three ways as Moniepoint and
 * Workable: (1) live API/markup verification with real matching jobs, not a
 * guessed token, (2) robots.txt / Terms of Service check, (3) evidence
 * recorded here so the same research is never silently repeated. A GUESSED
 * TOKEN IS NOT EVIDENCE — `flutterwave`, `paystack`, `kuda`, `interswitch`,
 * `moove`, `andela`, `carbon`, `mntn` and `helium` were all tried and either
 * 404'd or resolved to a COMPLETELY DIFFERENT COMPANY that happens to own the
 * same short token (`carbon` → a US 3D-printing company; `mntn` → a US
 * adtech company, not MTN Group). Guessing plain-lowercase tokens against
 * Greenhouse's API has a low hit rate and a real false-positive risk; every
 * token actually shipped below was confirmed to return that exact company's
 * real jobs, not merely a 200 status.
 *
 * ── THE FOUR DISQUALIFIED BOARDS STAY DISQUALIFIED ─────────────────────────
 *
 *   - hotnigerianjobs.com — robots.txt names ClaudeBot/GPTBot/CCBot and
 *     other AI crawlers explicitly, `ai-train=no, use=reference`.
 *   - jobberman.com — robots.txt disallows `/job/`, the individual-posting path.
 *   - myjobmag.com — not blocked by robots.txt, but a real listing page has
 *     no `<script type="application/ld+json">` JobPosting block at all.
 *   - fuzu.com — passed *both* the robots.txt check (no AI-crawler block) and
 *     the JobPosting JSON-LD check (verified live: real title/hiringOrganization/
 *     datePosted on `/nigeria/jobs/<slug>`) — disqualified anyway on a check
 *     the brief's checklist didn't name but that matters more: its Terms of
 *     Service (`fuzu.com/legal/terms`) explicitly prohibit "automated tools
 *     to scrape... platform data" and "redistributing, or aggregating
 *     [Candidate or Employer data] without authorisation". robots.txt governs
 *     bot *access*; it doesn't grant a license to republish. Don't reopen
 *     this source without a real authorisation conversation with Fuzu.
 *
 * These are a founder decision, not a technical limitation — do not reopen
 * any of the four without a fresh, explicit decision to do so.
 *
 * ── GREENHOUSE ──────────────────────────────────────────────────────────────
 *
 * Moniepoint — the original seed source, unchanged (~127-133 open roles,
 * verified against the live API repeatedly across this project's history).
 *
 * Wave (`wavemm1`) — verified live 2026-09-02: HTTP 200, 72 real jobs, every
 * job's own `company_name` field reads "Wave". Sample postings ("Agent
 * Liquidity Lead" in Cameroon, "Agent Operations Regional Lead" across Sierra
 * Leone/Malawi/Burkina Faso) match Wave's actual Francophone+Anglophone
 * African mobile-money footprint, not a same-named unrelated company.
 *
 * Jumia (`jumia`) — verified live 2026-09-02: HTTP 200, 11 real jobs,
 * `company_name` = "Jumia". Sample postings ("CS Sales Team Lead" Nigeria,
 * "Finance Treasury Accountant" Egypt, "Head of Sales Network" Uganda, "Key
 * Account Manager" Kenya/Ghana) match Jumia's real pan-African e-commerce
 * operations. Note: Jumia's own careers page is hosted on the EU variant
 * (`job-boards.eu.greenhouse.io/jumia`), but the board's data is served from
 * the standard `boards-api.greenhouse.io` host `fetchGreenhouseJobs` already
 * calls — no fetcher change needed, just the token.
 *
 * Checked and NOT added, so the search is not repeated: Flutterwave, Kuda,
 * Interswitch, Piggyvest, Cowrywise, Bamboo, OPay, PalmPay, Twiga Foods,
 * 54gene — no working Greenhouse or Lever token found for any of them
 * (several use Workable, Teamtailor or their own ATS instead; Paystack HAD a
 * Greenhouse board but both its token and its old direct job-page URLs now
 * 404 — the postings expired and it is not currently usable). Andela's
 * careers page links only to its own proprietary `talent.andela.com`
 * platform, no third-party ATS to ingest from.
 *
 * ── LEVER ───────────────────────────────────────────────────────────────────
 *
 * This file used to say the Lever fetcher was "unreliable from inside this
 * dev environment's Next.js runtime specifically" and shipped with no live
 * source as a result. Re-tested 2026-09-02 against a real token through the
 * actual Next.js server runtime (not a plain curl) via a throwaway diagnostic
 * route, deleted immediately after: `fetchLeverJobs("apolloagriculture", ...)`
 * returned both of Apollo Agriculture's live postings correctly — full
 * title/location/employmentType/structuredJd/dedupFingerprint, no failure of
 * any kind. Whatever produced the original quirk (a different token, a since-
 * resolved Node/Next version issue) is not reproducible against this real
 * token in this runtime — the earlier note stands as history, not as a
 * reason to keep avoiding Lever.
 *
 * Apollo Agriculture (`apolloagriculture`) — verified live 2026-09-02: HTTP
 * 200, 2 real jobs ("Manager - Credit & Repayment Operations" in Lusaka,
 * Zambia; "Manager – Credit Strategy & Operations", remote within East
 * Africa), team "Credit" on both. Apollo Agriculture is a Kenya/Zambia
 * agri-fintech financing smallholder farmers — content matches company
 * identity, not a same-named unrelated org. WORTH RECHECKING PERIODICALLY:
 * two live postings is a thin board, and it is this pipeline's only Lever
 * source, so losing it silently would be easy to miss.
 *
 * Checked and NOT added: InstaDeep's Lever board is stale (the live page
 * 404s and the API returns an empty list — it has migrated off Lever since
 * being indexed elsewhere). Wahed Invest is real and verified (21 live jobs)
 * but is not primarily an African-headquartered/operated employer (postings
 * in Sharjah/London/USA/India) despite a Nigerian founder — left out as not
 * fitting this pipeline's actual market focus, a judgment call rather than a
 * disqualification on permission grounds.
 *
 * ── SCHEMA.ORG / WORKABLE ────────────────────────────────────────────────
 *
 * `jobs.workable.com`'s permission signal is ORIGIN-WIDE, not scoped to
 * `/search/nigeria` specifically — `Content-Signal: search=yes, ai-input=yes,
 * ai-train=no` sits under a bare `User-agent: *` with `Allow: /search/*` —
 * so adding more country paths under the same origin needs no fresh ToS
 * research, only confirming each path actually resolves and carries the same
 * JobPosting JSON-LD shape. Nigeria's original vetting is unchanged; see
 * tests/jobs/fixtures/workable-job-posting.json for its captured fixture.
 *
 * Kenya, Ghana, South Africa — all three reconfirmed live 2026-09-02: HTTP
 * 200, a real `ItemList` JSON-LD block with 20 sampled items each (Workable
 * paginates past 20 — treat that as a sample, not the page's true total).
 * Real companies observed: Kenya — Sihamco, CGIAR, Vivo Energy, Tatu City,
 * FairMoney; Ghana — Rising Academies, Access Bank Plc, ChainGPT, Intellect;
 * South Africa — RemotePass, Ten Group, Spark Schools, Kingmakers. South
 * Africa's URL slug is `south-africa` (hyphenated) — `southafrica` also
 * resolves, to an identical list with its own self-referential canonical
 * tag, so either works, but `south-africa` was chosen for reading
 * consistently next to `kenya`/`ghana`.
 *
 * Sampled overlap check across the four Workable country pages and the
 * Greenhouse/Lever companies above: none of Wave, Jumia, Moniepoint or Apollo
 * Agriculture appeared by name in any of the three new countries' sampled 20
 * results. FairMoney did appear twice — as its own Workable company board
 * AND inside the Kenya country search — which is exactly the shape
 * `computeDedupFingerprint`'s hardened location-canonicalization (see
 * src/lib/jobs/dedup.ts) exists to collapse correctly if the same posting is
 * ever independently discovered through two of these configs at once.
 */
export const JOB_SOURCES: JobSourceConfig[] = [
  { source: "greenhouse", token: "moniepoint", companyName: "Moniepoint" },
  { source: "greenhouse", token: "wavemm1", companyName: "Wave" },
  { source: "greenhouse", token: "jumia", companyName: "Jumia" },
  { source: "lever", token: "apolloagriculture", companyName: "Apollo Agriculture" },
  {
    source: "schema-org",
    url: "https://jobs.workable.com/search/nigeria",
    label: "workable-nigeria",
  },
  {
    source: "schema-org",
    url: "https://jobs.workable.com/search/kenya",
    label: "workable-kenya",
  },
  {
    source: "schema-org",
    url: "https://jobs.workable.com/search/ghana",
    label: "workable-ghana",
  },
  {
    source: "schema-org",
    url: "https://jobs.workable.com/search/south-africa",
    label: "workable-south-africa",
  },
];
