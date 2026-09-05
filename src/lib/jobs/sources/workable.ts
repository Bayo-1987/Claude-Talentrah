import "server-only";
import { computeDedupFingerprint } from "../dedup";
import { extractStructuredJd, inferSeniority, inferWorkType, stripHtml } from "../extract-jd";
import type { EmploymentType, NormalizedJobPosting, WorkType } from "../types";

const FETCH_TIMEOUT_MS = 15_000;

/**
 * Shape of one entry in the widget's `jobs` array. Fetched with
 * `?details=true` — without it the endpoint omits `description` entirely
 * (verified live against Kuda's real board, 2026-09-05: the bare endpoint
 * returns every field below EXCEPT `description`; adding `?details=true`
 * adds exactly that one field, same HTML-content shape Greenhouse's `content`
 * field carries). Everything else here was confirmed present on every one of
 * Kuda's 16 raw entries, not inferred from docs.
 */
interface WorkableJob {
  title: string;
  shortcode: string;
  employment_type?: string;
  /** The one real work-arrangement signal this endpoint carries — see
   * `mapWorkType` below for why it only ever asserts "remote", never
   * "onsite"/"hybrid". */
  telecommuting?: boolean;
  url: string;
  application_url?: string;
  published_on?: string;
  created_at?: string;
  country?: string;
  city?: string;
  state?: string;
  description?: string;
}

interface WorkableAccountResponse {
  name: string;
  jobs: WorkableJob[];
}

/**
 * `telecommuting` is a real field (like Lever's `workplaceType`), not an
 * absence (like Greenhouse) — but it is a boolean, not a three-way enum, so it
 * can only ever assert the POSITIVE case with confidence: an employer checked
 * "this can be done remotely" in Workable's own posting form. `false` means
 * only "not flagged remote" — it says nothing about hybrid vs. onsite, the
 * exact ambiguity `inferWorkType` exists to take a best-effort guess at from
 * the title/location text, which is why (unlike Lever, which has no such
 * ambiguity to fall back from) it is used here for the `false` branch. This
 * mirrors Greenhouse's fallback rather than replacing it: the real field is
 * read directly whenever it gives a confident answer, and `inferWorkType`
 * only ever fills the gap it is honest about being unable to close itself.
 */
function mapWorkType(job: WorkableJob, location: string | undefined): WorkType | undefined {
  if (job.telecommuting === true) return "remote";
  return inferWorkType(job.title, location);
}

/** Same includes-based, defensive mapping as lever.ts's mapEmploymentType —
 * Workable's own values observed live ("Full-time") match the same casing
 * convention that function already guards against case sensitivity for. */
function mapEmploymentType(raw: string | undefined): EmploymentType | undefined {
  if (!raw) return undefined;
  const text = raw.toLowerCase();
  if (text.includes("intern")) return "internship";
  if (text.includes("part")) return "part_time";
  if (text.includes("contract") || text.includes("temporary")) return "contract";
  if (text.includes("full")) return "full_time";
  return undefined;
}

function formatLocation(job: WorkableJob): string | undefined {
  return [job.city, job.state, job.country].filter(Boolean).join(", ") || undefined;
}

/**
 * ISO date, or undefined. `published_on`/`created_at` are date-only strings
 * ("2026-07-31"), which `Date.parse` accepts (as UTC midnight) — same
 * "omit, never guess" contract schema-org.ts's `mapValidThrough` documents for
 * the same class of source-stated-but-not-ISO date.
 */
function toIsoDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

/**
 * `apply.workable.com/api/v1/widget/accounts/<account>` is Workable's own
 * documented "job widget" — the same feature a Workable customer uses to
 * embed their own board on their own careers page (see
 * help.workable.com/hc/en-us/articles/115012801727), served publicly and
 * unauthenticated for any known account slug, the same openness class as
 * `boards-api.greenhouse.io` and `api.lever.co/v0/postings` above. See
 * sources.config.ts's WORKABLE COMPANY BOARDS section for the robots.txt/ToS
 * check that clears this for ingestion and for how Kuda's account slug
 * ("kuda") was confirmed rather than guessed.
 *
 * WHY A SEPARATE FETCHER FROM schema-org.ts, EVEN THOUGH BOTH ARE "WORKABLE".
 * This is a single-company JSON API keyed by an account token — same shape as
 * Greenhouse/Lever, nothing to crawl or parse out of HTML/JSON-LD. The
 * existing `workable-nigeria`/`workable-lagos`/etc. sources hit a completely
 * different surface (`jobs.workable.com/search/<term>`, a multi-employer
 * search page whose JobPosting data is embedded as schema.org JSON-LD) and
 * that code path stays exactly as it is.
 *
 * WHY IDENTIFY HONESTLY. Same convention as
 * src/lib/scholarships/recheck.ts's fetchPage: a crawler pretending to be a
 * browser forfeits the "our robots.txt evidence covers this" claim this file
 * (and sources.config.ts) makes.
 */
export async function fetchWorkableJobs(
  account: string,
  companyName: string,
): Promise<NormalizedJobPosting[]> {
  const res = await fetch(
    `https://apply.workable.com/api/v1/widget/accounts/${account}?details=true`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "user-agent": "TalentrahJobIngest/1.0 (+https://claude-talentrah.vercel.app)",
        accept: "application/json",
      },
    },
  );

  if (!res.ok) {
    throw new Error(`Workable account "${account}" returned ${res.status}`);
  }

  const data = (await res.json()) as WorkableAccountResponse;
  const resolvedCompanyName = data.name || companyName;

  /*
   * DEDUPE BY shortcode/url FIRST — Workable flattens one requisition posted
   * to MULTIPLE locations into one array entry PER LOCATION, all sharing the
   * same `shortcode`/`url`/`application_url`. Verified live against Kuda's
   * real board, 2026-09-05: "Vice President of Engineering" (shortcode
   * 61F507FDD7) appears twice — once tagged Cape Town, once Johannesburg —
   * and nothing else about the two entries differs. Left alone, this would
   * insert the SAME requisition as two rows under two different
   * `dedup_fingerprint`s (location is part of the fingerprint) pointing at
   * the identical apply link, which is a worse failure than the one
   * `disambiguateFingerprint` in ingest.ts exists to fix — that guards two
   * DIFFERENT requisitions that happen to collide, not one requisition
   * counted twice. The first-seen location wins; nothing is fabricated by
   * picking one over the other, and the posting is not lost either way.
   */
  const seenShortcodes = new Set<string>();
  const jobs: WorkableJob[] = [];
  for (const job of data.jobs ?? []) {
    if (seenShortcodes.has(job.shortcode)) continue;
    seenShortcodes.add(job.shortcode);
    jobs.push(job);
  }

  return jobs.map((job) => {
    const location = formatLocation(job);
    const description = job.description ? stripHtml(job.description) : "";

    return {
      title: job.title,
      companyName: resolvedCompanyName,
      location,
      workType: mapWorkType(job, location),
      employmentType: mapEmploymentType(job.employment_type),
      seniority: inferSeniority(job.title),
      description,
      structuredJd: extractStructuredJd(description),
      // The job's own page (title, full description, apply link from there),
      // not `application_url` — same "link to the posting, not straight into
      // the form" convention `absolute_url`/`hostedUrl` already follow for
      // Greenhouse/Lever.
      externalUrl: job.url,
      externalSource: "workable" as const,
      postedAt: toIsoDate(job.published_on) ?? toIsoDate(job.created_at) ?? new Date().toISOString(),
      dedupFingerprint: computeDedupFingerprint(resolvedCompanyName, job.title, location),
    };
  });
}
