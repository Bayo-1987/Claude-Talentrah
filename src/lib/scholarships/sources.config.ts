import type { NormalizedScholarship } from "./types";

/**
 * Hand-curated seed set for M10, deliberately NOT a scraper.
 *
 * Why hand-curated: build-prompt §6.15 and §10 item 19 both require legal
 * review of any scraped scholarship source's reuse terms *before* relying
 * on it commercially, and they explicitly call for more caution here than
 * for jobs — a stale job listing looks untidy, a wrong scholarship deadline
 * costs someone a once-a-year opportunity. That review is a founder/legal
 * decision, so this milestone ships a real-but-narrow curated path and
 * leaves the general scraper out of scope. `ingest.ts` is written against
 * the NormalizedScholarship interface rather than this array, so an actual
 * fetch-based source can be added later without touching the pipeline.
 *
 * Provider names, program names and officialUrl values below are real, and
 * every URL was checked to resolve (HTTP 200) at build time.
 *
 * DEADLINES — field-verified 2026-08-24, replacing the earlier illustrative
 * placeholders. Each officialUrl was revisited and read for the current
 * cycle's date. The result is worth stating plainly because it shapes the
 * catalog: only ONE of the eight (Commonwealth) publishes a single
 * programme-wide deadline. The rest either delegate dates to partner
 * institutions, embassies or per-course calls (Mastercard, MEXT, Erasmus,
 * DAAD) or simply publish none (Rhodes, PTDF, Aga Khan).
 *
 * So applicationDeadline is null wherever a date could not be confirmed,
 * rather than carrying forward a plausible guess — a wrong deadline is the
 * one error this feature can make that costs a user a once-a-year
 * opportunity (§6.15). deadlineVerifiedAt records when the date was
 * actually confirmed; deadlineNote records what was found when it wasn't.
 * A listing with no verified deadline is not publishable — see ingest.ts
 * and the seed's moderation step, which key off deadlineVerifiedAt rather
 * than a hand-maintained list.
 *
 * Geographic scope (§10 item 20 — RESOLVED): listing scope is
 * eligibility-relevant, not geography-restricted. A programme belongs in
 * this catalog if it is realistically open to and relevant for
 * Nigerian/African applicants, regardless of where it is hosted or
 * administered — Germany, Japan, the UK and the pan-EU programmes below all
 * qualify on exactly that basis. Being headquartered or delivered in Africa
 * is not a requirement and never was; this rule just makes explicit what
 * the seed set already reflected.
 *
 * Fine-grained "is this actually right for *this* applicant" filtering
 * stays where it already lives: the eligibility-check Farah action, run
 * per-user against the listing's stated criteria. The catalog is not the
 * enforcement layer, and no geographic filter exists in the ingestion or
 * browse query — deliberately, not by omission.
 */
