import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin } from "../support/auth";
import { upsertScholarships, groupRowsByShape } from "@/lib/scholarships/ingest";
import { computeScholarshipFingerprint } from "@/lib/scholarships/dedup";
import type { NormalizedScholarship } from "@/lib/scholarships/types";

/**
 * The 2026-09-02 production incident: the daily cron's single mixed-shape
 * `.upsert()` call let `@supabase/postgrest-js` union every row's keys into
 * one `columns=` list, so the 3 rows this pass auto-published (adding
 * `moderation_status`/`moderated_at`) forced those columns onto the other 15
 * rows too — and because `defaultToNull` defaults to `true`, "absent" became
 * literal `NULL`, not the column default, violating `moderation_status`'s
 * NOT NULL constraint and failing the whole batch (`ok=false upserted=0
 * errors=1` at 07:09).
 *
 * Run against the real database, not a mock — the four existing
 * `tests/scholarships/*.test.ts` files that DO mock `upsertScholarships`'s
 * Supabase client are exactly why this shipped undetected: their fake
 * `upsert()` just captures the array and returns success, never exercising
 * postgrest-js's real key-union/`defaultToNull` behaviour. That gap is the
 * point of this file existing separately from them.
 */

const RUN = randomUUID().slice(0, 8);
const created: string[] = [];

function listing(overrides: Partial<NormalizedScholarship> = {}): NormalizedScholarship {
  return {
    provider: `UPSERT-SHAPE-TEST Provider ${RUN}`,
    programName: `Programme ${RUN}`,
    hostInstitution: "Test University",
    degreeLevels: ["msc"],
    fieldTags: ["Engineering"],
    fundingType: "full",
    fundingCovers: ["Tuition"],
    eligibilityNationalities: ["Nigeria"],
    eligibilityPriorDegree: "BSc",
    eligibilityAge: null,
    eligibilityOther: null,
    applicationDeadline: "2099-06-30",
    cycleYear: 2099,
    officialUrl: "https://example.org/scholarship",
    sourceName: "Official test source",
    deadlineVerifiedAt: null,
    deadlineNote: null,
    reviewNote: null,
    ...overrides,
  };
}

async function rowFor(fingerprint: string) {
  const { data, error } = await admin
    .from("scholarships")
    .select("id, moderation_status, moderation_note, moderated_at")
    .eq("dedup_fingerprint", fingerprint)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function track(fingerprint: string) {
  const row = await rowFor(fingerprint);
  if (row && !created.includes(row.id)) created.push(row.id);
  return row;
}

beforeAll(async () => {
  const { error } = await admin.from("scholarships").select("id").limit(1);
  if (error) throw new Error(`cannot reach scholarships: ${error.message}`);
});

afterAll(async () => {
  if (created.length === 0) return;
  const { error } = await admin.from("scholarships").delete().in("id", created);
  if (error) {
    console.warn(`[cleanup] ${created.length} test scholarships left behind: ${error.message}`);
  }
});

describe("groupRowsByShape", () => {
  it("puts every row within a single group under identical keys", () => {
    const rows = [
      { a: 1, b: 2 },
      { b: 3, a: 4 }, // same keys, different order — must group with the row above
      { a: 5, b: 6, c: 7 },
      { a: 8, b: 9 },
    ];
    for (const group of groupRowsByShape(rows)) {
      const keysets = group.map((row) => Object.keys(row).sort().join(","));
      expect(new Set(keysets).size, "a group must not mix row shapes").toBe(1);
    }
  });

  it("never merges two groups whose keys differ", () => {
    const rows = [{ a: 1 }, { a: 1, b: 2 }];
    const groups = groupRowsByShape(rows);
    expect(groups).toHaveLength(2);
  });
});

describe("a mixed-shape batch — the incident's exact reproduction", () => {
  it("auto-published rows do not NULL out moderation_status on their plain siblings", async () => {
    // One row this pass auto-publishes (adds moderation_status/moderated_at),
    // one plain row that does not — the exact 3-vs-15 split from production,
    // scaled down. Pre-fix, this NOT NULL-violates and result.error is set;
    // post-fix, each shape gets its own upsert and both rows land correctly.
    const autoPublishable = listing({
      programName: `Auto-Publish Case ${RUN}`,
      deadlineVerifiedAt: "2026-09-02T06:00:00.000Z",
    });
    const plain = listing({ programName: `Plain Case ${RUN}` });

    const fpAuto = computeScholarshipFingerprint(
      autoPublishable.provider,
      autoPublishable.programName,
      autoPublishable.cycleYear,
    );
    const fpPlain = computeScholarshipFingerprint(
      plain.provider,
      plain.programName,
      plain.cycleYear,
    );

    const result = await upsertScholarships([autoPublishable, plain], {
      autoPublishMachineVerified: true,
    });

    expect(result.error, "a mixed-shape batch must not fail the whole write").toBeNull();
    expect(result.autoPublished).toEqual([fpAuto]);
    expect(result.upserted).toBe(2);

    const autoRow = await track(fpAuto);
    const plainRow = await track(fpPlain);

    expect(autoRow?.moderation_status).toBe("verified");
    // The row that never asked to be touched must still be the column
    // default, never a NULL leaked in from its batch-mate's shape.
    expect(
      plainRow?.moderation_status,
      "the plain row's moderation_status was NULLed by its auto-published batch-mate",
    ).toBe("pending");
  });

  it("a supplied review note does not NULL out a stored reviewer note on a collision row", async () => {
    // The quieter cousin hazard: no NOT NULL constraint to trip, so this fails
    // silently rather than erroring. Publish and hand-annotate one listing,
    // then re-ingest it (unchanged, no reviewNote) in the same batch as an
    // unrelated NEW listing that DOES carry a reviewNote — the two shapes
    // that must not be allowed to union into one upsert call.
    const published = listing({ programName: `Has Stored Note ${RUN}` });
    const fpPublished = computeScholarshipFingerprint(
      published.provider,
      published.programName,
      published.cycleYear,
    );
    await upsertScholarships([published]);
    const row = await track(fpPublished);
    const { error: setupError } = await admin
      .from("scholarships")
      .update({
        moderation_status: "verified",
        moderated_at: new Date().toISOString(),
        moderation_note: "Reviewer checked this by hand.",
      })
      .eq("id", row!.id);
    if (setupError) throw setupError;

    const withReviewNote = listing({
      programName: `Has Review Note ${RUN}`,
      reviewNote: "Flagged during sourcing pass.",
    });
    const fpWithNote = computeScholarshipFingerprint(
      withReviewNote.provider,
      withReviewNote.programName,
      withReviewNote.cycleYear,
    );

    const result = await upsertScholarships([published, withReviewNote]);
    expect(result.error).toBeNull();
    await track(fpWithNote);

    const publishedAfter = await rowFor(fpPublished);
    expect(
      publishedAfter?.moderation_note,
      "a batch-mate's moderation_note NULLed this row's stored reviewer note",
    ).toBe("Reviewer checked this by hand.");

    const withNoteAfter = await rowFor(fpWithNote);
    expect(withNoteAfter?.moderation_note).toBe("Flagged during sourcing pass.");
  });
});
