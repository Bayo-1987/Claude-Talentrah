import "server-only";
import { computeDedupFingerprint } from "../dedup";
import { extractStructuredJd, inferSeniority, stripHtml } from "../extract-jd";
import { schemaOrgSourceKey } from "../types";
import type { EmploymentType, NormalizedJobPosting, SalaryUnit, WorkType } from "../types";

const FETCH_TIMEOUT_MS = 15_000;
/**
 * Phase 1 is a curated pilot, not a crawler (same philosophy as
 * sources.config.ts's single-Greenhouse-board seed) — cap how many job
 * detail pages one listing fetch will follow, so a source with hundreds of
 * live postings can't turn a scheduled ingest into an unbounded crawl.
 */
const MAX_JOBS_PER_LISTING = 40;
const DETAIL_FETCH_CONCURRENCY = 5;

interface SkipReason {
  url: string;
  reason: string;
}

/** What this module actually asserts about a parsed JSON-LD object before
 * trusting it — see module doc below for why. */
interface ValidJobPostingBlock {
  title: string;
  description?: string;
  datePosted?: string;
  employmentType?: string;
  hiringOrganization: { name: string; logo?: string };
  jobLocation?: { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } };
  jobLocationType?: string;
  applicantLocationRequirements?: unknown;
  url?: string;
  /** Carried through unvalidated, same as employmentType — mapValidThrough
   * does the actual date parsing and is where an unparsable value gets
   * dropped rather than guessed at. */
  validThrough?: string;
  /** Untyped on purpose: schema.org's baseSalary is a MonetaryAmount whose
   * `value` is either a bare number or a nested QuantitativeValue, and a
   * malformed shape here must not throw — mapBaseSalary is where that gets
   * sorted out defensively. */
  baseSalary?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The contract-drift guard `greenhouse.ts`/`lever.ts` still lack: both cast
 * their API responses straight through with no shape check, so a change at the
 * source throws a raw TypeError and takes the whole batch with it. (A review
 * brief named that gap; the brief is not in this repo, so the durable
 * reference is those two files themselves.) This fetcher is greenfield, so the
 * guard is built in from the start rather than repeating the gap. A source publishing malformed markup for one listing must not zero
 * out every other listing in the same batch, so this returns a pass/fail
 * plus a human-readable reason rather than throwing.
 */
function validateJobPosting(candidate: unknown): ValidJobPostingBlock | { error: string } {
  if (!isRecord(candidate)) return { error: "not an object" };
  if (candidate["@type"] !== "JobPosting") return { error: `@type is "${String(candidate["@type"])}", not "JobPosting"` };

  const title = candidate.title;
  if (typeof title !== "string" || !title.trim()) return { error: "missing or non-string title" };

  const org = candidate.hiringOrganization;
  const orgName = isRecord(org) ? org.name : undefined;
  if (typeof orgName !== "string" || !orgName.trim()) {
    return { error: "missing or malformed hiringOrganization.name" };
  }

  const jobLocation = candidate.jobLocation;
  const hasLocationObject = isRecord(jobLocation);
  const hasRemoteSignal =
    candidate.jobLocationType === "TELECOMMUTE" || candidate.applicantLocationRequirements !== undefined;
  if (!hasLocationObject && !hasRemoteSignal) {
    return { error: "no jobLocation and no remote flag (jobLocationType/applicantLocationRequirements)" };
  }

  const logo = isRecord(org) && typeof org.logo === "string" ? org.logo : undefined;

  return {
    title,
    description: typeof candidate.description === "string" ? candidate.description : undefined,
    datePosted: typeof candidate.datePosted === "string" ? candidate.datePosted : undefined,
    employmentType: typeof candidate.employmentType === "string" ? candidate.employmentType : undefined,
    hiringOrganization: { name: orgName, logo },
    jobLocation: hasLocationObject ? (jobLocation as ValidJobPostingBlock["jobLocation"]) : undefined,
    jobLocationType: typeof candidate.jobLocationType === "string" ? candidate.jobLocationType : undefined,
    applicantLocationRequirements: candidate.applicantLocationRequirements,
    url: typeof candidate.url === "string" ? candidate.url : undefined,
    validThrough: typeof candidate.validThrough === "string" ? candidate.validThrough : undefined,
    baseSalary: candidate.baseSalary,
  };
}

/**
 * `<script type="application/ld+json">` blocks can hold a single object, an
 * array of objects, or an object with a `@graph` array (schema.org allows
 * all three) — flatten to a plain array of candidate nodes regardless of
 * shape, same as Fuzu's and Workable's real pages both use (`@graph` for
 * page chrome like `Organization`/`WebSite`, a bare object for the
 * `JobPosting`/`ItemList` itself).
 */
