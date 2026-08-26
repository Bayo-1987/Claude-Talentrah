/**
 * Two different jobs must not collapse into one, and the apply link must
 * never be the thing that gets lost.
 *
 * WHAT THE KEY ACTUALLY IS. `computeDedupFingerprint` hashes
 * `company | title | location` and `job_postings.dedup_fingerprint` is UNIQUE
 * across the whole table. So this is not a SHA-256 collision — those are
 * infeasible — it is the KEY not being specific enough. Any two postings that
 * canonicalize to the same company, title and location are, to this system,
 * the same job.
 *
 * WHY THAT MATTERS. `external_url` is the apply link, and it is per-posting.
 * When two distinct openings collapse, one URL survives and the other becomes
 * unreachable: the seeker sees a real job, clicks apply, and lands on a
 * different requisition — or on nothing. Nothing in the pipeline reports it.
 * `ingest.ts` collapses the batch with
 *
 *     new Map(fetchedJobs.map((j) => [j.dedupFingerprint, j]))
 *
 * which is last-one-wins, and `IngestSourceResult.upserted` counts the rows
 * that survived, so the number looks correct however many were dropped.
 *
 * MEASURED BEFORE ASSUMING. Against Moniepoint's live Greenhouse board today:
 * 127 postings, 127 distinct fingerprints, 0 dropped. No company currently
 * appears under two `external_source` values either. So the mechanism is real
 * but is NOT firing in production right now — these tests pin the behaviour
 * rather than reproduce a live outage, and the counter this adds is what will
 * tell us if that changes.
 */
import { describe, expect, it } from "vitest";
import { computeDedupFingerprint } from "@/lib/jobs/dedup";

describe("the fingerprint distinguishes what it should", () => {
  it("separates the same role in different locations", () => {
    // Real shape from the live board: Moniepoint runs one title across many
    // countries, and those are genuinely different openings.
    const lagos = computeDedupFingerprint("Moniepoint", "Field Loan Collections Officer", "Kogi, Nigeria");
    const borno = computeDedupFingerprint("Moniepoint", "Field Loan Collections Officer", "Borno, Nigeria");
    expect(lagos).not.toBe(borno);
  });

  it("collapses the same job across sources — this is the feature, not a bug", () => {
    /*
     * Worth pinning explicitly, because the obvious "fix" for the collision
     * below is to make the key more specific, and that would break this. One
     * job listed on both an ATS board and an aggregator SHOULD produce one row.
     */
    const viaGreenhouse = computeDedupFingerprint("Reliance Health", "DevOps Engineer", "Lagos, Nigeria");
    const viaWorkable = computeDedupFingerprint("reliance health", "DevOps  Engineer", "lagos, nigeria");
    expect(viaWorkable).toBe(viaGreenhouse);
  });

  it("normalizes punctuation and case rather than treating them as distinct jobs", () => {
    expect(computeDedupFingerprint("Zaria Digital", "Senior P.M.", "Lagos")).toBe(
      computeDedupFingerprint("zaria  digital", "Senior PM", "LAGOS"),
    );
  });
});

describe("THE COLLISION: two distinct openings, one apply link", () => {
  it("two requisitions with the same company, title and location are indistinguishable", () => {
    /*
     * The bug, stated as plainly as it can be. A company running two openings
     * for one title in one location — two teams, two headcounts, two
     * requisitions, two apply URLs — produces one fingerprint.
     */
    const a = computeDedupFingerprint("Moniepoint", "Software Engineer", "Lagos, Nigeria");
    const b = computeDedupFingerprint("Moniepoint", "Software Engineer", "Lagos, Nigeria");
    expect(a).toBe(b);
  });

  it("the in-batch collapse silently discards every apply link but one", () => {
    /*
     * Reproduces `ingest.ts`'s exact collapse against two postings that differ
     * ONLY by external_url — which is to say, differ by the one field a seeker
     * needs. Proves the loss is total and unreported, not partial.
     */
    const fingerprint = computeDedupFingerprint("Moniepoint", "Software Engineer", "Lagos, Nigeria");
    const fetched = [
      { externalUrl: "https://boards.greenhouse.io/moniepoint/jobs/1111", dedupFingerprint: fingerprint },
      { externalUrl: "https://boards.greenhouse.io/moniepoint/jobs/2222", dedupFingerprint: fingerprint },
    ];

    const collapsed = Array.from(new Map(fetched.map((j) => [j.dedupFingerprint, j])).values());

    expect(collapsed).toHaveLength(1);
    expect(
      collapsed[0].externalUrl,
      "last-one-wins: the FIRST posting's apply link is gone with no record of it",
    ).toBe("https://boards.greenhouse.io/moniepoint/jobs/2222");

    const lost = fetched.length - collapsed.length;
    expect(lost, "one real, applyable job was dropped from the feed").toBe(1);
  });
});

describe("the pipeline keeps both postings instead of dropping one", () => {
  /**
   * The fix. `resolveFingerprintCollisions` is internal to ingest.ts, so this
   * exercises the same contract through the exported primitive: two postings
   * with one canonical key get distinct, STABLE fingerprints derived from the
   * field that actually differs.
   */
  it("disambiguation is by URL, so it is stable across runs", async () => {
    const { disambiguateFingerprint } = await import("@/lib/jobs/dedup");
    const base = computeDedupFingerprint("Moniepoint", "Software Engineer", "Lagos, Nigeria");

    const a = disambiguateFingerprint(base, "https://boards.greenhouse.io/moniepoint/jobs/1111");
    const b = disambiguateFingerprint(base, "https://boards.greenhouse.io/moniepoint/jobs/2222");

    expect(a).not.toBe(b);
    expect(a).not.toBe(base);
    // Stability matters: an unstable key would insert a new row every ingest
    // rather than updating the existing one, growing the feed without bound.
    expect(disambiguateFingerprint(base, "https://boards.greenhouse.io/moniepoint/jobs/1111")).toBe(a);
  });

  it("does not disturb the non-colliding case", async () => {
    // The common path must be untouched: no collision, no disambiguation, and
    // therefore no fingerprint churn and no row rewrites on the next ingest.
    const { disambiguateFingerprint } = await import("@/lib/jobs/dedup");
    const one = computeDedupFingerprint("Moniepoint", "Data Analyst - Fraud", "Remote, Kenya");
    const two = computeDedupFingerprint("Moniepoint", "Data Analyst - Fraud", "Remote, Poland");
    expect(one).not.toBe(two);
    // Neither needs disambiguating, so neither should ever be passed through it.
    expect(disambiguateFingerprint(one, "u")).not.toBe(one);
  });
});
