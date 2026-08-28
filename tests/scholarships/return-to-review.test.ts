import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedScholarship } from "@/lib/scholarships/types";

/**
 * The decision `upsertScholarships` makes per row: leave the moderation status
 * alone, or send a published listing back for review.
 *
 * Mocked deliberately, and it is the right instrument here rather than a
 * shortcut. What is under test is a comparison between what we are about to
 * write and what is stored — so the interesting inputs are stored rows with
 * specific shapes, including ones that are annoying to produce against a real
 * database (a timestamp Postgres formats differently from the way we sent it).
 * The fake lets the test STATE the stored row and then assert on the exact
 * payload the writer builds. tests/scholarships/admin-posting.test.ts covers
 * the same rules end to end against real Postgres.
 */

let storedRows: Array<Record<string, unknown>> = [];
let upsertedRows: Array<Record<string, unknown>> = [];

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: storedRows, error: null }),
      }),
      upsert: (rows: Array<Record<string, unknown>>) => {
        upsertedRows = rows;
        return Promise.resolve({ error: null, count: rows.length });
      },
    }),
  }),
}));

const { upsertScholarships, CONTENT_COLUMNS } = await import("@/lib/scholarships/ingest");
const { computeScholarshipFingerprint } = await import("@/lib/scholarships/dedup");

const LISTING: NormalizedScholarship = {
  provider: "Test Provider",
  programName: "Test Programme",
  hostInstitution: "Test University",
  degreeLevels: ["msc"],
  fieldTags: ["Engineering"],
  fundingType: "full",
  fundingCovers: ["Tuition", "Stipend"],
  eligibilityNationalities: ["Nigeria"],
  eligibilityPriorDegree: "BSc",
  eligibilityAge: "Under 35",
  eligibilityOther: null,
  applicationDeadline: "2026-03-31",
  cycleYear: 2026,
  officialUrl: "https://example.org/scholarship",
  sourceName: "Manual entry",
  deadlineVerifiedAt: null,
  deadlineNote: null,
  reviewNote: null,
};

const FINGERPRINT = computeScholarshipFingerprint(
  LISTING.provider,
  LISTING.programName,
  LISTING.cycleYear,
);

/** The stored row as PostgREST would hand it back for this listing. */
function storedAs(
  moderationStatus: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    dedup_fingerprint: FINGERPRINT,
    moderation_status: moderationStatus,
    provider: LISTING.provider,
    program_name: LISTING.programName,
    host_institution: LISTING.hostInstitution,
    degree_levels: LISTING.degreeLevels,
    field_tags: LISTING.fieldTags,
    funding_type: LISTING.fundingType,
    funding_covers: LISTING.fundingCovers,
    eligibility_nationalities: LISTING.eligibilityNationalities,
    eligibility_prior_degree: LISTING.eligibilityPriorDegree,
    eligibility_age: LISTING.eligibilityAge,
    eligibility_other: LISTING.eligibilityOther,
    application_deadline: LISTING.applicationDeadline,
    cycle_year: LISTING.cycleYear,
    official_url: LISTING.officialUrl,
    source_name: LISTING.sourceName,
    deadline_verified_at: LISTING.deadlineVerifiedAt,
    deadline_note: LISTING.deadlineNote,
    ...overrides,
  };
}

beforeEach(() => {
  storedRows = [];
  upsertedRows = [];
});

describe("the row the writer builds", () => {
  it("never names moderation_status when nothing is stored", async () => {
    await upsertScholarships([LISTING]);
    expect(Object.keys(upsertedRows[0])).not.toContain("moderation_status");
  });

  it("leaves a verified row alone when the content is identical", async () => {
    storedRows = [storedAs("verified")];
    const result = await upsertScholarships([LISTING]);

    expect(result.returnedToReview).toEqual([]);
    expect(Object.keys(upsertedRows[0])).not.toContain("moderation_status");
  });

  it("sends a verified row back when the deadline moves", async () => {
    storedRows = [storedAs("verified")];
    const result = await upsertScholarships([
      { ...LISTING, applicationDeadline: "2026-09-30" },
    ]);

    expect(result.returnedToReview).toEqual([FINGERPRINT]);
    expect(upsertedRows[0].moderation_status).toBe("pending");
    expect(upsertedRows[0].moderated_at).toBeNull();
    expect(String(upsertedRows[0].moderation_note)).toContain("application_deadline");
  });

  it("names every field that moved, not just the first", async () => {
    storedRows = [storedAs("verified")];
    await upsertScholarships([
      { ...LISTING, applicationDeadline: "2026-09-30", officialUrl: "https://example.org/new" },
    ]);

    const note = String(upsertedRows[0].moderation_note);
    expect(note).toContain("application_deadline");
    expect(note).toContain("official_url");
  });

  it("keeps a submitted review note alongside the reason", async () => {
    storedRows = [storedAs("verified")];
    await upsertScholarships([
      { ...LISTING, applicationDeadline: "2026-09-30", reviewNote: "Provider emailed us." },
    ]);

    const note = String(upsertedRows[0].moderation_note);
    expect(note).toContain("Returned for review");
    expect(note).toContain("Provider emailed us.");
  });

  it("does not touch a pending row — it is already in the queue", async () => {
    storedRows = [storedAs("pending")];
    const result = await upsertScholarships([{ ...LISTING, officialUrl: "https://x.example" }]);

    expect(result.returnedToReview).toEqual([]);
    expect(Object.keys(upsertedRows[0])).not.toContain("moderation_status");
  });

  it("does not resurrect a rejected row", async () => {
    storedRows = [storedAs("rejected")];
    const result = await upsertScholarships([{ ...LISTING, officialUrl: "https://x.example" }]);

    expect(result.returnedToReview).toEqual([]);
    expect(Object.keys(upsertedRows[0])).not.toContain("moderation_status");
  });
});