function extractJsonLdNodes(html: string): unknown[] {
  const nodes: unknown[] = [];
  const scriptRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(html)) !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue; // malformed block on the page — skip it, not the whole page
    }
    if (Array.isArray(parsed)) {
      nodes.push(...parsed);
    } else if (isRecord(parsed) && Array.isArray(parsed["@graph"])) {
      nodes.push(...(parsed["@graph"] as unknown[]));
    } else {
      nodes.push(parsed);
    }
  }
  return nodes;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.text();
}

function mapWorkType(block: ValidJobPostingBlock): WorkType | undefined {
  if (block.jobLocationType === "TELECOMMUTE") return "remote";
  return undefined;
}

function mapEmploymentType(raw: string | undefined): EmploymentType | undefined {
  if (!raw) return undefined;
  const text = raw.toUpperCase();
  if (text.includes("INTERN")) return "internship";
  if (text.includes("PART")) return "part_time";
  if (text.includes("CONTRACT") || text === "TEMPORARY") return "contract";
  if (text.includes("FULL")) return "full_time";
  return undefined;
}

/**
 * `validThrough` as ISO, or undefined. `Date.parse` accepts a wide range of
 * real-world formats (schema.org itself only requires ISO 8601, but sources
 * are inconsistent), and anything it cannot parse is dropped rather than
 * defaulted — the same "omit, never guess" rule Google's own JobPosting
 * guidance asks for, already applied to `expires_at` on the DB→markup side
 * in src/lib/seo/job-posting-jsonld.ts.
 */
function mapValidThrough(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

/** ISO 4217-shaped, uppercased. Not a real currency-code lookup — this app
 * has no reason to enumerate every ISO code, only to reject something that
 * obviously is not one before it reaches a column with no CHECK constraint
 * to catch it (see migration 0085 for why there is deliberately no
 * constraint). */
function mapCurrency(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const upper = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? upper : undefined;
}

/** schema.org's unitText values (HOUR/DAY/WEEK/MONTH/YEAR, sometimes
 * "Annual" or a schema.org URL) mapped the same defensive, includes-based way
 * mapEmploymentType is — unmapped is omitted, never guessed. */
function mapSalaryUnit(raw: unknown): SalaryUnit | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.toUpperCase();
  if (text.includes("YEAR") || text.includes("ANNUM") || text.includes("ANNUAL")) return "year";
  if (text.includes("MONTH")) return "month";
  if (text.includes("WEEK")) return "week";
  if (text.includes("DAY")) return "day";
  if (text.includes("HOUR")) return "hour";
  return undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

interface ParsedSalary {
  min?: number;
  max?: number;
  currency?: string;
  unit?: SalaryUnit;
}

/**
 * schema.org's baseSalary is a MonetaryAmount wrapping a `value` that is
 * either a bare number (a single stated figure) or a nested QuantitativeValue
 * (minValue/maxValue/value, plus unitText) — both shapes appear in the wild,
 * and neither is guaranteed well-formed. Defensive per this file's contract-
 * drift guard: a malformed baseSalary must cost this ONE optional field, not
 * the listing it is attached to.
 *
 * Currency is required for a result at all — see types.ts's note on
 * NormalizedJobPosting.salaryCurrency. A number with no stated currency is
 * not a fact this app can act on or display, and guessing one (e.g.
 * defaulting to NGN) would be exactly the fabrication the task this shipped
 * under was explicit about never doing. An inverted range (max < min) is
 * treated the same way: not a range anyone stated, so omitted rather than
 * silently swapped or half-kept.
 */
function mapBaseSalary(raw: unknown): ParsedSalary | undefined {
  if (!isRecord(raw)) return undefined;

  const currency = mapCurrency(raw.currency);
  if (!currency) return undefined;

  const valueNode = "value" in raw ? raw.value : raw;
  let min: number | undefined;
  let max: number | undefined;
  let unit: SalaryUnit | undefined;

  if (isFiniteNumber(valueNode)) {
    min = valueNode;
    max = valueNode;
  } else if (isRecord(valueNode)) {
    const minValue = isFiniteNumber(valueNode.minValue) ? valueNode.minValue : undefined;
    const maxValue = isFiniteNumber(valueNode.maxValue) ? valueNode.maxValue : undefined;
    const singleValue = isFiniteNumber(valueNode.value) ? valueNode.value : undefined;
    min = minValue ?? singleValue;
    max = maxValue ?? singleValue;
    unit = mapSalaryUnit(valueNode.unitText);
  }

  if (min === undefined && max === undefined) return undefined;
  if (min !== undefined && max !== undefined && max < min) return undefined;

  return { min, max, currency, unit };
}

function formatLocation(block: ValidJobPostingBlock): string | undefined {
  const addr = block.jobLocation?.address;
  if (!addr) return block.jobLocationType === "TELECOMMUTE" ? "Remote" : undefined;
  const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean);
  if (parts.length === 0) return block.jobLocationType === "TELECOMMUTE" ? "Remote" : undefined;
  return parts.join(", ");
}

