import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { fetchGreenhouseJobs } from "./sources/greenhouse";
import { fetchLeverJobs } from "./sources/lever";
import { fetchSchemaOrgJobs } from "./sources/schema-org";
import { JOB_SOURCES } from "./sources.config";
import { externalSourceKey } from "./types";
import type { JobSourceConfig, NormalizedJobPosting } from "./types";

export interface IngestSourceResult {
  source: string;
  /** Board token for greenhouse/lever, listing URL for schema-org — whatever
   * identifies *which* configured source this result is for. */
  identifier: string;
  fetched: number;
  upserted: number;
  closed: number;
  /** schema-org only: listings that were fetched but couldn't be mapped
   * (missing hiringOrganization, unparseable JSON-LD, etc.) — see
   * sources/schema-org.ts's contract-drift guard. Not a failure: the rest of
   * the batch still ingests normally. */
  skipped?: number;
  error?: string;
}

async function fetchSource(
  config: JobSourceConfig,
): Promise<{ jobs: NormalizedJobPosting[]; skipped?: number }> {
  if (config.source === "greenhouse") {
    return { jobs: await fetchGreenhouseJobs(config.token, config.companyName) };
  }
  if (config.source === "lever") {
    return { jobs: await fetchLeverJobs(config.token, config.companyName) };
  }
  const { jobs, skipped } = await fetchSchemaOrgJobs(config.url, config.label);
  return { jobs, skipped: skipped.length };
}

function configIdentifier(config: JobSourceConfig): string {
  return config.source === "schema-org" ? config.url : config.token;
}

/**
 * Runs ingestion for every configured source. Not part of any user-facing
 * request path (build-prompt §8's "aggregation pipeline runs as background
 * jobs" requirement) — call this from a scheduled trigger (see
 * src/app/api/admin/ingest-jobs/route.ts, meant for Vercel Cron once
 * deployed) or on demand.
 */
export async function ingestAllSources(): Promise<IngestSourceResult[]> {
  const supabase = createServiceRoleClient();
  const results: IngestSourceResult[] = [];

  for (const config of JOB_SOURCES) {
    try {
      const { jobs: fetchedJobs, skipped: skippedCount } = await fetchSource(config);

      // Some boards list the same role twice (e.g. duplicate postings across
      // teams) which would otherwise collide within a single upsert batch —
      // ON CONFLICT DO UPDATE can't touch the same row twice in one command.
      const jobs = Array.from(
        new Map(fetchedJobs.map((j) => [j.dedupFingerprint, j])).values(),
      );

      const rows = jobs.map((job) => ({
        source_type: "external" as const,
        organization_id: null,
        title: job.title,
        company_name: job.companyName,
        company_logo_url: job.companyLogoUrl ?? null,
        location: job.location ?? null,
        work_type: job.workType ?? null,
        employment_type: job.employmentType ?? null,
        seniority: job.seniority ?? null,
        description: job.description,
        structured_jd: JSON.parse(JSON.stringify(job.structuredJd)),
        external_url: job.externalUrl,
        external_source: job.externalSource,
        status: "open" as const,
        posted_at: job.postedAt,
        last_checked_at: new Date().toISOString(),
        dedup_fingerprint: job.dedupFingerprint,
      }));

      let upserted = 0;
      if (rows.length > 0) {
        const { error, count } = await supabase
          .from("job_postings")
          .upsert(rows, { onConflict: "dedup_fingerprint", count: "exact" });
        if (error) throw error;
        upserted = count ?? rows.length;
      }

      // Freshness: anything from this source we didn't just see is stale.
      // Greenhouse/Lever are single-company boards, so scoping by the static
      // `config.companyName` (unchanged from before this source was added)
      // is exactly right — it also means a totally empty fetch closes that
      // one company's rows, same known behaviour as always (the "transient
      // empty-200 mass-closes a source's live postings" risk this shares is
      // tracked separately in test-scenarios-job-feed-matching-prompt.md,
      // not fixed here). A schema-org source has no such single company —
      // one listing URL can span many hiring organizations (Workable's
      // aggregated search is exactly this) — so its closure scope is the
      // *source*, not a company, checked against every fingerprint seen
      // anywhere in this fetch. That correctly closes a company's posting
      // that drops off the listing (normal turnover) while a still-listed
      // company's postings are untouched, and it carries the same
      // whole-source blast radius as the greenhouse/lever case if the
      // listing page itself glitches empty — worth the same fix, whenever
      // that prompt's mitigation lands, applied here too.
      const seenFingerprints = jobs.map((j) => j.dedupFingerprint);
      let closeQuery = supabase
        .from("job_postings")
        .update({ status: "closed", last_checked_at: new Date().toISOString() })
        // `externalSourceKey`, not `config.source` — for schema-org that is
        // `schema-org:<label>`, the same value the fetcher wrote. Matching on
        // the bare discriminator here scoped every schema-org config to the
        // same set of rows, so a second source closed the first's postings
        // (and vice versa) on every run. See types.ts for the full note.
        .eq("external_source", externalSourceKey(config))
        .eq("status", "open");
      if (config.source !== "schema-org") {
        closeQuery = closeQuery.eq("company_name", config.companyName);
      }
      const { data: closedRows, error: closeError } = await closeQuery
        .not(
          "dedup_fingerprint",
          "in",
          `(${seenFingerprints.map((f) => `"${f}"`).join(",") || '""'})`,
        )
        .select("id");
      if (closeError) throw closeError;
      const closed = closedRows?.length ?? 0;

      results.push({
        source: config.source,
        identifier: configIdentifier(config),
        fetched: jobs.length,
        upserted,
        closed,
        skipped: skippedCount,
      });
    } catch (err) {
      results.push({
        source: config.source,
        identifier: configIdentifier(config),
        fetched: 0,
        upserted: 0,
        closed: 0,
        error:
          err instanceof Error
            ? err.message
            : (() => {
                try {
                  return JSON.stringify(err);
                } catch {
                  return String(err);
                }
              })(),
      });
    }
  }

  return results;
}
