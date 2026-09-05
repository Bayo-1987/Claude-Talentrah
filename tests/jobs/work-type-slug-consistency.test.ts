/**
 * Standing check: a job's own external_url slug must never contradict its
 * stored work_type. Whole-table sweep against the live database (this repo
 * has no staging DB — CLAUDE.md), not a fixture-seeded scenario, because the
 * bug this pins was a DATA problem, not a code path nobody exercised.
 *
 * THE INCIDENT THIS PINS. Workable (the schema-org source this pipeline
 * ingests) encodes a work-type hint directly into its own URL slugs —
 * `.../view/<id>/hybrid-<role>-in-<city>-at-<company>`. The #219 hybrid-
 * inference fix corrected the mapper going forward and was reported to have
 * backfilled the historical rows it left behind, but the backfill had
 * actually only been run against the Nigerian sources: 14 production rows
 * (12 South Africa, 2 Kenya — zero Nigeria) kept a `hybrid-` slug while
 * `work_type` stayed `remote`. All 14 happen to be `status = 'closed'` today,
 * so nothing user-facing is broken by them right now, but that's luck, not a
 * property this schema enforces — a closed row is not excluded here, because
 * the row's own slug already knows it's wrong regardless of whether the
 * posting is currently visible. This is the check that would have caught the
 * incomplete backfill on the day it ran, instead of three weeks later.
 *
 * WHY tests/jobs/ AND WHY A NEW FILE, not folded into schema-org.test.ts or
 * ingest-schema-org.test.ts: those two are both about the FETCHER's mapping
 * logic (network-mocked unit tests, or one seeded round-trip through
 * ingestAllSources()) — this is neither. It is a property of whatever data
 * already lives in `job_postings`, independent of how any particular row got
 * there, so it belongs with the other whole-table invariant in this repo
 * (tests/rls/column-privileges.test.ts) in spirit if not in literal
 * location — kept in tests/jobs/ specifically because the slug convention
 * and the column it checks are both job-ingestion concepts, not RLS ones.
 *
 * The `remote-` ↔ `hybrid` direction has no known live counterexample — it is
 * asserted anyway because it is the identical mistake in the other direction
 * and costs nothing to guard against before it happens once.
 */
import { describe, expect, it } from "vitest";
import { admin } from "../support/auth";

/** The descriptive part of a Workable slug — the last `/`-delimited,
 * percent-decoded path segment — lowercased for a case-insensitive prefix
 * check. Returns "" for a URL this can't parse, which matches neither
 * prefix and therefore never falsely reports a contradiction. */
function slugPrefix(externalUrl: string | null): string {
  if (!externalUrl) return "";
  try {
    const { pathname } = new URL(externalUrl);
    const lastSegment = pathname.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(lastSegment).toLowerCase();
  } catch {
    return "";
  }
}

describe("job_postings — external_url slug must not contradict work_type", () => {
  it("no row has a 'hybrid-' slug stored as work_type = 'remote'", async () => {
    // Whole-table, not `.limit(...)` — a truncated result here would report
    // "clean" the same way an empty one does, which is exactly the failure
    // mode CLAUDE.md documents. `.range` makes the page size explicit rather
    // than relying on the client's default.
    const { data, error } = await admin
      .from("job_postings")
      .select("id, external_url")
      .eq("work_type", "remote")
      .not("external_url", "is", null)
      .range(0, 9999);
    if (error) throw error;

    const violations = (data ?? []).filter((row) => slugPrefix(row.external_url).startsWith("hybrid-"));
    expect(
      violations,
      `rows whose URL slug says 'hybrid' but work_type says 'remote': ${JSON.stringify(violations)}`,
    ).toEqual([]);
  });

  it("no row has a 'remote-' slug stored as work_type = 'hybrid'", async () => {
    const { data, error } = await admin
      .from("job_postings")
      .select("id, external_url")
      .eq("work_type", "hybrid")
      .not("external_url", "is", null)
      .range(0, 9999);
    if (error) throw error;

    const violations = (data ?? []).filter((row) => slugPrefix(row.external_url).startsWith("remote-"));
    expect(
      violations,
      `rows whose URL slug says 'remote' but work_type says 'hybrid': ${JSON.stringify(violations)}`,
    ).toEqual([]);
  });
});