describe("comparisons that would otherwise produce a false change", () => {
  it("a timestamp Postgres reformats is NOT a content change", async () => {
    /*
     * THE TRAP THIS EXISTS FOR. We send `deadline_verified_at` as
     * "2026-01-15T00:00:00.000Z"; PostgREST hands it back as
     * "2026-01-15T00:00:00+00:00". Compared as text those differ, so a naive
     * diff finds a change on EVERY run and parks every verified listing in the
     * review queue permanently — a bug that looks like a policy decision and
     * would take a while to trace back to string formatting.
     */
    storedRows = [storedAs("verified", { deadline_verified_at: "2026-01-15T00:00:00+00:00" })];
    const result = await upsertScholarships([
      { ...LISTING, deadlineVerifiedAt: "2026-01-15T00:00:00.000Z" },
    ]);

    expect(
      result.returnedToReview,
      "the same instant in two formats was treated as a content change",
    ).toEqual([]);
  });

  it("a genuinely different timestamp IS a content change", async () => {
    // The control for the case above: normalising must not flatten everything.
    storedRows = [storedAs("verified", { deadline_verified_at: "2026-01-15T00:00:00+00:00" })];
    const result = await upsertScholarships([
      { ...LISTING, deadlineVerifiedAt: "2026-06-01T00:00:00.000Z" },
    ]);

    expect(result.returnedToReview).toEqual([FINGERPRINT]);
  });

  it("null and empty string are not the same value", async () => {
    // `eligibility_age: null` meaning "no age limit" and `""` meaning nothing
    // typed are different claims, and String(null) would have collapsed them.
    storedRows = [storedAs("verified", { eligibility_age: null })];
    const result = await upsertScholarships([{ ...LISTING, eligibilityAge: "" }]);

    expect(result.returnedToReview).toEqual([FINGERPRINT]);
  });

  it("a re-ingest that only bumps the freshness stamps changes nothing", async () => {
    /*
     * The nightly case, and the one that decides whether this feature is
     * usable at all: last_checked_at and updated_at are rewritten on every
     * single pass. If either counted as content, one ingest run would
     * unpublish the entire catalog.
     */
    storedRows = [
      storedAs("verified", {
        last_checked_at: "2020-01-01T00:00:00+00:00",
        updated_at: "2020-01-01T00:00:00+00:00",
      }),
    ];
    const result = await upsertScholarships([LISTING]);
    expect(result.returnedToReview).toEqual([]);
  });

  it("every content column is actually compared", async () => {
    /*
     * Walks the list rather than trusting it. For each content column, store a
     * row that differs in exactly that column and assert the listing comes
     * back for review — so a column that is listed but silently skipped by the
     * comparison fails here.
     */
    const differentValue: Record<string, unknown> = {
      provider: "Someone Else",
      program_name: "Another Programme",
      host_institution: "Another University",
      degree_levels: ["phd"],
      field_tags: ["Law"],
      funding_type: "partial",
      funding_covers: ["Travel"],
      eligibility_nationalities: ["Ghana"],
      eligibility_prior_degree: "MSc",
      eligibility_age: "Under 40",
      eligibility_other: "Something else",
      application_deadline: "2099-01-01",
      cycle_year: 2099,
      official_url: "https://example.org/different",
      source_name: "Another source",
      deadline_verified_at: "2099-01-01T00:00:00+00:00",
      deadline_note: "A different note",
    };

    for (const column of CONTENT_COLUMNS) {
      storedRows = [storedAs("verified", { [column]: differentValue[column] })];
      upsertedRows = [];
      const result = await upsertScholarships([LISTING]);
      expect(
        result.returnedToReview,
        `a change to "${column}" did NOT send the verified listing back for review`,
      ).toEqual([FINGERPRINT]);
    }
  });
});
