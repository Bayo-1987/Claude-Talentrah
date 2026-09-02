import type { Tables } from "@/lib/supabase/types";
import { absoluteUrl } from "./site";

/**
 * schema.org JobPosting markup, built to Google's own required/recommended
 * split rather than to a guess at it.
 *
 * Checked against developers.google.com/search/docs/appearance/structured-data
 * /job-posting rather than from memory, because the required set is smaller
 * and stricter than it looks:
 *
 *   REQUIRED     title, description, datePosted, hiringOrganization,
 *                jobLocation (unless the role is TELECOMMUTE)
 *   RECOMMENDED  employmentType, validThrough, jobLocationType,
 *                applicantLocationRequirements, baseSalary, identifier,
 *                directApply
 *
 * ── THE RULE THIS FILE IS BUILT AROUND ────────────────────────────────────
 *
 * Emit nothing rather than emit something invalid. A posting whose location
 * cannot be resolved to a country, and which is not remote, cannot satisfy
 * `jobLocation`, so it gets NO markup at all. Invalid structured data is worse
 * than absent structured data: absent means "not eligible for Google for
 * Jobs", invalid means an error in Search Console against a page that looks
 * fine to a human.
 *
 * ── WHY `validThrough` AND `baseSalary` ARE OFTEN ABSENT, AND WHY THAT IS
 *    CORRECT ─────────────────────────────────────────────────────────────
 *
 * `job_postings.expires_at` had no writer at all until schema.org sources
 * started reading `validThrough` off their own markup (src/lib/jobs/sources
 * /schema-org.ts) and employers started choosing one on the job form — 0053
 * added the column ahead of either, deliberately with no default (a default
 * would be a guess recorded as if a source had stated it). Google's guidance
 * is to OMIT validThrough when a job has no expiry, not to invent one, so
 * this emits it only when the column is set.
 *
 * `baseSalary` follows the identical rule, one level deeper: it is emitted
 * only when the row has BOTH a currency and at least one bound (min or max).
 * A bound with no currency is not a fact — "50000" means nothing without
 * knowing NGN from USD — so migration 0085's parser never stores one without
 * the other, and this function checks both again rather than trusting that
 * invariant blindly, consistent with "emit nothing rather than emit
 * something invalid" holding at every layer, not just the one that wrote it.
 */

type JobPosting = Tables<"job_postings">;

/**
 * Google's employmentType values are CASE-SENSITIVE and are not our enum's
 * spelling. Anything unmapped is omitted rather than guessed — `employmentType`
 * is recommended, not required, so leaving it out costs nothing while a wrong
 * value is a validation error.
 */
const EMPLOYMENT_TYPE: Record<string, string> = {
  full_time: "FULL_TIME",
  part_time: "PART_TIME",
  contract: "CONTRACTOR",
  internship: "INTERN",
  temporary: "TEMPORARY",
};

/** The inverse of sources/schema-org.ts's mapSalaryUnit — this app's enum
 * value back to the schema.org unitText Google expects. */
const SALARY_UNIT_TEXT: Record<string, string> = {
  hour: "HOUR",
  day: "DAY",
  week: "WEEK",
  month: "MONTH",
  year: "YEAR",
};

/** `numeric` columns can arrive as a string over PostgREST — never emit an
 * unparsable value rather than trust the column's declared type. */
function toFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export interface ParsedLocation {
  /** ISO-ish country name as written in the source, e.g. "Nigeria". */
  country: string;
  /** City or region, when the entry carried one beyond the country. */
  locality?: string;
}

export interface LocationParse {
  /** Physical places, for `jobLocation` — each carries a country. */
  places: ParsedLocation[];
  /** Countries a remote role may be worked from, for applicantLocationRequirements. */
  remoteCountries: string[];
  /** The source text marked at least one entry as remote. */
  remote: boolean;
  /** An entry named a place but no country — cannot fill addressCountry. */
  unresolved: boolean;
}