function toNormalizedJobPosting(
  block: ValidJobPostingBlock,
  fallbackUrl: string,
  sourceLabel: string,
): NormalizedJobPosting {
  const description = block.description ? stripHtml(block.description) : "";
  const location = formatLocation(block);
  const companyName = block.hiringOrganization.name;
  const externalUrl = block.url ?? fallbackUrl;
  const salary = mapBaseSalary(block.baseSalary);

  return {
    title: block.title,
    companyName,
    companyLogoUrl: block.hiringOrganization.logo,
    location,
    workType: mapWorkType(block),
    employmentType: mapEmploymentType(block.employmentType),
    seniority: inferSeniority(block.title),
    description,
    structuredJd: extractStructuredJd(description),
    externalUrl,
    externalSource: schemaOrgSourceKey(sourceLabel),
    postedAt: block.datePosted ?? new Date().toISOString(),
    dedupFingerprint: computeDedupFingerprint(companyName, block.title, location),
    expiresAt: mapValidThrough(block.validThrough),
    salaryMin: salary?.min,
    salaryMax: salary?.max,
    salaryCurrency: salary?.currency,
    salaryUnit: salary?.unit,
  };
}

/** A listing page's `ItemList` JSON-LD, if present — schema.org's standard
 * way to enumerate "here are the items on this page" without embedding each
 * item's full markup inline. Both Fuzu and Workable emit this shape on their
 * search/listing pages, linking out to each job's own detail page (which
 * carries the actual `JobPosting` block) rather than repeating it inline. */
function extractItemListUrls(nodes: unknown[]): string[] {
  const urls: string[] = [];
  for (const node of nodes) {
    if (!isRecord(node) || node["@type"] !== "ItemList") continue;
    const items = Array.isArray(node.itemListElement) ? node.itemListElement : [];
    for (const item of items) {
      if (!isRecord(item)) continue;
      const url = typeof item.url === "string" ? item.url : isRecord(item.item) ? item.item.url : undefined;
      if (typeof url === "string") urls.push(url);
    }
  }
  return urls;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Fetches a schema.org/JobPosting source: either a listing page whose
 * `ItemList` JSON-LD links out to individual job pages (Fuzu, Workable —
 * see `sources.config.ts` for the verified source this ships with), or a
 * page that carries `JobPosting` blocks directly. Both shapes are handled
 * from the same entry point so a future single-employer careers page (no
 * `ItemList` indirection) works without a second code path.
 *
 * Never throws on a single bad listing or a single bad job page — logs and
 * skips, per the contract-drift guard above. Only throws if the top-level
 * listing URL itself is unreachable, same failure mode as
 * `fetchGreenhouseJobs`/`fetchLeverJobs` when their board 404s.
 */
export async function fetchSchemaOrgJobs(
  listingUrl: string,
  sourceLabel: string,
): Promise<{ jobs: NormalizedJobPosting[]; skipped: SkipReason[] }> {
  const listingHtml = await fetchHtml(listingUrl);
  const listingNodes = extractJsonLdNodes(listingHtml);

  const directPostings = listingNodes.filter(
    (n) => isRecord(n) && n["@type"] === "JobPosting",
  );
  const linkedUrls = extractItemListUrls(listingNodes).slice(0, MAX_JOBS_PER_LISTING);

  const skipped: SkipReason[] = [];
  const jobs: NormalizedJobPosting[] = [];

  for (const raw of directPostings) {
    const validated = validateJobPosting(raw);
    if ("error" in validated) {
      skipped.push({ url: listingUrl, reason: validated.error });
      continue;
    }
    jobs.push(toNormalizedJobPosting(validated, listingUrl, sourceLabel));
  }

  const detailResults = await mapWithConcurrency(linkedUrls, DETAIL_FETCH_CONCURRENCY, async (jobUrl) => {
    try {
      const html = await fetchHtml(jobUrl);
      const nodes = extractJsonLdNodes(html);
      const postings = nodes.filter((n) => isRecord(n) && n["@type"] === "JobPosting");
      if (postings.length === 0) {
        return { skip: { url: jobUrl, reason: "no JobPosting JSON-LD block on the linked page" } };
      }
      const validated = validateJobPosting(postings[0]);
      if ("error" in validated) return { skip: { url: jobUrl, reason: validated.error } };
      return { job: toNormalizedJobPosting(validated, jobUrl, sourceLabel) };
    } catch (err) {
      return { skip: { url: jobUrl, reason: err instanceof Error ? err.message : String(err) } };
    }
  });

  for (const result of detailResults) {
    if (result.job) jobs.push(result.job);
    else if (result.skip) skipped.push(result.skip);
  }

  if (skipped.length > 0) {
    console.warn(
      `[schema-org:${sourceLabel}] skipped ${skipped.length}/${directPostings.length + linkedUrls.length} listings:`,
      skipped,
    );
  }

  return { jobs, skipped };
}
