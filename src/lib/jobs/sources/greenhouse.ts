import "server-only";
import { computeDedupFingerprint } from "../dedup";
import { extractStructuredJd, inferSeniority, inferWorkType, stripHtml } from "../extract-jd";
import type { NormalizedJobPosting } from "../types";

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at: string;
  content?: string;
  location?: { name?: string };
  company_name?: string;
}

interface GreenhouseBoardResponse {
  jobs: GreenhouseJob[];
}

/**
 * boards-api.greenhouse.io is a public, unauthenticated per-company job-board
 * API (build-prompt §6.12) — no API key needed, but board tokens are
 * per-company and not guessable; see src/lib/jobs/sources.config.ts for the
 * curated list this build ships with.
 */
export async function fetchGreenhouseJobs(
  boardToken: string,
  companyName: string,
): Promise<NormalizedJobPosting[]> {
  const res = await fetch(
    `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs?content=true`,
    { cache: "no-store" },
  );

  if (!res.ok) {
    throw new Error(`Greenhouse board "${boardToken}" returned ${res.status}`);
  }

  const data = (await res.json()) as GreenhouseBoardResponse;

  return data.jobs.map((job) => {
    const description = job.content ? stripHtml(job.content) : "";
    const location = job.location?.name;

    return {
      title: job.title,
      companyName: job.company_name || companyName,
      location,
      workType: inferWorkType(job.title, location),
      seniority: inferSeniority(job.title),
      description,
      structuredJd: extractStructuredJd(description),
      externalUrl: job.absolute_url,
      externalSource: "greenhouse" as const,
      postedAt: job.updated_at,
      dedupFingerprint: computeDedupFingerprint(companyName, job.title, location),
    };
  });
}
