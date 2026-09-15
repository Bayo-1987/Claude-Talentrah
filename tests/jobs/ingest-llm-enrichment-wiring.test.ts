/**
 * Confirms `ingestAllSources` (src/lib/jobs/ingest.ts) actually calls Stage
 * 8 Step 1b's `enrichThinPostings` once per run — the "wired in" half of
 * "built and wired, but off" (docs/ingest-llm-enrichment.md). The off/on
 * behaviour of enrichThinPostings itself (the feature-flag gate, candidate
 * selection, merge logic) is covered exhaustively in
 * tests/jobs/enrich-thin.test.ts; this file only proves the two are
 * actually connected, and that a failure in enrichment can never take down
 * an otherwise-successful ingest run.
 *
 * JOB_SOURCES is mocked to an empty list so the source-fetching loop is a
 * no-op — this test has nothing to do with Greenhouse/Lever/schema-org
 * fetching, which is already covered by ingest-schema-org*.test.ts and
 * friends.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/jobs/sources.config", () => ({ JOB_SOURCES: [] }));

const enrichThinPostings = vi.hoisted(() => vi.fn());
vi.mock("@/lib/jobs/enrich-thin", () => ({ enrichThinPostings }));

beforeEach(() => {
  enrichThinPostings.mockReset();
});

describe("ingestAllSources calling enrichThinPostings", () => {
  it("calls enrichThinPostings once per run, after the source loop", async () => {
    enrichThinPostings.mockResolvedValue({ enabled: false, attempted: 0, enriched: 0, errors: [] });
    const { ingestAllSources } = await import("@/lib/jobs/ingest");

    const results = await ingestAllSources();

    expect(enrichThinPostings).toHaveBeenCalledTimes(1);
    expect(results).toEqual([]); // no sources configured — nothing else happened
  });

  it("does not let an enrichment failure fail the ingest run", async () => {
    enrichThinPostings.mockRejectedValue(new Error("enrichment blew up"));
    const { ingestAllSources } = await import("@/lib/jobs/ingest");

    await expect(ingestAllSources()).resolves.toEqual([]);
    expect(enrichThinPostings).toHaveBeenCalledTimes(1);
  });
});
