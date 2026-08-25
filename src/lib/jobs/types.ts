export type WorkType = "remote" | "hybrid" | "onsite";
export type EmploymentType = "full_time" | "part_time" | "contract" | "internship";
export type SeniorityLevel = "entry" | "mid" | "senior" | "lead" | "executive";

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
  externalSource: "greenhouse" | "lever" | "schema-org";
  postedAt: string;
  dedupFingerprint: string;
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
