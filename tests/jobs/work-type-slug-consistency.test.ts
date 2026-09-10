/**
 * Standing check: a job's own external_url slug must never contradict its
 * stored work_type. Whole-table sweep against the live database (this repo
 * has no staging DB — CLAUDE.md), not a fixture-seeded scenario, because the
 * bug this pins was a DATA problem, not a code path nobody exercised.
 *
 * THE INCIDENT THIS PINS, AND WHAT ACTUALLY HAPPENED (corrected send-135,
 * superseding an earlier, wrong account below this file used to carry).
 * Workable (the schema-org source this pipeline ingests) encodes a work-type
 * hint directly into its own URL slugs —
 * `.../view/<id>/hybrid-<role>-in-<city>-at-<company>`. #219's own PR body is
 * explicit that it shipped NO migration and NO manual backfill at all: the
 * fix relies on `ingest.ts` upserting on `dedup_fingerprint` and rewriting
 * `work_type` on every run, so any row re-ingested after the fix landed
 * self-corrects on its own.
 *
 * This file previously claimed a backfill had been run and "actually only
 * against the Nigerian sources" — checked directly against production and
 * that framing does not hold up: correctly-labelled `hybrid` rows with a
 * `hybrid-` slug exist from South Africa, Kenya and elsewhere too, not just
 * Nigeria, whenever the posting was re-crawled after #219 merged
 * (2026-09-05T07:53:40Z). What the 12 residual violations found here shared
 * was not a country, it was TIMING: every one of them has `last_checked_at`
 * strictly BEFORE that merge — each had already stopped being re-crawled
 * (closed/removed from its source) before the fix ever had a chance to
 * self-correct it. A row that never gets ingested again cannot self-correct;
 * that is the actual, and much less surprising, gap. All 12 were `status =
 * 'closed'`, so nothing user-facing was broken by them, but that's luck, not
 * a property this schema enforces — a closed row is not excluded here,
 * because the row's own slug already knows it's wrong regardless of whether
 * the posting is currently visible.
 *
 * Corrected directly against production (send-135, 2026-09-10): all 12 rows
 * had `work_type` set to `hybrid` via a one-off `UPDATE ... WHERE work_type =
 * 'remote' AND external_url ~ '/hybrid-[^/]*$'` run through the Supabase MCP
 * connector, matching #234's own precedent for a pure data correction with no
 * schema change (56267d6) — no migration, since nothing here is a repeatable
 * schema change. This is the check that would have caught the residue on the
 * day #219 shipped, instead of weeks later.
 *
 * A quick look at this repo's other historical backfills (#234's own onsite
 * backfill, the only other one on record) found no sign of the same
 * "silently narrower than reported" mistake — #234 explicitly backfilled ALL
 * 457 open postings, broken down and verified by SOURCE rather than by
 * country, with no equivalent residue.
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
 *
 * The `onsite` pair below (added alongside the onsite-inference change this
 * file shipped with) has no known live counterexample either — the
 * production backfill that populated `onsite` only ever wrote it from
 * `work_type IS NULL`, never over an existing `remote`/`hybrid` row, so there
 * is nothing today for a `hybrid-`/`remote-` slug to contradict. It is
 * asserted anyway, for the same reason as the pair above: the value this
 * check protects is that a FUTURE mapping regression gets caught here, not
 * that a present one exists — the whole point of a standing check is to fail
 * on a bug that has not been written yet.
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

/**
 * Fetches every row (whole-table, not `.limit(...)` — a truncated result
 * here would report "clean" the same way an empty one does, which is
 * exactly the failure mode CLAUDE.md documents; `.range` makes the page
 * size explicit rather than relying on the client's default) stored as
 * `storedWorkType`, and returns the ones whose slug starts with any of
 * `contradictingPrefixes`.
 */
async function findSlugContradictions(
  storedWorkType: "remote" | "hybrid" | "onsite",
  contradictingPrefixes: string[],
) {
  const { data, error } = await admin
    .from("job_postings")
    .select("id, external_url")
    .eq("work_type", storedWorkType)
    .not("external_url", "is", null)
    .range(0, 9999);
  if (error) throw error;

  return (data ?? []).filter((row) =>
    contradictingPrefixes.some((prefix) => slugPrefix(row.external_url).startsWith(prefix)),
  );
}

describe("job_postings — external_url slug must not contradict work_type", () => {
  it("no row has a 'hybrid-' slug stored as work_type = 'remote'", async () => {
    const violations = await findSlugContradictions("remote", ["hybrid-"]);
    expect(
      violations,
      `rows whose URL slug says 'hybrid' but work_type says 'remote': ${JSON.stringify(violations)}`,
    ).toEqual([]);
  });

  it("no row has a 'remote-' slug stored as work_type = 'hybrid'", async () => {
    const violations = await findSlugContradictions("hybrid", ["remote-"]);
    expect(
      violations,
      `rows whose URL slug says 'remote' but work_type says 'hybrid': ${JSON.stringify(violations)}`,
    ).toEqual([]);
  });

  /**
   * The case this PR's own onsite-inference change introduces. A slug
   * asserting either remote OR hybrid contradicts `onsite` equally — unlike
   * the pair above, there is no legitimate reading of a `hybrid-`/`remote-`
   * slug that is consistent with an on-site posting, so both prefixes are
   * checked in one pass rather than needing a fourth test.
   */
  it("no row has a 'hybrid-' or 'remote-' slug stored as work_type = 'onsite'", async () => {
    const violations = await findSlugContradictions("onsite", ["hybrid-", "remote-"]);
    expect(
      violations,
      `rows whose URL slug says 'hybrid'/'remote' but work_type says 'onsite': ${JSON.stringify(violations)}`,
    ).toEqual([]);
  });
});
