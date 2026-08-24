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
 * IMPORTANT: the `applicationDeadline` values are ILLUSTRATIVE DEMO DATA. They have
 * not been field-verified against each provider's current published cycle,
 * and they must not be treated as authoritative — which is exactly the
 * failure mode §6.15's moderation gate exists to catch. Before any of this
 * goes in front of real users, a reviewer has to confirm provider, deadline
 * and eligibility against the official page and only then flip the row to
 * `verified`. Every listing links out to its official source precisely so
 * Talentrah never has to be the authority on a date it hasn't checked.
 *
 * Geographic scope (§10 item 20, UNRESOLVED — assumption only): seeded
 * toward programs open to Nigerian/African applicants, consistent with the
 * product's market thesis. This stands in for a founder decision that has
 * not been made. Note the listing scope is deliberately NOT used to exclude
 * anyone: per §6.15's own suggested resolution, fine-grained eligibility is
 * the eligibility-check action's job, not the catalog's.
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
    applicationDeadline: "2026-10-15",
    cycleYear: 2027,
    officialUrl: "https://www.daad.de/en/studying-in-germany/scholarships/daad-scholarships/",
    sourceName: "DAAD official site",
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
    applicationDeadline: "2026-09-05",
    cycleYear: 2027,
    officialUrl:
      "https://mastercardfdn.org/en/what-we-do/our-programs/mastercard-foundation-scholars-program/",
    sourceName: "Mastercard Foundation official site",
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
    applicationDeadline: "2026-12-18",
    cycleYear: 2027,
    officialUrl: "https://cscuk.fcdo.gov.uk/scholarships/commonwealth-masters-scholarships/",
    sourceName: "Commonwealth Scholarship Commission official site",
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
    applicationDeadline: "2026-09-01",
    cycleYear: 2027,
    officialUrl: "https://www.studyinjapan.go.jp/en/planning/scholarship/",
    sourceName: "Study in Japan (MEXT) official site",
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
    applicationDeadline: "2026-08-31",
    cycleYear: 2027,
    officialUrl: "https://www.rhodeshouse.ox.ac.uk/scholarships/the-rhodes-scholarship/",
    sourceName: "Rhodes House official site",
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
    applicationDeadline: "2026-11-30",
    cycleYear: 2027,
    officialUrl: "https://scholarship.ptdf.gov.ng/",
    sourceName: "PTDF scholarship portal",
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
    applicationDeadline: "2027-03-31",
    cycleYear: 2027,
    officialUrl:
      "https://the.akdn/en/what-we-do/developing-human-capacity/education/international-scholarship-programme",
    sourceName: "Aga Khan Development Network official site",
  },
];
