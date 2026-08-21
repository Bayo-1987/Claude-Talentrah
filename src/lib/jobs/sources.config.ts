import type { JobSourceConfig } from "./types";

/**
 * Curated starter list, per build-prompt §6.12/§9 — a small focused set for
 * Phase 1, not broad crawling.
 *
 * Moniepoint's Greenhouse board is real, live, and Nigerian (~127 open roles
 * at time of writing) — verified against the live API while building this
 * pipeline and used as the actual seed source for external jobs.
 *
 * The Lever fetcher (src/lib/jobs/sources/lever.ts) is fully implemented and
 * was verified field-for-field against Lever's real public API shape via
 * direct curl against their "leverdemo" sandbox board — but that fetch is
 * unreliable from inside this dev environment's Next.js runtime specifically
 * (works fine via plain curl, fails via Next's server-side fetch — looks
 * environment-specific, not a bug in the mapping logic). Rather than ship a
 * flaky demo-only source with no real data behind it, it's left out of the
 * default list. Add a real African/Nigerian employer's Lever token here once
 * one is confirmed live.
 */
export const JOB_SOURCES: JobSourceConfig[] = [
  { source: "greenhouse", token: "moniepoint", companyName: "Moniepoint" },
];
