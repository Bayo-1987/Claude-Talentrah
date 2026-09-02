export type WorkType = "remote" | "hybrid" | "onsite";
export type EmploymentType = "full_time" | "part_time" | "contract" | "internship";
export type SeniorityLevel = "entry" | "mid" | "senior" | "lead" | "executive";
export type SalaryUnit = "hour" | "day" | "week" | "month" | "year";

export interface StructuredJD {
  skills: string[];
  keywords: string[];
  responsibilities: string[];
}

export interface NormalizedJobPosting {
  title: string;
  companyName: string;
  companyLogoUrl?: string;
  location?: string;
  workType?: WorkType;
  employmentType?: EmploymentType;
  seniority?: SeniorityLevel;
  description: string;
  structuredJd: StructuredJD;
  externalUrl: string;
  /**
   * Which configured source produced this row. Greenhouse/Lever use the bare
   * discriminator; a schema.org source uses `schema-org:<label>` — see
   * `schemaOrgSourceKey` below for why the label is part of the value.
   */
  externalSource: "greenhouse" | "lever" | `schema-org:${string}`;
  postedAt: string;
  dedupFingerprint: string;
  /** From schema.org's `validThrough`, when the source stated one and it
   * parses as a real date. ISO timestamp. Feeds `job_postings.expires_at` —
   * see src/lib/jobs/expiry.ts for why populating this for an external
   * posting does not change how or when it closes. */
  expiresAt?: string;
  /** From schema.org's `baseSalary`. All four travel together or not at all
   * — see sources/schema-org.ts's mapBaseSalary for why a bound with no
   * currency is treated as no salary at all, never a fabricated one. */
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryUnit?: SalaryUnit;
}

/**
 * Greenhouse/Lever are single-company API namespaces, keyed by a board
 * token — `companyName` is fixed for every job the fetch returns. A
 * schema.org source has no such namespace: it's a URL to crawl, and (for a
 * multi-employer board like a job aggregator) each JobPosting block carries
 * its own `hiringOrganization`, so `companyName` isn't fixed per config —
 * see `sources/schema-org.ts`. Modelled as a discriminated union rather than
 * bolting an optional `url` onto the old flat shape, so a `greenhouse`
 * config can't accidentally omit `token` or vice versa.
 */
export type JobSourceConfig =
  | { source: "greenhouse"; token: string; companyName: string }
  | { source: "lever"; token: string; companyName: string }
  | { source: "schema-org"; url: string; label: string };

/**
 * The `external_source` value written for a schema.org source, and the value
 * its freshness sweep scopes to. One function so the writer and the closure
 * query cannot drift apart — they are the two halves of the same contract, and
 * a mismatch is silent: rows simply stop being closable.
 *
 * WHY THE LABEL IS IN THE VALUE. greenhouse/lever get scoped by a second
 * predicate, `company_name`, because a board token maps to exactly one
 * company. A schema.org source has no such column to scope by — one listing
 * can span many hiring organisations — so the sweep originally matched on the
 * bare `"schema-org"`, which is identical for every schema.org config.
 * Correct with one source; with two, each run closed the other's rows (A's
 * fingerprints are absent from B's seen list and vice versa), so the feed lost
 * half its external postings on every ingest, silently. Putting the label in
 * `external_source` gives each source its own namespace in the column it is
 * already scoped by. Proven by tests/jobs/ingest-schema-org-multi-source.test.ts.
 */
export function schemaOrgSourceKey(label: string): `schema-org:${string}` {
  return `schema-org:${label}`;
}

/** The `external_source` a given config owns — the single source of truth for
 * both the upsert and the closure sweep. */
export function externalSourceKey(config: JobSourceConfig): string {
  return config.source === "schema-org" ? schemaOrgSourceKey(config.label) : config.source;
}
