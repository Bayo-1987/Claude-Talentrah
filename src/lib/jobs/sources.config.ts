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
];