export const SEED_SCHOLARSHIPS: NormalizedScholarship[] = [
  {
    provider: "DAAD (German Academic Exchange Service)",
    programName: "DAAD Development-Related Postgraduate Courses (EPOS)",
    hostInstitution: "Participating German universities",
    degreeLevels: ["msc", "postgraduate_diploma"],
    fieldTags: ["Development Studies", "Engineering", "Public Health", "Economics"],
    fundingType: "full",
    fundingCovers: ["tuition", "stipend", "travel"],
    eligibilityNationalities: ["Nigeria", "Ghana", "Kenya", "Developing countries"],
    eligibilityPriorDegree: "Bachelor's degree (min. 4 years) plus at least 2 years' professional experience",
    eligibilityAge: null,
    eligibilityOther: "Degree completed no more than 6 years before application.",
    applicationDeadline: null,
    cycleYear: 2027,
    officialUrl: "https://www.daad.de/en/studying-in-germany/scholarships/daad-scholarships/",
    sourceName: "DAAD official site",
    deadlineVerifiedAt: "2026-08-24T15:30:00.000Z",
    deadlineNote: "Varies by course — each EPOS programme publishes its own deadline in its call for applications. See the official source for your course.",
    reviewNote: "Checked 2026-08-24: DAAD delegates deadlines to each course call; confirmed variable, not unannounced.",
  },
  {
    provider: "Mastercard Foundation",
    programName: "Mastercard Foundation Scholars Program",
    hostInstitution: "Partner universities across Africa and abroad",
    degreeLevels: ["bsc", "msc"],
    fieldTags: ["Any field", "Agriculture", "Technology", "Health"],
    fundingType: "full",
    fundingCovers: ["tuition", "stipend", "travel"],
    eligibilityNationalities: ["Nigeria", "Africa"],
    eligibilityPriorDegree: "Secondary school completion (BSc) or a Bachelor's degree (MSc)",
    eligibilityAge: "Typically under 29 at entry",
    eligibilityOther:
      "Demonstrated academic talent and financial need; commitment to giving back to the community.",
    applicationDeadline: null,
    cycleYear: 2027,
    officialUrl:
      "https://mastercardfdn.org/en/what-we-do/our-programs/mastercard-foundation-scholars-program/",
    sourceName: "Mastercard Foundation official site",
    deadlineVerifiedAt: "2026-08-24T15:30:00.000Z",
    deadlineNote: "Varies by partner institution — each partner sets its own deadline. See the official source for your chosen university.",
    reviewNote: "Checked 2026-08-24: the Foundation states each partner sets their own deadline; confirmed variable, not unannounced.",
  },
  {
    provider: "Commonwealth Scholarship Commission (UK)",
    programName: "Commonwealth Master's Scholarships",
    hostInstitution: "UK universities",
    degreeLevels: ["msc"],
    fieldTags: ["Science and Technology", "Health", "Governance", "Economic Development"],
    fundingType: "full",
    fundingCovers: ["tuition", "stipend", "travel"],
    eligibilityNationalities: ["Nigeria", "Commonwealth countries"],
    eligibilityPriorDegree: "At least an upper second class (2:1) honours bachelor's degree",
    eligibilityAge: null,
    eligibilityOther:
      "Must be unable to afford study in the UK without this scholarship; nominated via a recognised nominating body.",
    applicationDeadline: "2026-10-20",
    cycleYear: 2027,
    officialUrl: "https://cscuk.fcdo.gov.uk/scholarships/commonwealth-masters-scholarships/",
    sourceName: "Commonwealth Scholarship Commission official site",
    deadlineVerifiedAt: "2026-08-24T15:30:00.000Z",
    deadlineNote: null,
    reviewNote: null,
  },
  {
    provider: "Government of Japan (MEXT)",
    programName: "MEXT Japanese Government Scholarship",
    hostInstitution: "Japanese national and private universities",
    degreeLevels: ["bsc", "msc", "phd"],
    fieldTags: ["Engineering", "Social Sciences", "Natural Sciences", "Humanities"],
    fundingType: "full",
    fundingCovers: ["tuition", "stipend", "travel"],
    eligibilityNationalities: ["Nigeria", "Countries with Japanese diplomatic relations"],
    eligibilityPriorDegree: "Varies by track — secondary completion (undergraduate) or a Bachelor's degree (research)",
    eligibilityAge: "Under 35 for the research track",
    eligibilityOther: "Applications are made through the Japanese Embassy or a nominating university.",
    applicationDeadline: null,
    cycleYear: 2027,
    officialUrl: "https://www.studyinjapan.go.jp/en/planning/scholarship/",
    sourceName: "Study in Japan (MEXT) official site",
    deadlineVerifiedAt: "2026-08-24T15:30:00.000Z",
    deadlineNote: "Varies by country — applications run through your local Japanese embassy, which sets the deadline. See the official source.",
    reviewNote: "Checked 2026-08-24: Study in Japan defers to the local embassy and notes requirements vary by country; confirmed variable.",
  },
  {
    provider: "Rhodes Trust",
    programName: "Rhodes Scholarship (West Africa)",
    hostInstitution: "University of Oxford",
    degreeLevels: ["msc", "phd"],
    fieldTags: ["Any field", "Public Policy", "Sciences", "Humanities"],
    fundingType: "full",
    fundingCovers: ["tuition", "stipend", "travel"],
    eligibilityNationalities: ["Nigeria", "West Africa"],
    eligibilityPriorDegree: "Completed undergraduate degree with strong academic standing",
    eligibilityAge: "Typically 18–23 at application (extended for some routes)",
    eligibilityOther: "Evidence of leadership, service, and commitment to the common good.",
    applicationDeadline: null,
    cycleYear: 2027,
    officialUrl: "https://www.rhodeshouse.ox.ac.uk/scholarships/the-rhodes-scholarship/",
    sourceName: "Rhodes House official site",
    deadlineVerifiedAt: null,
    deadlineNote: null,
    reviewNote: "Checked 2026-08-24: the 2027 cycle is confirmed open but no deadline is published, and the West Africa and apply pages both 404. Genuinely unresolved — not a variable-by-design date.",
  },
  {
    provider: "Petroleum Technology Development Fund (PTDF)",
    programName: "PTDF Overseas Postgraduate Scholarship Scheme",
    hostInstitution: "Partner universities in the UK, Germany, France and Malaysia",
    degreeLevels: ["msc", "phd"],
    fieldTags: ["Petroleum Engineering", "Geosciences", "Chemical Engineering", "Environmental Science"],
    fundingType: "full",
    fundingCovers: ["tuition", "stipend", "travel"],
    eligibilityNationalities: ["Nigeria"],
    eligibilityPriorDegree: "Minimum of Second Class Upper for MSc; Master's degree for PhD",
    eligibilityAge: null,
    eligibilityOther: "Open to Nigerian citizens; oil-and-gas-relevant disciplines prioritised.",
    applicationDeadline: null,
    cycleYear: 2027,
    officialUrl: "https://scholarship.ptdf.gov.ng/",
    sourceName: "PTDF scholarship portal",
    deadlineVerifiedAt: null,
    deadlineNote: null,
    reviewNote: "Checked 2026-08-24: the portal shows account/login only, with no stated open or close date. Genuinely unresolved.",
  },
  {
    provider: "European Commission",
    programName: "Erasmus Mundus Joint Masters Scholarships",
    hostInstitution: "Consortia of European universities",
    degreeLevels: ["msc"],
    fieldTags: ["Any field", "Data Science", "Environmental Science", "Public Health"],
    fundingType: "full",
    fundingCovers: ["tuition", "stipend", "travel"],
    eligibilityNationalities: ["Nigeria", "Any country"],
    eligibilityPriorDegree: "A completed first higher education degree",
    eligibilityAge: null,
    eligibilityOther:
      "Applications are made directly to each joint master's consortium; deadlines vary by programme.",
    applicationDeadline: null,
    cycleYear: 2027,
    officialUrl:
      "https://erasmus-plus.ec.europa.eu/opportunities/opportunities-for-individuals/students/erasmus-mundus-joint-masters-scholarships",
    sourceName: "Erasmus+ official site",
    deadlineVerifiedAt: "2026-08-24T15:30:00.000Z",
    deadlineNote: "Varies by programme — each joint master's consortium sets its own deadline, generally between October and January. See the official source.",
    reviewNote: "Checked 2026-08-24: Erasmus+ gives only a general October-January window and defers exact dates to each consortium; confirmed variable.",
  },
  /*
   * ── 2026-09-01 expansion ──────────────────────────────────────────────────
   *
   * Added under the founder's 2026-09-01 direction to grow the catalog from
   * public sources (see docs/scholarship-sources.md for the per-source
   * permissibility evidence and the programs checked but NOT added). Every
   * entry below was verified against its officialUrl on 2026-09-01; the same
   * date discipline as the original eight applies — a deadline is either
   * confirmed on the official page or null with a note, never a plausible
   * guess. Two programs were caught by live checks that a list-copy would have
   * shipped: Vanier (discontinued — "no longer accepting applications") and
   * ADB-JSP (Asia-Pacific citizens only, fails the eligibility-relevant scope
   * rule). Neither is below, and that is the point of checking.
   */
  {
    provider: "UK Foreign, Commonwealth & Development Office",
    programName: "Chevening Scholarships",
    hostInstitution: "UK universities",
    degreeLevels: ["msc"],
    fieldTags: ["Any field", "Public Policy", "Leadership"],
    fundingType: "full",
    fundingCovers: ["tuition", "stipend", "travel"],
    eligibilityNationalities: ["Nigeria", "Chevening-eligible countries"],
    eligibilityPriorDegree: "An undergraduate degree, plus at least two years' work experience",
    eligibilityAge: null,
    eligibilityOther:
      "Must return to your home country for at least two years after the award ends.",
    applicationDeadline: "2026-10-06",
    cycleYear: 2027,
    officialUrl: "https://www.chevening.org/apply/",
    sourceName: "Chevening official site",
    deadlineVerifiedAt: "2026-09-01T06:30:00.000Z",
    deadlineNote: null,
    reviewNote:
      "Checked 2026-09-01: apply page states applications open until 6 October 2026, 11:00 UTC, for 2027/28 study.",
  },
  {
    provider: "Gates Cambridge Trust",
    programName: "Gates Cambridge Scholarship",
    hostInstitution: "University of Cambridge",
    degreeLevels: ["msc", "phd"],
    fieldTags: ["Any field", "Sciences", "Humanities", "Technology"],
    fundingType: "full",
    fundingCovers: ["tuition", "stipend", "travel"],
    eligibilityNationalities: ["Nigeria", "Any country except the UK"],
    eligibilityPriorDegree: "A bachelor's degree; apply alongside admission to a Cambridge postgraduate course",
    eligibilityAge: null,
    eligibilityOther:
      "Selection weighs academic excellence, leadership and commitment to improving the lives of others.",
    applicationDeadline: "2026-12-08",
    cycleYear: 2027,
    officialUrl: "https://www.gatescambridge.org/apply/timeline/",
    sourceName: "Gates Cambridge official site",
    deadlineVerifiedAt: "2026-09-01T06:30:00.000Z",
    deadlineNote:
      "8 December 2026 or 6 January 2027 depending on your course — the earlier date is shown; check which applies to your programme on the official timeline.",
    reviewNote:
      "Checked 2026-09-01: timeline page gives two international-round deadlines by course (8 Dec 2026 / 6 Jan 2027); earliest recorded as the deadline so nobody is late by our copy.",
  },
  {
    provider: "Stanford University",
    programName: "Knight-Hennessy Scholars",
    hostInstitution: "Stanford University",
    degreeLevels: ["msc", "phd"],
    fieldTags: ["Any field", "Engineering", "Business", "Medicine", "Law"],
    fundingType: "full",
    fundingCovers: ["tuition", "stipend", "travel"],
    eligibilityNationalities: ["Nigeria", "Any country"],
    eligibilityPriorDegree:
      "A bachelor's degree earned in 2020 or later; apply alongside admission to any Stanford graduate program",
    eligibilityAge: null,
    eligibilityOther: "Funds any full-time Stanford graduate degree, up to three years.",
    applicationDeadline: "2026-10-06",
    cycleYear: 2027,
    officialUrl: "https://knight-hennessy.stanford.edu/admission",
    sourceName: "Knight-Hennessy Scholars official site",
    deadlineVerifiedAt: "2026-09-01T06:30:00.000Z",
    deadlineNote: "Closes at 1pm Pacific Time on the deadline day.",
    reviewNote:
      "Checked 2026-09-01: admission page states the application closes 6 October 2026 at 1pm Pacific for 2027 entry.",
  },
  {
    provider: "Swiss Confederation (SERI)",
    programName: "Swiss Government Excellence Scholarships",
    hostInstitution: "Swiss universities and federal institutes of technology",
    degreeLevels: ["msc", "phd"],
    fieldTags: ["Research", "Sciences", "Any field"],
    fundingType: "full",
    fundingCovers: ["tuition", "stipend"],
    eligibilityNationalities: ["Nigeria", "183 eligible countries"],
    eligibilityPriorDegree: "A master's degree or equivalent for research/PhD tracks",
    eligibilityAge: null,
    eligibilityOther: "Research, PhD and postdoctoral tracks; a Swiss host professor is required.",
    applicationDeadline: null,
    cycleYear: 2027,
    officialUrl:
      "https://www.sbfi.admin.ch/sbfi/en/home/education/scholarships-and-grants/swiss-government-excellence-scholarships.html",
    sourceName: "Swiss State Secretariat for Education, Research and Innovation",
    deadlineVerifiedAt: "2026-09-01T06:30:00.000Z",
    deadlineNote:
      "Varies by country — applications opened 20 August 2026 and each country's deadline is set by the local Swiss embassy. See the official source for Nigeria's date.",
    reviewNote:
      "Checked 2026-09-01: SERI page confirms the 2027/28 round opened 20 Aug 2026 with per-country deadlines published on that page; confirmed variable, not unannounced.",
  },
  {
    provider: "World Bank",
    programName: "Joint Japan/World Bank Graduate Scholarship Program (JJ/WBGSP)",
    hostInstitution: "Partner universities worldwide",
    degreeLevels: ["msc"],
    fieldTags: ["Development", "Economics", "Public Health", "Policy"],
    fundingType: "full",
    fundingCovers: ["tuition", "stipend", "travel"],
    eligibilityNationalities: ["Nigeria", "World Bank member developing countries"],
    eligibilityPriorDegree:
      "A bachelor's degree earned at least three years before application, plus three years' development-related work experience",
    eligibilityAge: null,
    eligibilityOther: "Must apply to a participating master's program; returns-home commitment applies.",
    applicationDeadline: null,
    cycleYear: 2027,
    officialUrl: "https://www.worldbank.org/en/programs/scholarships",
    sourceName: "World Bank official site",
    deadlineVerifiedAt: "2026-09-01T06:30:00.000Z",
    deadlineNote:
      "Two application windows for the 2027 cycle — the exact dates are published in the application guidelines on the official page.",
    reviewNote:
      "Checked 2026-09-01: the 2027 windows are announced but the page defers exact dates to the per-window guidelines PDFs; confirmed variable-by-window, not unannounced.",
  },
  /*
   * ── 2026-09-01 tranche 2 ─────────────────────────────────────────────────
   *
   * Second pass through docs/scholarship-sources.md's backlog. Every entry
   * below was verified against its officialUrl on 2026-09-01 by quoting the
   * page's own wording, never a search summary — a search result for one of
   * these returned an internally impossible pair of dates (a 2028 deadline
   * BEFORE its own opening date), which is the case for the rule.
   *
   * WHAT THE PASS ALSO PRODUCED, recorded in the doc rather than here: one
   * verified EXCLUSION (Manaaki NZ — Pacific and Asian countries only, Nigeria
   * absent from the eligible list, same rule that removed ADB-JSP), four
   * programs whose cycle has closed with no next date published, and three
   * official sites that return 403 to automated access and therefore cannot be
   * machine-verified at all.
   *
   * A note on dates that look "closed" and are not: several pages carry both
   * the live cycle and stale copy from the previous one. Where that happened
   * the live student-facing deadline is recorded and the ambiguity is the
   * reason no recheck target was added — see the doc.
   */
  {
    provider: "University of Toronto",
    programName: "Lester B. Pearson International Scholarship",
    hostInstitution: "University of Toronto",
    degreeLevels: ["bsc"],
    fieldTags: ["Any field"],
    fundingType: "full",
    fundingCovers: ["tuition", "stipend"],
    eligibilityNationalities: ["Nigeria", "Any country"],
    eligibilityPriorDegree: "In your final year of secondary school, or graduated no earlier than the preceding year",
    eligibilityAge: null,
    eligibilityOther:
      "You must be nominated by your school before you apply — the nomination deadline falls before the scholarship one.",
    applicationDeadline: "2026-11-06",
    cycleYear: 2027,
    officialUrl: "https://future.utoronto.ca/pearson/",
    sourceName: "University of Toronto official site",
    deadlineVerifiedAt: "2026-09-01T12:00:00.000Z",
    deadlineNote:
      "Your school must nominate you by 9 October 2026 and your U of T admission application is due 16 October 2026 — both before this date. Studies begin September 2027.",
    reviewNote:
      "Checked 2026-09-01, quoted verbatim: 'The deadline to complete the Pearson International Scholarship application and submit all required documentation is November 6, 2026.' The same page still carries stale 2025-cycle copy, so no recheck target — an extractor would see several dates and defer.",
  },
  {
    provider: "ETH Zurich",
    programName: "ETH Excellence Scholarship & Opportunity Programme (ESOP)",
    hostInstitution: "ETH Zurich",
    degreeLevels: ["msc"],
    fieldTags: ["Engineering", "Sciences", "Any field"],
    fundingType: "full",
    fundingCovers: ["tuition", "stipend"],
    eligibilityNationalities: ["Nigeria", "Any country"],
    eligibilityPriorDegree: "A bachelor's degree, applying for an ETH Zurich master's programme",
    eligibilityAge: null,
    eligibilityOther:
      "Awarded on academic excellence; you apply for the scholarship alongside your master's admission.",
    applicationDeadline: "2026-11-30",
    cycleYear: 2027,
    officialUrl: "https://ethz.ch/en/studies/financial/scholarships/excellencescholarship.html",
    sourceName: "ETH Zurich official site",
    deadlineVerifiedAt: "2026-09-01T12:00:00.000Z",
    deadlineNote:
      "The application window opens 1 November 2026 and closes 30 November 2026 at 12:59 CET, for autumn semester 2027 entry.",
    reviewNote:
      "Checked 2026-09-01: the page states the window as 'November 1 - 30 (12.59 MEZ)' for HS27. Recorded the closing date. No recheck target: the page expresses the window as a range with an abbreviated month, which the extractor is not built to read, so it would find nothing and defer.",
  },
  {
    provider: "Schwarzman Scholars",
    programName: "Schwarzman Scholars",
    hostInstitution: "Tsinghua University",
    degreeLevels: ["msc"],
    fieldTags: ["Public Policy", "Leadership", "Economics", "International Studies"],
    fundingType: "full",
    fundingCovers: ["tuition", "stipend", "travel"],
    eligibilityNationalities: ["Nigeria", "Any country"],
    eligibilityPriorDegree: "A completed undergraduate degree by the time the programme begins",
    eligibilityAge: "18–28 at the application deadline",
    eligibilityOther:
      "One-year master's in Global Affairs in Beijing. A separate, earlier window applies to applicants with Chinese citizenship.",
    applicationDeadline: "2026-09-09",
    cycleYear: 2027,
    officialUrl: "https://www.schwarzmanscholars.org/admissions/",
    sourceName: "Schwarzman Scholars official site",
    deadlineVerifiedAt: "2026-09-01T12:00:00.000Z",
    deadlineNote:
      "Closes 3pm EDT. This is the global and US round for the class of 2027–2028; the programme begins August 2027.",
    reviewNote:
      "Checked 2026-09-01, quoted verbatim: 'The U.S. and Global application for the class of 2027-2028 is now open from April 8, 2026 to September 9, 2026 at 3 p.m. EDT.' Closing in eight days at time of verification — the shortest runway in the catalog, which is the argument for the daily recheck picking up the next cycle.",
  },
  {
    provider: "New York University Abu Dhabi",
    programName: "NYU Abu Dhabi Undergraduate Scholarships",
    hostInstitution: "New York University Abu Dhabi",
    degreeLevels: ["bsc"],
    fieldTags: ["Any field"],
    fundingType: "full",
    fundingCovers: ["tuition", "stipend", "travel"],
    eligibilityNationalities: ["Nigeria", "Any country"],
    eligibilityPriorDegree: "Applying for undergraduate admission from secondary school",
    eligibilityAge: null,
    eligibilityOther:
      "Aid is need-based and awarded with admission; the university states it accepts aid applications from all students regardless of citizenship.",
    applicationDeadline: null,
    cycleYear: 2027,
    officialUrl: "https://nyuad.nyu.edu/en/apply/undergraduate/apply/key-dates-and-deadlines.html",
    sourceName: "NYU Abu Dhabi official site",
    deadlineVerifiedAt: "2026-09-01T12:00:00.000Z",
    deadlineNote:
      "Deadlines depend on the plan you choose: Early Decision I on 1 November, Early Decision II on 1 January, Regular Decision on 5 January, each at 11:59pm EST, with the financial-aid CSS Profile due shortly after. Check the official page for the year that applies to your intake.",
    reviewNote:
      "Checked 2026-09-01: the key-dates page lists the three plan deadlines but states NO YEAR against them, so no dated deadline is recorded — inferring the cycle year would be exactly the guess this catalog refuses. Confirmed variable-by-plan, not unannounced.",
  },
  {
    provider: "Nuffic (Dutch Ministry of Education)",
    programName: "NL Scholarship (Holland Scholarship)",
    hostInstitution: "Participating Dutch universities",
    degreeLevels: ["bsc", "msc"],
    fieldTags: ["Any field"],
    fundingType: "partial",
    fundingCovers: ["tuition"],
    eligibilityNationalities: ["Nigeria", "Non-EEA countries"],
    eligibilityPriorDegree:
      "No prior degree from a Dutch institution; applying for a full-time bachelor's or master's in the Netherlands",
    eligibilityAge: null,
    eligibilityOther:
      "A first-year contribution towards tuition and living costs, not a full ride. Awarded by the Dutch institution you apply to.",
    applicationDeadline: null,
    cycleYear: 2027,
    officialUrl: "https://www.studyinnl.org/finances/holland-scholarship",
    sourceName: "Study in NL (Nuffic) official site",
    deadlineVerifiedAt: "2026-09-01T12:00:00.000Z",
    deadlineNote:
      "Each participating Dutch institution sets and publishes its own deadline — commonly 1 February or 1 May. Check the page of the university you are applying to.",
    reviewNote:
      "Checked 2026-09-01: eligibility confirmed as 'Your nationality is non-EEA', which includes Nigeria. The page states the 2026-2027 application opened 1 November 2025 and delegates specific deadlines to individual institutions; confirmed variable-by-institution, not unannounced.",
  },
  {
    provider: "Aga Khan Foundation",
    programName: "Aga Khan Foundation International Scholarship Programme",
    hostInstitution: "Universities worldwide",
    degreeLevels: ["msc", "phd"],
    fieldTags: ["Any field", "Development", "Architecture", "Health"],
    fundingType: "partial",
    fundingCovers: ["tuition", "stipend"],
    eligibilityNationalities: ["Nigeria", "Selected developing countries"],
    eligibilityPriorDegree: "A completed undergraduate degree; PhD applicants need a Master's",
    eligibilityAge: "Preference for candidates under 30",
    eligibilityOther:
      "Awarded on a 50% grant / 50% loan basis — this is deliberately a partial award, not a full ride.",
    applicationDeadline: null,
    cycleYear: 2027,
    officialUrl:
      "https://the.akdn/en/what-we-do/developing-human-capacity/education/international-scholarship-programme",
    sourceName: "Aga Khan Development Network official site",
    deadlineVerifiedAt: null,
    deadlineNote: null,
    reviewNote: "Checked 2026-08-24: the AKDN programme page publishes no deadline or cycle dates. Genuinely unresolved.",
  },
];
