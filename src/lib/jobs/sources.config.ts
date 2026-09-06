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
 *
 * CONFIRMED LIVE, NOT JUST SAMPLED: the first production run after these
 * sources shipped (2026-09-02) showed Nigeria and Kenya each upserting FEWER
 * open rows than they fetched (Nigeria 17 of 20, Kenya 19 of 20) — that is
 * this exact mechanism firing for real, not a bug. `ingestAllSources` runs
 * `JOB_SOURCES` in array order, so when a posting's canonicalised fingerprint
 * matches one an EARLIER config in this list already wrote this same run,
 * the later config's upsert updates that same row (via ON CONFLICT) rather
 * than creating a second one — the row ends up attributed to whichever
 * config ran LAST among the colliding set. Verified by reconciliation, not
 * assumed: 298 total fetched across all 8 sources that run vs 294 total open
 * rows afterward — a difference of exactly 4, matching Nigeria's shortfall
 * of 3 plus Kenya's shortfall of 1 precisely. If a future run shows a
 * similar per-source shortfall, check the reconciliation total before
 * treating it as a lost posting — it almost certainly means the same job
 * was independently discovered through two of these configs at once, exactly
 * as designed.
 *
 * ══ STAGE 9, 2026-09-04 — NIGERIA CITY PAGES, FIVE MORE EMPLOYERS ══════════
 *
 * Goal of this round: raise the Nigeria-location share of the external feed
 * (measured floor 27.0% — 79 of 293 open) and reduce the feed's real
 * concentration risk. That second goal was FIRST measured wrong — as
 * `external_source = "greenhouse"`'s share of the feed, an API-bucket number
 * this round initially failed to move under ~40% — and was corrected on
 * founder review to the metric that actually matters, PER-EMPLOYER share of
 * open and fresh inventory. By the corrected metric, both goals are met; see
 * "THE METRIC THAT MATTERS" below for the real numbers and why the original
 * one was measuring the wrong thing.
 *
 * ── WHAT WAS ADDED: FOUR NIGERIA CITY PAGES ON THE WORKABLE ORIGIN ─────────
 *
 * `jobs.workable.com/search/<term>` is not country-only — city terms resolve
 * too, on the SAME origin whose permission signal is already vetted
 * origin-wide (see the Workable section above; `robots.txt` re-read
 * 2026-09-04, unchanged: `Content-Signal: search=yes, ai-input=yes,
 * ai-train=no`, `Allow: /search/*`). All four verified live 2026-09-04 by
 * fetching the listing's `ItemList` AND every linked job page, then reading
 * each one's `hiringOrganization` and `jobLocation.address`:
 *
 *   lagos          20 items, 11 employers, 16 with a Nigeria address string.
 *                  NALA, Kora, Renmoney, Rentokil Initial, Tetra Maritime,
 *                  Alaro City, Kingmakers, Human Intelligence, FairMoney,
 *                  Reliance Health, Helium Health.
 *   abuja          20 items,  9 employers, 17 Nigeria. Kuda Technologies,
 *                  Evidence Action, FairMoney, Reliance Health, IITA,
 *                  Daystar Power, Phillips Consulting, Raenest, Intellect.
 *   ibadan         20 items,  4 employers, 16 Nigeria — dominated by IITA
 *                  (International Institute of Tropical Agriculture, which is
 *                  physically headquartered in Ibadan), plus FairMoney.
 *   port-harcourt  10 items,  4 employers,  8 Nigeria. FairMoney,
 *                  Reliance Health, D2M Services, Intellect.
 *
 * These are NOT a re-slice of `workable-nigeria`. Measured, not assumed:
 * against the union of the four existing Workable sources, the four cities
 * contribute 65 fingerprints that were not already there (lagos +18,
 * abuja +19, ibadan +20, port-harcourt +8 in array order), and 57 of those
 * carry a Nigeria-matching location string.
 *
 * THE EXISTING `workable-nigeria` SOURCE CONTRIBUTES ZERO NIGERIA-MATCHING
 * LOCATION STRINGS, which is worth knowing before anyone assumes it is the
 * Nigeria source. Its 20 results are remote-in-Nigeria roles (Dentons,
 * Reliance Health, Helium Health, Soar With Us, ChainGPT…) whose JSON-LD
 * carries a remote flag and an EMPTY address, so `formatLocation` yields
 * "Remote" with no country in it. It is still a good source — those are real
 * jobs open to Nigerians — but every Nigeria-location string in the feed
 * today comes from Greenhouse, and now from these four city pages.
 *
 * ── WORKABLE RATE-LIMITS, AND IT LOOKS EXACTLY LIKE AN EMPTY BOARD ─────────
 *
 * The single most important operational finding of this round, because it
 * caps how far this mechanism can be pushed and it is INVISIBLE in the
 * output. Driven hard from one client, `jobs.workable.com` starts answering
 * listing requests with HTTP 200 and a well-formed page carrying NO
 * `ItemList` items — not a 429, not an error. Observed 2026-09-04: a
 * sequential 14-source simulation (sources one at a time, 5 concurrent
 * detail fetches within each, i.e. the fetcher's real shape) completed the
 * first nine sources normally, then returned zero items for every source
 * after them; a second run minutes later returned zero from the SECOND
 * source onward, and all of them returned 20 again after a pause. It is a
 * rolling per-client budget, and a fetch starved by it is indistinguishable
 * from a genuinely empty board.
 *
 * Two consequences, both already handled but neither obvious:
 *   - `ingest.ts`'s empty-fetch guard is what makes this survivable — a
 *     source that returns nothing skips closure, so a throttled run costs a
 *     refresh, not the feed. That guard is the reason this is a caution and
 *     not a defect. See tests/jobs/empty-fetch-guard.test.ts.
 *   - It is survivable but not free: `last_checked_at` only advances on a
 *     successful upsert, so a source throttled for 72 hours straight has its
 *     rows closed by expiry.ts's staleness backstop. Persistent throttling
 *     eventually empties a source rather than freezing it.
 *
 * RECORDED AS A SOURCE CHARACTERISTIC, NOT ACTED ON — founder decision,
 * 2026-09-04: the existing empty-fetch guard already covers this correctly
 * (a starved fetch and a genuinely empty board must both skip closure, and
 * do), so there is nothing here that needs building. This paragraph exists
 * so the next person who sees a Workable source go quiet checks this section
 * before assuming the board is dead or the fetcher is broken.
 *
 * This is why FOUR sources were added and not fourteen. Six further country
 * pages were verified live and are deliberately NOT shipped (see below);
 * ordering below also follows from it — the Nigeria city pages sit
 * immediately after `workable-nigeria`, ahead of Kenya/Ghana/South Africa,
 * so that if a run is throttled part-way the sources that get starved are
 * the ones furthest from this product's primary market. Watch the first few
 * production runs against the admin ops "source that has never yielded
 * anything" check (src/lib/admin/ops/queries.ts) before adding a ninth.
 *
 * VERIFIED LIVE, READY, HELD BACK ON THE RATE-LIMIT CEILING ONLY — all
 * checked 2026-09-04, all 200 with a real `ItemList` and real employers, so
 * nobody needs to re-research them: egypt (20 items, 15 employers — Abou
 * Ghaly Motors, Dsquares, Nawy Real Estate, Egyptian Banks Company),
 * mozambique (20/9 — Access Bank Plc, Fénix Multservice, SDO Moçambique,
 * Street Child, WaterAid), senegal (20/10 — CIMMYT, REACH, Vivo Energy,
 * Tehora), cameroon (20/8 — Apave Cameroun, Control Risks, Maviance,
 * ProgressSoft), zambia (20/6 — Action Against Hunger, iDE, IITA, TopFloor),
 * tanzania (20/9 — Cuso International, VillageReach, WaterAid, Vivo Energy).
 * Marginal distinct contribution over everything shipped here: egypt +20,
 * senegal +19, cameroon +19, mozambique +19, zambia +17, tanzania +16.
 *
 * CHECKED AND NOT ADDED, so the search is not repeated. Nigerian cities too
 * thin to be worth a source: kano (4 items, all FairMoney, all duplicating
 * roles already listed under Abuja/Port Harcourt), kaduna (3), enugu (3),
 * uyo (3), onitsha (1), abeokuta (1), benin-city (0 — resolves 200 with an
 * empty ItemList, i.e. no Workable inventory there at all). Other African
 * country pages rejected on fit rather than volume: morocco (20/17) and
 * tunisia (20/13) are dominated by global BPO/remote-staffing firms
 * (SupportYourApp, Volga Partners, Intetics, RemotePass) rather than
 * employers hiring into the market this product serves; ethiopia (20/5),
 * zimbabwe (12/2), botswana (10/5) and ivory-coast (20/11) are thin on real
 * distinct employers, several of them the same remote-staffing aggregators
 * (Huzzle, Pavago). rwanda and uganda are effectively empty (0 and 3 items).
 *
 * A PATH SHAPE THAT LOOKS LIKE A FEATURE AND IS NOT: `/search/<term>` answers
 * 200 for terms that are not places. `/search/fairmoney` returns 200 with 20
 * items — the IDENTICAL employer set as `/search/lagos`, not FairMoney's
 * board — and `/search/remote-nigeria` returns another Lagos-shaped set. A
 * 200-with-items on this origin is NOT evidence that the term means what you
 * think; read the returned jobs' `jobLocation` before shipping a path. Also
 * dead ends: `/search/nigeria/remote` and `/search/nigeria/lagos` both 404,
 * and pagination past the first 20 needs a query string, which this origin's
 * robots.txt disallows (`Disallow: /search*?*`). Twenty items per path is the
 * ceiling of what this mechanism can legitimately take.
 *
 * ── SEAMLESSHR: NO USABLE SOURCE, AND THE REASON IS STRUCTURAL ─────────────
 *
 * The strongest structural lead of this round, and it does not work. Checked
 * 2026-09-04:
 *   - There is NO cross-tenant SeamlessHR jobs portal. `seamlesshiring.com`
 *     301s to `seamlesshr.com/recruitment-management`, a marketing page. The
 *     ATS is multi-tenant by SUBDOMAIN — `<company>.seamlesshiring.com`, e.g.
 *     `seamlesshr.seamlesshiring.com/job/view/2772/senior-sales-manager-nigeria`
 *     — so there is no single multi-employer URL to ingest, only one URL per
 *     customer, which is the opposite of the Workable-shaped source that made
 *     this lead attractive.
 *   - The tenant pages are permitted (`<tenant>.seamlesshiring.com/robots.txt`
 *     is `User-agent: * / Disallow:` — allow everything) and fully
 *     server-rendered, 82KB of real HTML with a correct `<title>` and Open
 *     Graph tags. They carry ZERO `<script type="application/ld+json">`
 *     blocks. Checked a second way after the first empty result — regex
 *     re-run case-insensitively over newline-flattened HTML: 0 ld+json,
 *     0 occurrences of the string "JobPosting", 1 stray "schema.org". The
 *     page describes itself with `og:*` and `itemprop` meta tags only. Same
 *     disqualification as myjobmag.com: not blocked, just not marked up.
 *   - SeamlessHR does publish a jobs API (`docs.seamlesshr.com/reference/jobs`)
 *     — that is a bespoke API client plus almost certainly a per-tenant
 *     credential, i.e. a larger change and a commercial conversation, not a
 *     config entry. Recorded as a finding, deliberately out of this PR.
 *   - SeamlessHR's own hiring is on its own tenant, not on Greenhouse or
 *     Lever (`seamlesshr` and `seamless` both 404 on the Greenhouse API).
 *
 * ── VC PORTFOLIO JOB BOARDS: BLOCKED AT THE PLATFORM, NOT THE FUND ─────────
 *
 * `jobs.venturesplatform.com` (Ventures Platform, the Nigerian VC) exists and
 * is real, and it is unusable — not because of anything Ventures Platform
 * did, but because of the white-label platform underneath it. It is a Getro
 * board, and Getro answers a plain fetch with HTTP 403 while serving a
 * robots.txt that is a sales message rather than a rule set: "We'd be happy
 * to provide all job data to you through our API services. It's more
 * cost-effective than using proxies. Please contact us at api@getro.com."
 * That is an explicit refusal of direct collection plus a paid alternative,
 * which puts it in the same category as Fuzu — a partnership/authorisation
 * conversation, not a technical obstacle to route around. Confirmed on two
 * further Getro origins (`jobsinvc.getro.com`, `community.getro.com`): both
 * 403 identically, so this is the platform's posture, not one fund's.
 *
 * Getro white-labels the great majority of VC portfolio boards (it advertises
 * 850+ VC/community customers), so treat "is this a Getro board?" as the
 * FIRST question for any future VC-portfolio lead — if it is, the answer is
 * already known and the next step is api@getro.com, not another fetch.
 *
 * Guessed `jobs.<fund>.com` subdomains for TLcom Capital, Partech, Future
 * Africa, Ingressive Capital, Norrsken22, Launch Africa, CRE Venture Capital,
 * EchoVC, Aruwa Capital and LoftyInc all fail DNS outright (connection never
 * established, not a 404) — recorded so nobody re-guesses them. Any real
 * board for those funds has to be found by search, and if found will most
 * likely be Getro.
 *
 * ── OTHER ATS PLATFORMS: CLIENT-RENDERED, SO INVISIBLE TO THIS FETCHER ─────
 *
 * `jobs.ashbyhq.com/<company>` emits no JSON-LD in its server HTML, and — the
 * part that matters — it answers 200 for a slug that does not exist at all
 * (`/zzz-not-a-real-company-xyz` returns the same empty SPA shell as
 * `/flutterwave`). A 200 from Ashby proves nothing whatsoever; do not read
 * one as a found board. Same shape at `apply.workable.com/<company>/`: the
 * origin's robots.txt is permissive and carries Workable's same
 * `Content-Signal: search=yes, ai-input=yes, ai-train=no`, but the company
 * board pages (fairmoney, reliance-health, renmoney, kora, helium-health, all
 * 200) carry zero ld+json — they hydrate client-side. So a single-employer
 * Workable board is NOT reachable this way; those employers reach the feed
 * only through the `jobs.workable.com/search/*` pages above.
 *
 * ── MORE NIGERIAN BOARDS CHECKED (none usable) ────────────────────────────
 *
 *   - jobzilla.ng — robots.txt names ClaudeBot with `Disallow: /` explicitly
 *     (alongside CCBot, Bytespider, Amazonbot, Google-Extended and others).
 *     Same disqualification shape as hotnigerianjobs.com.
 *   - jobgurus.com.ng — Cloudflare content-signals robots and HTTP 403 to a
 *     plain fetch.
 *   - worknigeria.com — robots.txt IS permissive (`Disallow:` empty, only
 *     login/dashboard paths blocked), but `/jobs` carries no ld+json at all.
 *     Not blocked, just not marked up.
 *   - ngcareers.com — serves no robots.txt (the path returns the site's HTML),
 *     and its markup pulls from `i.roamcdn.net`, i.e. it is part of the same
 *     ROAM/Ringier group as jobberman.com. Left alone on both counts.
 *   - reliefweb.int — robots.txt does NOT disallow `/jobs`, which made it
 *     worth checking for the large Nigerian humanitarian-sector volume, but
 *     the `/jobs` listing carries no `ItemList` JSON-LD, so this fetcher has
 *     no way to discover the individual postings. Would need a bespoke client
 *     against ReliefWeb's own API. Recorded as a finding, out of scope here.
 *
 * ── FIVE MORE GREENHOUSE BOARDS: ADDED, ON A CORRECTED READING OF RISK ────
 *
 * All five verified live 2026-09-04 against
 * `boards-api.greenhouse.io/v1/boards/<token>/jobs`, each returning that
 * exact company's real jobs (not a same-token stranger, the `mntn`/`carbon`
 * trap above), freshness re-verified against the live `updated_at` field
 * 2026-09-04:
 *
 *   oneacrefund   49 jobs (10 updated in the last 7 days), `company_name`
 *                 "One Acre Fund", 6 with a Nigeria location ("Nigeria Chief
 *                 of Staff" Minna; "Agroforestry Innovations Specialist"
 *                 Bauchi; "Nigeria State Expansion Specialists"
 *                 Kano/Jigawa/Gombe), rest Rwanda/Burundi/Kenya.
 *   alxafrica     13 jobs (13 fresh), "ALX Africa", 1 Nigeria ("Community
 *                 Associate: Lagos"), rest Kigali/remote.
 *   scangroup     15 jobs (4 fresh), "Scangroup" (WPP Scangroup), Kenya/Ghana.
 *   educate       12 jobs (1 fresh), "Educate!", Uganda/Rwanda/Tanzania.
 *   oafkenya       7 jobs (2 fresh), "One Acre Fund - Kenya", all Kenya.
 *
 * THIS ROUND FIRST HELD THESE BACK, AND THAT WAS THE WRONG CALL — corrected
 * on founder review, worth recording exactly why. The original reasoning
 * measured risk by `external_source` bucket: "greenhouse" reports every
 * Greenhouse board as one value, so adding boards to it looked like adding to
 * the concentration problem. That bucket is an API detail, not a business
 * risk — Greenhouse itself cannot stop hiring. The real fragility is PER
 * EMPLOYER, and by that measure Moniepoint alone was ALREADY 133 of 293 open
 * postings (45.4%) and 28 of 68 fresh (41.2%) BEFORE this round touched
 * anything — a single real company most of this feed's Nigerian-market
 * external supply depended on, hiding inside a metric that only ever
 * complained about the wrapper. Five MORE employers under that same wrapper
 * does not concentrate risk in Moniepoint; it dilutes it, by construction —
 * every one of these five is a distinct company that keeps hiring
 * independently of whether Moniepoint does. See the per-employer section
 * below for the corrected metric and the numbers this produces.
 *
 * Also checked and rejected on market fit rather than permission, matching
 * the Wahed Invest precedent: `pharomanagement` (10 jobs, real, but a hedge
 * fund hiring mostly into New York/Abu Dhabi) and Lever's `tala` (8 jobs,
 * real, but every posting in Mexico/India/the Philippines — Tala's African
 * hiring is not on that board).
 *
 * GREENHOUSE/LEVER TOKENS TRIED AND 404, added to the standing do-not-retry
 * list above: seamlesshr, seamless, kobo360, lidya, bentoafrica, vendease,
 * reliancehealth, heliumhealth, sabi, wasoko, maxab, chari, cellulant,
 * termii, norebase, kippa, tractionapps, payhippo, wallet, wemabank,
 * zenithbank, gtco, gtbank (Greenhouse); mkopa, sunking, greenlightplanet,
 * copiaglobal, wasoko, sokowatch, mpharma, zipline, sunculture,
 * burnmanufacturing, komaza, sanergy, koko, dlight, bboxx, jumo, branch,
 * cellulant, lifebank, fieldintelligence (Lever). On Helium Health
 * specifically — the file previously recorded a bare `helium` as tried and
 * rejected, and the open question was whether it uses a different token.
 * ANSWERED: it does not use Greenhouse at all. Helium Health hires on
 * Workable, and its postings already reach this feed through
 * `workable-nigeria` ("Senior Frontend Engineer (VueJS / React)", "Senior
 * Backend Engineer (NodeJS)", both seen live 2026-09-04). Kuda is the same
 * story via `workable-abuja` (Direct Sales Agent, Kuda Technologies Ltd) —
 * a company rejected as a Greenhouse token is not necessarily absent from
 * the feed.
 *
 * ── LEVER/APOLLO AND WORKABLE GHANA: BOTH KEPT, BOTH RE-VERIFIED ──────────
 *
 * Both were re-checked 2026-09-04 rather than judged on their staleness
 * numbers. Apollo Agriculture's Lever board is alive and serving the same two
 * real postings (Lusaka credit ops; remote-in-East-Africa credit strategy) —
 * quiet, not defunct, not a migrated board serving cached junk. Workable
 * Ghana is alive with 20 real postings from 10 employers (Access Bank Plc,
 * Rising Academies, Appolonia City, Tatu City, OpenFN, FounderVine,
 * Rentokil Initial…), none of them fresh in 7 days — again quiet, not broken.
 * Neither is retired. Retiring a low-volume source cannot reduce
 * concentration: it removes from the denominator without touching
 * Greenhouse's absolute count, so it makes the ratio worse while also costing
 * the only Lever source this pipeline has. They cost one HTTP request each
 * per run. Keep them, and keep watching Apollo — a two-posting board is one
 * quiet quarter away from being genuinely dead, and it would be easy to miss.
 *
 * ── THE METRIC THAT MATTERS: PER-EMPLOYER SHARE, NOT PER-API-SOURCE SHARE ──
 *
 * Corrected on founder review, 2026-09-04. This round originally tracked
 * `external_source = "greenhouse"`'s share of the feed and reported failing
 * to get it under ~40%. That number conflates three independent companies
 * (Moniepoint, Wave, Jumia) into one bucket because they happen to share an
 * ATS, and an ATS is not a business that can stop hiring — so the number was
 * measuring the wrong kind of fragility. What actually matters is: is any
 * ONE EMPLOYER's departure or slowdown enough to visibly thin the feed?
 * Target: no single employer above ~40% of open or fresh inventory.
 *
 * Real numbers, `company_name`-level, queried directly against production
 * (not estimated) for the baseline and the already-live sources, and
 * measured live against each new source's own API/markup for the additions
 * (Workable: distinct fingerprints not already in the feed; Greenhouse:
 * `updated_at` within 7 days as the freshness proxy, since these rows do not
 * exist yet to carry a real `posted_at`):
 *
 *   BASELINE, before this round touched anything (2026-09-04):
 *     open postings total       293
 *     Moniepoint                133 open (45.4%)   28 fresh/68 (41.2%)  [>40%, BOTH]
 *     Wave                       69 open (23.5%)    9 fresh/68 (13.2%)
 *     Jumia                      11 open  (3.8%)    3 fresh/68  (4.4%)
 *
 *   Moniepoint alone was already over the 40% line on both measures, on the
 *   ORIGINAL three-source config, before Stage 9 shipped anything — a single
 *   real company most of this feed's supply depended on, invisible in a
 *   metric that only ever complained about the ATS wrapper.
 *
 *   PROJECTED, with the four Workable city pages AND the five new Greenhouse
 *   boards above (65 distinct Workable fingerprints across many small
 *   employers, none individually large — see the city breakdown above; 96
 *   Greenhouse open / 30 fresh across 5 NEW distinct companies):
 *     open postings total       454   (293 + 65 + 96)
 *     fresh-in-7d total         114   (68 + 16 + 30)
 *     Moniepoint                133 open (29.3%)   28 fresh/114 (24.6%)  [under 40%]
 *     Wave                       69 open (15.2%)    9 fresh/114  (7.9%)
 *     next largest, oneacrefund  49 open (10.8%)   10 fresh/114  (8.8%)
 *
 * Moniepoint's own posting count is UNCHANGED — this is dilution, not
 * reduction, and it is real: five more companies that hire independently of
 * Moniepoint now sit in the same feed. No employer in the projected mix is
 * within reach of 40% on either measure. This is why the five Greenhouse
 * boards above are shipped rather than held: held back, they defend a metric
 * that was measuring the wrong thing; shipped, they fix the thing that
 * metric was supposed to be a proxy for and never was.
 *
 * Nigeria-location share also improves as a side effect of the same
 * additions: 27.0% (79/293) → 38.0% (136/358, Workable cities only; the five
 * Greenhouse boards add mostly Rwanda/Kenya/Uganda locations, not Nigeria,
 * so they don't move this number further) — short of a round "40%" but a
 * real, measured gain, not claimed as a target this round separately set.
 *
 * WHAT WOULD STILL GROW THIS FURTHER, for whoever picks up a future round:
 * Workable is the only permitted multi-employer schema.org origin found, it
 * caps at 20 items per path, pagination past that needs a robots-disallowed
 * query string, and it rate-limits at roughly a dozen paths per run — call it
 * ~200 postings of headroom on that origin, most of it now taken (see the
 * rate-limit section above for the 6 country pages verified live and held
 * back on that ceiling, and the Nigerian-city and other-country pages
 * checked and rejected on thinness or market fit). Every other multi-employer
 * board checked this round is either explicitly blocked, not marked up, or a
 * founder decision (SeamlessHR's API, Getro's API, ReliefWeb's API are each a
 * bespoke client plus, in two of the three cases, a commercial conversation
 * — see their sections above). None of that changes the per-employer
 * conclusion above; it only bears on how much MORE could be added later.
 *
 * ══ WORKABLE COMPANY BOARDS: KUDA, VIA THE PER-COMPANY WIDGET API ═══════════
 *
 * Founder-reported gap, 2026-09-05: Kuda Technologies has 15 open roles on
 * Workable, 11 of them in Lagos, and this feed carried exactly one (the Abuja
 * "Direct Sales Agent", via `workable-abuja` above) plus a closed Cape Town
 * Scrum Master. ROOT CAUSE, confirmed rather than re-derived: `workable-abuja`
 * and every other `jobs.workable.com/search/<term>` entry above is a
 * MULTI-EMPLOYER search page capped at 20 items (see the rate-limit section
 * above) — Kuda's 11 Lagos roles were competing for one page's worth of space
 * against every other Lagos employer on Workable, not being filtered out by
 * anything. This is a volume-cap problem, and the fix is the same shape
 * Greenhouse/Lever already use: a per-company board, not a search page.
 *
 * THE ENDPOINT. `https://apply.workable.com/api/v1/widget/accounts/<account>`
 * — Workable's own documented "job widget"
 * (help.workable.com/hc/en-us/articles/115012801727-How-to-embed-jobs-on-your-website-job-widget),
 * the feature a Workable customer uses to embed their own board on their own
 * careers page. It is public and unauthenticated for any known account slug —
 * confirmed live, not assumed: a plain `curl` with no API key or session
 * returns 200 and real job data. Same openness class as
 * `boards-api.greenhouse.io`/`api.lever.co` above, and the fetcher lives at
 * src/lib/jobs/sources/workable.ts, structured the same way. Adding
 * `?details=true` was found by testing, not documented anywhere found in
 * Workable's public docs: without it the endpoint omits `description`
 * entirely; with it, every job carries the same real HTML content shape
 * Greenhouse's `content` field does.
 *
 * KUDA'S ACCOUNT SLUG WAS CONFIRMED, NOT GUESSED — the exact trap this file's
 * opening section warns about. `kuda` and `kuda-technologies` both resolve
 * (200) on the widget endpoint, and only one is real: `kuda` returns
 * `"name": "Kuda Technologies Ltd"` with 16 live job entries, matching the
 * exact company name on Kuda's own JSON-LD posting already in this feed
 * (`workable-abuja`'s "Direct Sales Agent... at Kuda Technologies Ltd").
 * `kuda-technologies` returns a DIFFERENT, shorter name — "Kuda Technologies"
 * — with zero jobs, i.e. an empty or decoy account that happens to share a
 * guessable token. The slug itself was found by following real links, not by
 * guessing at all: `jobs.workable.com/search/abuja`'s canonical Kuda listing
 * links to `apply.workable.com/j/E96B878F8B`, which serves a bare
 * "Redirecting to /kuda/j/E96B878F8B" — that path segment is the account.
 *
 * GROUND TRUTH, RECONCILED. The widget returns 16 raw job entries for `kuda`,
 * not 15 — the founder's number and this feed's are the same 15 DISTINCT
 * roles, and the 16th is not a 16th role. Workable's widget flattens a
 * requisition posted to multiple locations into one array entry PER
 * location: "Vice President of Engineering" (shortcode `61F507FDD7`) appears
 * twice, once tagged Cape Town and once Johannesburg, otherwise identical.
 * `fetchWorkableJobs` dedupes on `shortcode` before mapping (see that file
 * for why silently keeping both would be worse than the bug
 * `disambiguateFingerprint` in ingest.ts already guards against — this is one
 * requisition counted twice, not two different ones colliding). Deduped to 15
 * distinct roles, 11 of them Lagos (Backend Engineer, Data Analyst - Credit,
 * IOS Engineer, Portfolio Analysis & Reporting - Lead, Scrum Master, two
 * Senior iOS Engineer postings, Senior Product Manager - Credit, Senior
 * Software Engineer, Software Development Engineer in Test (SDET), VP of
 * Engineering) — exactly the founder's count on both numbers. The remaining
 * 4: Direct Sales Agent (Abuja, already in the feed via `workable-abuja` and
 * now deduped against this source — see the placement comment on the config
 * entry below), Scrum Master (Cape Town), a second SDET (Cape Town), and the
 * deduped Vice President of Engineering (Cape Town/Johannesburg, the one
 * `telecommuting: true` posting on the board).
 *
 * WORK TYPE: A REAL FIELD, CHECKED RATHER THAN ASSUMED EITHER WAY. Unlike
 * Greenhouse (no field at all) and like Lever (`workplaceType`), Workable's
 * widget carries `telecommuting`, a boolean — but unlike Lever's three-way
 * enum, a boolean can only assert the positive case with confidence. Verified
 * live: every one of Kuda's on-site/hybrid-shaped roles carries
 * `telecommuting: false`, and only the two "Vice President of Engineering"
 * entries carry `telecommuting: true`. `fetchWorkableJobs`'s `mapWorkType`
 * reads `true` directly as `remote` and only falls through to
 * `inferWorkType` on `false`, where the field has nothing more to say. No
 * `hybrid`-equivalent field exists anywhere in the payload (checked: the full
 * key set on a raw job entry is title/shortcode/code/employment_type/
 * telecommuting/department/url/shortlink/application_url/published_on/
 * created_at/country/city/state/education/experience/function/industry/
 * locations — nothing else).
 *
 * ROBOTS.TXT / TERMS OF SERVICE — THE ACTUAL GO/NO-GO CHECK, RE-RUN FOR THIS
 * SPECIFIC PATH ON THIS SPECIFIC ORIGIN rather than assumed from the
 * `jobs.workable.com` vetting above (a different host). Checked 2026-09-05:
 *   - `apply.workable.com/robots.txt`: `User-agent: *` /
 *     `Content-Signal: search=yes, ai-input=yes, ai-train=no` / `Disallow: `
 *     (empty) — no path restriction at all, so `/api/v1/widget/accounts/*` is
 *     as permitted as anything else on the origin. Same Content-Signal value
 *     already vetted for `jobs.workable.com`.
 *   - `jobs.workable.com/terms` (Workable's own Job Board Terms & Conditions):
 *     read in full. No clause addressing automated access, scraping, bots,
 *     API use, or redistribution/aggregation of listings on a third-party
 *     site — the closest language is a general IP-infringement clause (data
 *     uploaded to an ACCOUNT) and a ban on injecting scripts/malware into the
 *     Workable website itself, neither of which speaks to reading public job
 *     data via a public endpoint. This is the same check that disqualified
 *     Fuzu above (explicit "no automated scraping, no redistribution without
 *     authorisation" language) — Workable's terms contain no equivalent
 *     clause anywhere found.
 *   - The endpoint itself is Workable's own documented embed feature, meant
 *     to serve exactly this data publicly for exactly this kind of external
 *     consumption (a page that is not workable.com displaying it) — not a
 *     reverse-engineered internal API.
 *   - NOT verified: sustained throttling behaviour under repeated calls, the
 *     way the rate-limit section above stress-tested `jobs.workable.com`.
 *     This fetcher makes one request per ingest run for Kuda, far lighter
 *     than a 20-link listing-plus-details crawl, and `apply.workable.com` is
 *     a different host entirely from the one that throttles — but "lighter
 *     and a different host" is reasoning, not a measurement, and is recorded
 *     as such rather than claimed as proven.
 *   Conclusion: FAIR GAME. Ships as `source: "workable"` in
 *   src/lib/jobs/types.ts, alongside greenhouse/lever, not folded into the
 *   `schema-org` variant — see that file's note on the union for why.
 *
 * SCOPE: KUDA ONLY, DELIBERATELY. Per this file's own opening convention
 * (source selection is a founder call, not an engineering one), this round
 * ships one employer to fix the specific gap reported, not a sweep of every
 * Nigerian company on Workable. Other Nigerian Workable employers worth a
 * founder decision on a future round — found only as company names inside
 * the existing `jobs.workable.com/search/*` results above, NOT independently
 * verified against their own widget-accounts endpoint the way Kuda was, so
 * treat every one of these as "worth checking," not "checked": Reliance
 * Health, FairMoney, Helium Health, Renmoney, Kora (all named explicitly
 * elsewhere in this file as Workable-hosted already surfacing through the
 * search pages) and, from the Nigeria-city sampling above, Rentokil Initial,
 * Tetra Maritime, Alaro City, Kingmakers, Human Intelligence, NALA. A future
 * round should run the same three-part verification this section did for
 * Kuda (account slug confirmed via a real link, not guessed; live job count
 * cross-checked; robots.txt/ToS re-read for the specific path) before
 * shipping any of them.
 *
 * ══ WORKABLE COMPANY BOARDS, ROUND 2: THE TEN CANDIDATES ABOVE, RESOLVED ═══
 *
 * The "worth checking" list immediately above was run through the exact
 * three-part verification Kuda's own section performed — real link/redirect
 * confirmation over guessing, robots.txt/ToS (already established as
 * permissive origin-wide, re-stated rather than re-tested per employer),
 * live job sample cross-checked against the real company's known identity —
 * plus a fourth check Kuda's round didn't need: how much of each employer's
 * board already reaches this feed via the multi-employer search pages, since
 * a board with heavy existing overlap is a smaller real gain than its raw
 * job count suggests. Founder reviewed the full write-up and ruled on both
 * borderline cases below. Evidence retained here rather than only in the
 * PR, per this file's own standing rule that research is recorded so it is
 * never silently repeated.
 *
 * ── FOUR ADDED ────────────────────────────────────────────────────────────
 *
 * Renmoney (`renmoney`) — confirmed via a real link, not a guess: a live
 * `workable-lagos` posting ("Head of Product - B2C... at Renmoney") links to
 * `apply.workable.com/j/8F7A56FE46`, which redirects to
 * `/renmoney/j/8F7A56FE46` — the same method that found Kuda's own slug.
 * Widget returns `"name": "Renmoney"`, org URL `renmoney.com`: 118 raw
 * entries / 76 distinct requisitions, 69 of them Nigeria (Lagos). Sample:
 * "Business Analyst", "Business Development Lead", "Card Product Analyst",
 * all Lagos — matches Renmoney's real identity as a Nigerian digital-
 * lending/microfinance bank. Several requisitions (e.g. the "Head of
 * Product - B2C" posting itself) also list Russia/Serbia/Belarus/Georgia/
 * Cyprus/Kazakhstan as alternate locations on the SAME shortcode — this is
 * the identical multi-location-flattening shape Kuda's "Vice President of
 * Engineering" already demonstrated, not a different company sharing the
 * token, and `fetchWorkableJobs` already dedupes it correctly by shortcode.
 * Dedup: only 6 raw slot-hits across all 8 existing search-page sources in a
 * live snapshot (all via `workable-lagos`) against 69 real distinct Nigeria
 * roles — the largest volume-cap crowd-out found in this round, bigger than
 * Kuda's original 11-of-15 Lagos gap.
 *
 * Reliance Health (`get-reliance-health`) — confirmed via a real link: the
 * `sameAs` field on a live job's JSON-LD embeds
 * `apply.workable.com/get-reliance-health`; confirmed by redirect,
 * `apply.workable.com/j/31F5F4E749` → `/get-reliance-health/j/31F5F4E749`.
 * Widget returns `"name": "Reliance Health"`, org URL `getreliancehealth.com`:
 * 57 raw / 49 distinct, 43 of them Nigeria (Lagos and Port Harcourt), plus
 * Egypt (3) and Senegal (3). Sample: "Associate Medical Laboratory
 * Scientist" and "Associate Medical Officer" (both Lagos AND Port Harcourt),
 * "Associate Data Scientist" (remote) — matches Reliance Health's real
 * identity as a Lagos-based pan-African HMO/health-insurance company that
 * runs its own clinics (the job description itself states "We operate
 * across Nigeria, Egypt, Senegal, and Côte d'Ivoire"). Dedup: 19 raw
 * slot-hits across `workable-abuja`(4) + `workable-port-harcourt`(7) +
 * `workable-nigeria`(6) + `workable-lagos`(2) against 43 distinct roles —
 * real partial coverage, but the Port Harcourt presence specifically is
 * barely visible through the existing city pages.
 *
 * Alaro City (`alaro-city`) — slug guessed, but the guess is not the
 * evidence: confirmed the same way every other entry here is, by redirect —
 * `apply.workable.com/j/ED42BCC528` → `/alaro-city/j/ED42BCC528`. Widget
 * returns `"name": "Alaro City"`: 62 raw / 61 distinct, 100% Nigeria (Epe,
 * Lagos). Sample: "Business Development Associate", "Admissions Officer —
 * Wellington College International Lagos", "China Business Associate
 * (Chinese Indigene)", all Epe — the job description self-identifies Alaro
 * City as "a joint venture between Rendeavour, the largest new city and
 * industrial park builder in Africa, and the Lagos State Government...
 * conceived on 2,000 hectares" in Epe LGA, Lagos, which also explains the
 * admissions-role titles (the development includes a school, Wellington
 * College International Lagos). Dedup: 0 raw slot-hits across all 8 existing
 * search-page sources in a live snapshot — effectively invisible today
 * despite 61 distinct open Nigeria roles, the largest single-employer gap
 * found in this round, bigger than Kuda's original discovery.
 *
 * Tetra Maritime (`tetramaritime`, no hyphen — `tetra-maritime` 404s, the
 * trap running the other direction from Kuda's own `kuda`/`kuda-technologies`
 * case) — confirmed by redirect, `apply.workable.com/j/8908235F24` →
 * `/tetramaritime/j/8908235F24`. Widget returns `"name": "Tetra Maritime"`,
 * org URL `tetramaritime.com`: 9 raw / 8 distinct, 8 of them Nigeria (Lagos),
 * 1 UK. Sample: "Analyst, Crewing Officer", "Analyst, Treasury", "Junior
 * Lecturer Navigation", all Lagos — the job description self-identifies
 * Tetra Maritime as "a leading Nigerian ship owner and operator, providing...
 * solutions across the oil and gas supply chain... with a fleet of
 * Nigerian-flagged vessels". Dedup: 3 raw slot-hits via `workable-lagos`
 * against 8 distinct roles — the most marginal of the four adds (a net gain
 * of roughly 5 roles), shipped on the founder's own call rather than being
 * deferred as borderline.
 *
 * ── FIFTH ADD, FOUNDER'S CALL ON A BORDERLINE CASE ─────────────────────────
 *
 * FairMoney (`fairmoney`) — confirmed by redirect, `apply.workable.com/j/
 * BD654BACB7` → `/fairmoney/j/BD654BACB7`. Widget returns `"name":
 * "FairMoney"`: 38 raw / 14 distinct, 13 of them Nigeria (Lagos), remainder
 * Kenya/Uganda/UK/India/South Africa. Sample: "Android Engineer", "ESG and
 * Impact Manager", "Experience Lead", all Lagos — matches FairMoney's known
 * identity as a Lagos-headquartered, CBN-licensed digital-lending bank with
 * some CIS/India engineering presence. Dedup: this file already documents
 * FairMoney surfacing across MULTIPLE existing search pages (`workable-
 * kenya`, `workable-abuja`, `workable-ibadan`, `workable-port-harcourt`,
 * `workable-nigeria`) — a live snapshot found 10 raw slot-hits against 13
 * distinct Nigeria roles, meaning a dedicated board adds roughly 3 net-new
 * roles, some of which the cross-config dedup fingerprint may already catch
 * without one. Flagged to the founder as genuinely borderline ROI rather
 * than a clean recommendation; founder's call was to bring it in anyway
 * rather than defer it, since identity and permission were both fully
 * confirmed and the marginal cost of one more HTTP request per run is low.
 *
 * ── DROPPED: HUMAN INTELLIGENCE, ADDED TO THE GRAVEYARD OF GUESSED SLUGS ───
 *
 * Neither guess resolved to a real Nigerian company, and — unlike a plain
 * 404 — both guesses returned a confident 200 for a COMPLETELY DIFFERENT
 * company, the exact false-positive shape this file's opening paragraph
 * warns about: `human-intelligence` → `"name": "HumanI"`, 6 jobs, all
 * Athens/Voiotia, Greece — a payroll/HRMS software consultancy. `human
 * intelligence` (no hyphen) → `"name": "Human Intelligence"` — an EXACT
 * display-name match that is still the wrong company — 47 jobs, all Metro
 * Manila, Philippines, a remote-work-automation BPO. The one real lead, a
 * `jobs.workable.com/search/lagos` posting for "Remote Principal UI/UX
 * Designer... at Human Intelligence", resolves to `hiringOrganization.url =
 * shaewellness.com` with no country asserted (fully remote) and no
 * `apply.workable.com/<slug>` link anywhere on its own company page or a
 * `/j/` shortlink to follow — unlike every entry above, this one may not
 * expose a legacy widget account at all. Further guesses tried and 404'd:
 * `shaewellness`, `shae-wellness`, `humanintelligencehq`, `hi-wellness`,
 * `human-intel`. No corroborating result found for a Nigerian HR/staffing
 * firm by this name. Founder's call: drop it rather than ship a guess:
 * NOT ADDED. A future pass should get a real careers-page URL from whoever
 * proposed this employer rather than re-running the same guesses.
 *
 * ── CHECKED AND SKIPPED, SAME DOCUMENTATION DISCIPLINE AS THE ADDS ─────────
 *
 * Kora (`koracareers`, found via its `sameAs` company-page link; bare `kora`
 * 200s with the right name and ZERO jobs — a decoy shape worth naming since
 * it isn't a plain 404 either) — widget confirms `"name": "Kora"`, org URL
 * `korapay.com` (the real Korapay), but only 2 entries total: one real role
 * ("Technical Support Engineer", Lagos) and a standing "Kora Talent Network"
 * pipeline listing that is not an open role. Already visible via
 * `workable-lagos`. SKIP — effectively one real job, not worth a dedicated
 * config entry.
 *
 * Helium Health (`helium-health`) — already documented above (Greenhouse
 * section) as hiring on Workable and reaching this feed via
 * `workable-nigeria`. Re-confirmed here: 6 total jobs, all Lagos, 4 of them
 * already surfacing as raw slot-hits across `workable-lagos` +
 * `workable-nigeria`. SKIP — too thin (6 roles) and already substantially
 * covered.
 *
 * NALA (`nalamoney` — bare `nala` is the trap, resolving to an unrelated
 * `"Nala Health"` with 0 jobs) — widget confirms `"name": "NALA"`, matching
 * the real `nala.money` remittance fintech via a live job's JSON-LD. 10
 * jobs total: 5 UK, 2 Belgium, 2 Kenya, and exactly 1 Nigeria ("Country
 * Manager - Nigeria", Lagos), already visible via `workable-lagos`. SKIP —
 * same reasoning already applied to Wahed Invest above: a real, verified
 * company, but not primarily African-hiring (9 of 10 roles are UK/Kenya/
 * Belgium), and its one Nigeria role adds nothing beyond what's already
 * visible.
 *
 * Kingmakers (`kingmakers`) — widget confirms `"name": "KingMakers"`, org
 * URL `kingmakers.com` (the real pan-African sports-betting group that
 * operates Betking in Nigeria — already independently noted above as
 * appearing via `workable-south-africa`). 10 jobs: 6 South Africa (Cape
 * Town), 3 Nigeria (Lagos), 1 Malta. SKIP — only 3 Nigeria roles total (net
 * gain of roughly 2), and the company already has a foothold via the
 * existing South Africa source; too thin on its own, same shape as Kora and
 * Helium Health above.
 *
 * Rentokil Initial (`rentokil-initial` — `rentokilinitial` and bare
 * `rentokil` are both decoys: a smaller unrelated "Rentokil Initial
 * Malaysia" account and an empty account respectively, neither the real
 * global company) — widget confirms `"name": "Rentokil Initial"`, org URL
 * `careers.rentokil-initial.com`, and this IS the real global Rentokil
 * Initial (already independently noted above as appearing via
 * `workable-ghana`). But the board is 799 raw entries / 750 distinct
 * requisitions across 37 countries (383 India, 90 Canada, 53 Indonesia, 46
 * Australia...), and only 6 are Nigeria (Lagos) — already 4 raw slot-hits
 * via `workable-lagos`(3) + `workable-ghana`(1). SKIP, and for a different
 * reason than the other four: `fetchWorkableJobs` has no country filter, so
 * adding this board as configured today would pull all 750 global
 * requisitions into every ingest run to surface 6 relevant ones — real,
 * verified, permitted, but an architecture cost this pipeline doesn't
 * currently absorb for any other source, not a smaller version of the same
 * judgment call as Wahed Invest/NALA above. Worth reopening only alongside a
 * country filter on the fetcher itself, which is a code change, not a
 * config entry.
 */
export const JOB_SOURCES: JobSourceConfig[] = [
  { source: "greenhouse", token: "moniepoint", companyName: "Moniepoint" },
  { source: "greenhouse", token: "wavemm1", companyName: "Wave" },
  { source: "greenhouse", token: "jumia", companyName: "Jumia" },
  // Five more Greenhouse employers, added 2026-09-04 to dilute Moniepoint's
  // per-employer share (see "THE METRIC THAT MATTERS" above) — not more of
  // the same company, five distinct ones that hire independently of it.
  { source: "greenhouse", token: "oneacrefund", companyName: "One Acre Fund" },
  { source: "greenhouse", token: "alxafrica", companyName: "ALX Africa" },
  { source: "greenhouse", token: "scangroup", companyName: "Scangroup" },
  { source: "greenhouse", token: "educate", companyName: "Educate!" },
  { source: "greenhouse", token: "oafkenya", companyName: "One Acre Fund - Kenya" },
  { source: "lever", token: "apolloagriculture", companyName: "Apollo Agriculture" },
  {
    source: "schema-org",
    url: "https://jobs.workable.com/search/nigeria",
    label: "workable-nigeria",
  },
  /*
   * Nigeria city pages sit HERE, ahead of the other country pages, and the
   * order is load-bearing twice over — see the rate-limit section above.
   * Under a partially throttled run the sources furthest down the array are
   * the ones starved, so the primary market goes first; and because
   * `ingestAllSources` walks this array in order, a posting discovered by two
   * configs in one run ends up attributed to whichever ran LAST, which is why
   * a city page follows `workable-nigeria` rather than preceding it.
   */
  {
    source: "schema-org",
    url: "https://jobs.workable.com/search/lagos",
    label: "workable-lagos",
  },
  {
    source: "schema-org",
    url: "https://jobs.workable.com/search/abuja",
    label: "workable-abuja",
  },
  /*
   * Kuda's own Workable board, not another `jobs.workable.com/search/<term>`
   * page — see the WORKABLE COMPANY BOARDS section below for the full
   * diagnosis and verification. Placed HERE, immediately after
   * `workable-abuja` and nowhere else, for the same collision rule the
   * Nigeria city pages above already document: `ingestAllSources` runs
   * `JOB_SOURCES` in array order, and when a posting's fingerprint collides
   * across two configs in one run, the row ends up attributed to whichever
   * config ran LAST. Kuda's "Direct Sales Agent" in Abuja is exactly that
   * collision — `workable-abuja` already carries it — so this entry runs
   * AFTER it on purpose: the dedicated per-company board is the more
   * complete, more authoritative source for a Kuda posting (it is the only
   * one of the two that sees all of Kuda's roles, not just whichever ones
   * happen to also show up on one city's search page), so it should be the
   * one whose `external_source`/description/URL survive the upsert.
   */
  {
    source: "workable",
    token: "kuda",
    companyName: "Kuda Technologies Ltd",
  },
  {
    source: "schema-org",
    url: "https://jobs.workable.com/search/ibadan",
    label: "workable-ibadan",
  },
  {
    source: "schema-org",
    url: "https://jobs.workable.com/search/port-harcourt",
    label: "workable-port-harcourt",
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
  /*
   * Five per-company Workable boards, added 2026-09-06 — see "WORKABLE
   * COMPANY BOARDS, ROUND 2" above for the full verification and dedup
   * evidence per employer. Placed LAST, after every `jobs.workable.com/
   * search/*` page above, not immediately after their most-overlapping city
   * the way Kuda sits after `workable-abuja` — Kuda had no measured overlap
   * beyond Abuja, but this round's own dedup pass found Reliance Health
   * overlapping `workable-port-harcourt` and FairMoney overlapping
   * `workable-kenya`, both of which run AFTER Kuda's position. Running array
   * order decides which config wins a fingerprint collision in one ingest
   * run (see the Nigeria-city-pages and Kuda comments above), so the only
   * placement that guarantees every one of these five dedicated, more
   * complete boards wins against every search page it might overlap is last.
   */
  {
    source: "workable",
    token: "renmoney",
    companyName: "Renmoney",
  },
  {
    source: "workable",
    token: "get-reliance-health",
    companyName: "Reliance Health",
  },
  {
    source: "workable",
    token: "alaro-city",
    companyName: "Alaro City",
  },
  {
    source: "workable",
    token: "tetramaritime",
    companyName: "Tetra Maritime",
  },
  {
    source: "workable",
    token: "fairmoney",
    companyName: "FairMoney",
  },
];
