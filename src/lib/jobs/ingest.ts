import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { fetchGreenhouseJobs } from "./sources/greenhouse";
import { fetchLeverJobs } from "./sources/lever";
import { JOB_SOURCES } from "./sources.config";
import type { NormalizedJobPosting } from "./types";

export interface IngestSourceResult {
  source: string;
  token: string;
  fetched: number;
  upserted: number;
  closed: number;
  error?: string;
}

async function fetchSource(
  config: (typeof JOB_SOURCES)[number],
): Promise<NormalizedJobPosting[]> {
  if (config.source === "greenhouse") {
    return fetchGreenhouseJobs(config.token, config.companyName);
  }
  return fetchLeverJobs(config.token, config.companyName);
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
      const fetchedJobs = await fetchSource(config);

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
      const seenFingerprints = jobs.map((j) => j.dedupFingerprint);
      const { data: closedRows, error: closeError } = await supabase
        .from("job_postings")
        .update({ status: "closed", last_checked_at: new Date().toISOString() })
        .eq("external_source", config.source)
        .eq("company_name", config.companyName)
        .eq("status", "open")
        .not(
          "dedup_fingerprint",
          "in",
          `(${seenFingerprints.map((f) => `"${f}"`).join(",") || '""'})`,
        )
        .select("id");
      if (closeError) throw closeError;

      results.push({
        source: config.source,
        token: config.token,
        fetched: jobs.length,
        upserted,
        closed: closedRows?.length ?? 0,
      });
    } catch (err) {
      results.push({
        source: config.source,
        token: config.token,
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