/**
 * Splits the free-text `location` column into places.
 *
 * MEASURED AGAINST THE REAL COLUMN, which is not a single place: it is a
 * semicolon-separated list, each entry `Place, Country`, with an optional
 * leading `Remote` acting as a modifier rather than a place. Real values
 * include "Lagos, Nigeria", "Remote, Nigeria", "Remote, Lagos, Nigeria",
 * "London, United Kingdom; Remote, Nigeria", and the bare "Lagos" and "Remote".
 *
 * The last comma-separated token is treated as the country. That is a
 * positional rule, not a country list — deliberately, because a curated
 * gazetteer is the kind of taxonomy that goes stale silently (the same
 * argument skill-facet.ts makes about technology allowlists). A bare "Lagos"
 * therefore resolves to no country and is reported as `unresolved` rather than
 * being quietly assumed to be Nigeria, which would be a guess about someone
 * else's job ad.
 */
export function parseJobLocation(raw: string | null): LocationParse {
  const out: LocationParse = { places: [], remoteCountries: [], remote: false, unresolved: false };
  if (!raw?.trim()) return out;

  for (const entry of raw.split(";")) {
    const parts = entry
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) continue;

    // "Remote" is a modifier on the entry, not one of its places.
    const isRemoteEntry = parts[0]!.toLowerCase() === "remote";
    if (isRemoteEntry) parts.shift();

    if (parts.length === 0) {
      // A bare "Remote" — remote, but it does not say from where.
      if (isRemoteEntry) out.remote = true;
      continue;
    }

    if (isRemoteEntry) {
      /*
       * The remaining tokens describe where the work may be done FROM, which
       * Google models as applicantLocationRequirements rather than as a postal
       * address. So the last token is a country here even when it is the only
       * one: "Remote, Nigeria" means Nigeria, not an unresolvable city.
       *
       * Getting this wrong is not academic — treating that single token as a
       * locality dropped 58 of the 155 live postings, a third of the board,
       * because it is the single most common shape in the column.
       */
      out.remote = true;
      const country = parts[parts.length - 1]!;
      if (!out.remoteCountries.includes(country)) out.remoteCountries.push(country);
      // "Remote, Lagos, Nigeria" also pins a physical place.
      if (parts.length >= 2) {
        const locality = parts[parts.length - 2]!;
        if (!out.places.some((p) => p.country === country && p.locality === locality)) {
          out.places.push({ country, locality });
        }
      }
      continue;
    }

    if (parts.length === 1) {
      // A place with no country, e.g. a bare "Lagos". Cannot fill Google's
      // mandatory addressCountry, and this entry gives no remote fallback, so
      // it is recorded as unresolved rather than guessed at.
      out.unresolved = true;
      continue;
    }

    const country = parts[parts.length - 1]!;
    const locality = parts[parts.length - 2];
    if (!out.places.some((p) => p.country === country && p.locality === locality)) {
      out.places.push(locality ? { country, locality } : { country });
    }
  }
  return out;
}

/** Collapses whitespace and trims — descriptions arrive with ragged spacing. */
function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The JSON-LD object, or null when Google's required set cannot be satisfied.
 *
 * Returning null is a real outcome, not an error path — see the header.
 */
