import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { fetchGreenhouseJobs } from "./sources/greenhouse";
import { fetchLeverJobs } from "./sources/lever";
import { fetchSchemaOrgJobs } from "./sources/schema-org";
import { JOB_SOURCES } from "./sources.config";
import { disambiguateFingerprint } from "./dedup";
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
  /**
   * Postings in this fetch whose canonical key collided with another's and
   * were given a disambiguated fingerprint so both survive. Zero is the
   * expected value; a non-zero one means the source is publishing several
   * requisitions that look identical on company + title + location.
   *
   * Surfaced because the previous behaviour was to drop them silently and
   * still report `upserted` as if nothing had happened — the count looked
   * right no matter how many apply links had been lost.
   */
  collided?: number;
  /**
   * True when the freshness sweep was deliberately NOT run because the fetch
   * returned zero postings while the source still had open ones.
   *
   * Not an error and not a failure — but it does mean this source may now be
   * serving postings that are no longer live, so it must be visible in the
   * summary rather than inferred from `closed: 0`, which is also what a
   * perfectly healthy run looks like.
   */
  closureSkipped?: boolean;
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

      /*
       * Two postings in one fetch cannot share a fingerprint — ON CONFLICT DO
       * UPDATE can't touch the same row twice in one command. This used to be
       * resolved by `new Map(...)`, which is last-one-wins: every colliding
       * posting but one was discarded, silently, including its `external_url`.
       * That URL is the apply link, so the cost of a collision was a real job
       * the seeker could see but never reach.
       *
       * Now they are disambiguated instead of dropped. See
       * `disambiguateFingerprint` for why that is safe for cross-source dedup
       * and what it trades away.
       */
      const { jobs, collided } = resolveFingerprintCollisions(fetchedJobs);
      if (collided > 0) {
        console.warn(
          `[ingest:${config.source}/${configIdentifier(config)}] ${collided} posting(s) shared a canonical ` +
            `key (company+title+location) with another in the same fetch and were disambiguated by URL. ` +
            `Previously these were dropped silently.`,
        );
      }

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
        // A source-stated fact, not a commitment this pipeline makes — see
        // src/lib/jobs/expiry.ts for why populating this does NOT make an
        // external posting eligible for date-based closure. Every row in
        // this batch carries the same key set (present or null, never
        // conditionally omitted), which is what keeps this upsert from
        // reproducing the scholarship pipeline's mixed-shape incident,
        // where a conditionally-omitted key on some rows of one bulk upsert
        // forced NULL onto the same column for every other row in the batch.
        expires_at: job.expiresAt ?? null,
        salary_min: job.salaryMin ?? null,
        salary_max: job.salaryMax ?? null,
        salary_currency: job.salaryCurrency ?? null,
        salary_unit: job.salaryUnit ?? null,
      }));

      let upserted = 0;
      if (rows.length > 0) {
        const { error, count } = await supabase
          .from("job_postings")
          .upsert(rows, { onConflict: "dedup_fingerprint", count: "exact" });
        if (error) throw error;
        upserted = count ?? rows.length;
      }

      /*
       * Freshness: anything from this source we didn't just see is stale.
       *
       * SCOPE. Greenhouse/Lever are single-company boards, so scoping by the
       * static `config.companyName` is exactly right. A schema-org source has
       * no single company — one listing URL can span many hiring organisations
       * — so it scopes to the source instead, via `externalSourceKey`.
       *
       * THE EMPTY-FETCH GUARD. "Anything I did not just see" means
       * *everything* when the fetch returned nothing, so a board answering 200
       * with an empty array — a deploy, a rate limit answered politely, a
       * markup change on a listing page — used to close every posting for that
       * source. The next run reopens them, so the damage is a window rather
       * than permanent, but during it the feed is missing real jobs and
       * nothing said so. This was documented in a comment here for months
       * pointing at a brief that does not exist in this repo, which is a fair
       * part of why it stayed unfixed.
       *
       * The rule is ANY, not a threshold. "Refuse to close when the fetch is
       * empty but open postings exist" — deliberately not "…but MANY open
       * postings exist", because the two cases a threshold would try to
       * separate are not actually distinguishable from here. A source that
       * genuinely emptied and a source that glitched both return zero, and the
       * only difference is what we already hold. Withholding closure when we
       * hold one posting costs one stale listing until the next run; picking a
       * threshold to close it faster buys nothing and adds a number nobody can
       * justify. A source that is *supposed* to be empty simply has nothing
       * open, hits the `openBefore === 0` branch, and is a silent no-op.
       *
       * An empty fetch is not evidence. A non-empty one is: normal turnover —
       * two postings become one — still closes the one that went away, because
       * the source affirmatively told us what is live.
       */
      const sourceKey = externalSourceKey(config);
      let closureSkipped = false;

      if (jobs.length === 0) {
        let openQuery = supabase
          .from("job_postings")
          .select("id", { count: "exact", head: true })
          .eq("external_source", sourceKey)
          .eq("status", "open");
        if (config.source !== "schema-org") {
          openQuery = openQuery.eq("company_name", config.companyName);
        }
        const { count: openBefore, error: openError } = await openQuery;
        if (openError) throw openError;

        if ((openBefore ?? 0) > 0) {
          closureSkipped = true;
          console.warn(
            `[ingest:${config.source}/${configIdentifier(config)}] fetch returned 0 postings while ` +
              `${openBefore} are still open — SKIPPING the freshness sweep. An empty response is not ` +
              `evidence those jobs ended. This source may now be serving stale postings; if it repeats ` +
              `across runs, the source itself needs looking at.`,
          );
          results.push({
            source: config.source,
            identifier: configIdentifier(config),
            fetched: 0,
            upserted,
            closed: 0,
            collided,
            closureSkipped: true,
            skipped: skippedCount,
          });
          continue;
        }
      }

      /*
       * INVERTED, not a `.not("dedup_fingerprint", "in", ...)` over every
       * fingerprint this run just fetched. That embeds the whole seen-list in
       * one request's query string, which grows with the SOURCE's size and
       * has no ceiling — Moniepoint alone is past 100 open postings and only
       * grows, and a filter value has to fit in one URL. Stage 2 (moving CI
       * onto a stack that replays ingest against a source shaped like
       * production, not a handful of fixtures) is what surfaced this as a
       * real ceiling rather than a theoretical one.
       *
       * Fetching the currently-open rows for this source and diffing in JS
       * inverts which list has to fit in a query: the SELECT below carries no
       * fingerprint list at all (bounded by the two `.eq()`s alone,
       * regardless of source size), and the UPDATE that follows is scoped by
       * `.in("id", staleIds)` — normally a handful of ids (the postings that
       * disappeared this run), not the hundreds still open. `staleIds` is
       * still chunked before the UPDATE as defence in depth: a source's
       * first run, or one that goes from fully-populated to empty between
       * runs, could in principle produce a stale list large enough to repeat
       * the same problem this replaces.
       */
      let openQueryForClose = supabase
        .from("job_postings")
        .select("id, dedup_fingerprint")
        // `externalSourceKey`, not `config.source` — for schema-org that is
        // `schema-org:<label>`, the same value the fetcher wrote. Matching on
        // the bare discriminator here scoped every schema-org config to the
        // same set of rows, so a second source closed the first's postings
        // (and vice versa) on every run. See types.ts for the full note.
        .eq("external_source", sourceKey)
        .eq("status", "open");
      if (config.source !== "schema-org") {
        openQueryForClose = openQueryForClose.eq("company_name", config.companyName);
      }
      const { data: openRows, error: openRowsError } = await openQueryForClose;
      if (openRowsError) throw openRowsError;

      const seenFingerprints = new Set(jobs.map((j) => j.dedupFingerprint));
      const staleIds = (openRows ?? [])
        .filter((row) => !seenFingerprints.has(row.dedup_fingerprint))
        .map((row) => row.id);

      const CLOSE_BATCH_SIZE = 200;
      let closed = 0;
      for (let i = 0; i < staleIds.length; i += CLOSE_BATCH_SIZE) {
        const batch = staleIds.slice(i, i + CLOSE_BATCH_SIZE);
        const { data: closedRows, error: closeError } = await supabase
          .from("job_postings")
          .update({ status: "closed", last_checked_at: new Date().toISOString() })
          .in("id", batch)
          .select("id");
        if (closeError) throw closeError;
        closed += closedRows?.length ?? 0;
      }

      results.push({
        source: config.source,
        identifier: configIdentifier(config),
        fetched: jobs.length,
        upserted,
        closed,
        collided,
        closureSkipped,
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

/**
 * Keeps every posting in a fetch, giving a unique fingerprint to any that
 * collide on the canonical company+title+location key.
 *
 * Returns the collision count so the caller can report it. The first posting
 * with a given fingerprint keeps it unchanged, so the common case — no
 * collisions — produces byte-identical fingerprints to before this existed and
 * no row churn on the next ingest.
 */
function resolveFingerprintCollisions(fetched: NormalizedJobPosting[]): {
  jobs: NormalizedJobPosting[];
  collided: number;
} {
  const seen = new Set<string>();
  const jobs: NormalizedJobPosting[] = [];
  let collided = 0;

  for (const job of fetched) {
    if (!seen.has(job.dedupFingerprint)) {
      seen.add(job.dedupFingerprint);
      jobs.push(job);
      continue;
    }

    const unique = disambiguateFingerprint(job.dedupFingerprint, job.externalUrl);
    if (seen.has(unique)) {
      // Same canonical key AND the same URL — genuinely the same posting listed
      // twice by the source. Nothing is lost by keeping one.
      continue;
    }
    seen.add(unique);
    jobs.push({ ...job, dedupFingerprint: unique });
    collided++;
  }

  return { jobs, collided };
}
