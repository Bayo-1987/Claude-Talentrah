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