export function buildJobPostingJsonLd(job: JobPosting): Record<string, unknown> | null {
  /*
   * CLOSED POSTINGS GET NO MARKUP, and this is the guard that matters most now
   * the page is public.
   *
   * Google's JobPosting guidance is explicit that an expired posting must stop
   * being served as structured data — by 404/410, by a past validThrough, or
   * by removing the markup. This page deliberately still RENDERS a closed
   * posting (a shared link should explain itself rather than 404), so removing
   * the markup is the applicable one of the three.
   *
   * Without this, a filled role stays eligible for Google for Jobs and the
   * first anyone hears of it is a candidate applying to something that closed
   * weeks ago. The sitemap already filters on `status = 'open'`, but a crawler
   * that has the URL from anywhere else does not consult the sitemap.
   */
  if (job.status !== "open") return null;

  /*
   * A posting can be `open` and already past its expiry, for up to a day.
   *
   * The expiry sweep (src/lib/jobs/expiry.ts) closes internal postings whose
   * employer-set date has passed, but it rides the 05:00 ingest cron — so
   * between the moment an expiry passes and the next run, the row is still
   * `open` and this function would happily emit `validThrough` in the past.
   * Google treats a JobPosting whose validThrough has passed as expired
   * markup on a live page, which is a Search Console error rather than a
   * silent omission.
   *
   * Emit nothing instead, consistent with every other guard here: absent
   * markup costs eligibility, invalid markup costs trust. This is a backstop
   * for the sweep's scheduling gap, NOT a substitute for it — the page itself
   * still shows the posting as open until the sweep runs, and that is the
   * sweep's job to fix, not this function's.
   */
  if (job.expires_at && new Date(job.expires_at).getTime() <= Date.now()) return null;

  const description = tidy(job.description ?? "");
  // `description` is required, and Google rejects one identical to the title.
  if (!job.title?.trim() || !description || description === tidy(job.title)) return null;
  if (!job.posted_at) return null;

  const loc = parseJobLocation(job.location);
  const isRemote = loc.remote || job.work_type === "remote";

  // Required: jobLocation, unless the role is fully remote and says where its
  // applicants may live.
  const applicantCountries =
    loc.remoteCountries.length > 0 ? loc.remoteCountries : loc.places.map((p) => p.country);
  const hasUsableLocation = loc.places.length > 0;
  // Required: a physical jobLocation, OR a TELECOMMUTE role that says which
  // countries its applicants may live in. Neither means no valid markup.
  if (!hasUsableLocation && !(isRemote && applicantCountries.length > 0)) return null;

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: tidy(job.title),
    description,
    datePosted: new Date(job.posted_at).toISOString(),
    hiringOrganization: {
      "@type": "Organization",
      name: job.company_name,
      ...(job.company_logo_url ? { logo: job.company_logo_url } : {}),
    },
    ...(hasUsableLocation
      ? {
          jobLocation: loc.places.map((p) => ({
            "@type": "Place",
            address: {
              "@type": "PostalAddress",
              ...(p.locality ? { addressLocality: p.locality } : {}),
              addressCountry: p.country,
            },
          })),
        }
      : {}),
    identifier: {
      "@type": "PropertyValue",
      name: job.company_name,
      value: job.id,
    },
    url: absoluteUrl(`/jobs/${job.id}`),
  };

  if (isRemote) {
    jsonLd.jobLocationType = "TELECOMMUTE";
    // Required by Google whenever jobLocationType is TELECOMMUTE.
    jsonLd.applicantLocationRequirements = applicantCountries.map((name) => ({
      "@type": "Country",
      name,
    }));
  }

  const employmentType = job.employment_type ? EMPLOYMENT_TYPE[job.employment_type] : undefined;
  if (employmentType) jsonLd.employmentType = employmentType;

  // Only when a source actually stated one — see the header.
  if (job.expires_at) jsonLd.validThrough = new Date(job.expires_at).toISOString();

  // Only when a currency AND at least one bound are on the row — see the
  // header's baseSalary paragraph for why a bound with no currency does not
  // count as one.
  const salaryMin = toFiniteNumber(job.salary_min);
  const salaryMax = toFiniteNumber(job.salary_max);
  if (job.salary_currency && (salaryMin !== undefined || salaryMax !== undefined)) {
    const min = salaryMin ?? salaryMax!;
    const max = salaryMax ?? salaryMin!;
    const unitText = job.salary_unit ? SALARY_UNIT_TEXT[job.salary_unit] : undefined;
    jsonLd.baseSalary = {
      "@type": "MonetaryAmount",
      currency: job.salary_currency,
      value: {
        "@type": "QuantitativeValue",
        minValue: min,
        maxValue: max,
        ...(unitText ? { unitText } : {}),
      },
    };
  }

  /*
   * directApply is FALSE for external postings on purpose. Auto-Apply hands
   * those off to the source site rather than submitting, and the detail page
   * links out — so claiming a direct application flow would be untrue, and
   * Google treats it as a quality signal it can check.
   */
  jsonLd.directApply = job.source_type === "internal";

  return jsonLd;
}
