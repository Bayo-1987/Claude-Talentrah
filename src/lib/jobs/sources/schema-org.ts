import "server-only";
import { computeDedupFingerprint } from "../dedup";
import { extractStructuredJd, inferSeniority, stripHtml } from "../extract-jd";
import { schemaOrgSourceKey } from "../types";
import type { EmploymentType, NormalizedJobPosting, WorkType } from "../types";

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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The contract-drift guard `test-scenarios-external-api-integrations-prompt.md`
 * §1 already flags as missing from `greenhouse.ts`/`lever.ts` — this fetcher
 * is greenfield, so it's built in from the start instead of repeating that
 * gap. A source publishing malformed markup for one listing must not zero
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
