import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedScholarship } from "@/lib/scholarships/types";

/**
 * The auto-publish rule (founder decision 2026-09-01): a NEW listing whose
 * deadline is machine-verified and still open publishes without review — and
 * ONLY that. Same mocked-writer instrument as return-to-review.test.ts, for
 * the same reason: what is under test is the decision the writer makes per
 * row, and the interesting inputs are precise combinations of stored state
 * and options.
 *
 * Every negative case here is a boundary the feature must not cross: the
 * admin form's "nothing here can publish" promise, the review queue for
 * changed content, and §6.15's rule that an unconfirmed or expiring deadline
 * gets human eyes.
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

const { upsertScholarships } = await import("@/lib/scholarships/ingest");
const { computeScholarshipFingerprint } = await import("@/lib/scholarships/dedup");

/** A machine-verified listing with a comfortably future deadline. */
const VERIFIED_LISTING: NormalizedScholarship = {
  provider: "Test Provider",
  programName: "Test Programme",
  hostInstitution: "Test University",
  degreeLevels: ["msc"],
  fieldTags: ["Engineering"],
  fundingType: "full",
  fundingCovers: ["Tuition", "Stipend"],
  eligibilityNationalities: ["Nigeria"],
  eligibilityPriorDegree: "BSc",
  eligibilityAge: null,
  eligibilityOther: null,
  applicationDeadline: "2099-06-30",
  cycleYear: 2099,
  officialUrl: "https://example.org/scholarship",
  sourceName: "Official test source",
  deadlineVerifiedAt: "2026-09-01T06:30:00.000Z",
  deadlineNote: null,
  reviewNote: null,
};

const FINGERPRINT = computeScholarshipFingerprint(
  VERIFIED_LISTING.provider,
  VERIFIED_LISTING.programName,
  VERIFIED_LISTING.cycleYear,
);

beforeEach(() => {
  storedRows = [];
  upsertedRows = [];
});

describe("auto-publish when opted in", () => {
  it("publishes a new machine-verified listing with an open deadline", async () => {
    const result = await upsertScholarships([VERIFIED_LISTING], {
      autoPublishMachineVerified: true,
    });

    expect(result.autoPublished).toEqual([FINGERPRINT]);
    expect(upsertedRows[0].moderation_status).toBe("verified");
    expect(upsertedRows[0].moderated_at).not.toBeNull();
    expect(String(upsertedRows[0].moderation_note)).toContain("Auto-published");
  });

  it("keeps the listing's own review note alongside the auto-publish note", async () => {
    await upsertScholarships([{ ...VERIFIED_LISTING, reviewNote: "Checked by hand too." }], {
      autoPublishMachineVerified: true,
    });
    const note = String(upsertedRows[0].moderation_note);
    expect(note).toContain("Auto-published");
    expect(note).toContain("Checked by hand too.");
  });
});

describe("what auto-publish must NOT do, even when opted in", () => {
  it("a listing with no verified deadline lands pending", async () => {
    const result = await upsertScholarships(
      [{ ...VERIFIED_LISTING, deadlineVerifiedAt: null }],
      { autoPublishMachineVerified: true },
    );

    expect(result.autoPublished).toEqual([]);
    expect(Object.keys(upsertedRows[0])).not.toContain("moderation_status");
  });

  it("a variable-by-design listing (note, no date) lands pending", async () => {
    const result = await upsertScholarships(
      [
        {
          ...VERIFIED_LISTING,
          applicationDeadline: null,
          deadlineNote: "Varies by partner institution.",
        },
      ],
      { autoPublishMachineVerified: true },
    );

    expect(result.autoPublished).toEqual([]);
    expect(Object.keys(upsertedRows[0])).not.toContain("moderation_status");
  });

  it("a deadline already passed lands pending — the expiry sweep is not a publisher's excuse", async () => {
    const result = await upsertScholarships(
      [{ ...VERIFIED_LISTING, applicationDeadline: "2020-01-01", cycleYear: 2020 }],
      { autoPublishMachineVerified: true },
    );

    expect(result.autoPublished).toEqual([]);
    expect(Object.keys(upsertedRows[0])).not.toContain("moderation_status");
  });

  it("a deadline expiring TODAY lands pending, not published", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = await upsertScholarships(
      [{ ...VERIFIED_LISTING, applicationDeadline: today }],
      { autoPublishMachineVerified: true },
    );

    expect(result.autoPublished).toEqual([]);
    expect(Object.keys(upsertedRows[0])).not.toContain("moderation_status");
  });

  it("an EXISTING verified row whose content changed still goes back to review", async () => {
    /*
     * The composition that matters most: auto-publish is for first sight
     * only. A deadline that MOVED on a published listing is a change nobody
     * has reviewed, and it must go to a human even on a run that could
     * publish new rows.
     */
    storedRows = [
      {
        dedup_fingerprint: FINGERPRINT,
        moderation_status: "verified",
        provider: VERIFIED_LISTING.provider,
        program_name: VERIFIED_LISTING.programName,
        host_institution: VERIFIED_LISTING.hostInstitution,
        degree_levels: VERIFIED_LISTING.degreeLevels,
        field_tags: VERIFIED_LISTING.fieldTags,
        funding_type: VERIFIED_LISTING.fundingType,
        funding_covers: VERIFIED_LISTING.fundingCovers,
        eligibility_nationalities: VERIFIED_LISTING.eligibilityNationalities,
        eligibility_prior_degree: VERIFIED_LISTING.eligibilityPriorDegree,
        eligibility_age: VERIFIED_LISTING.eligibilityAge,
        eligibility_other: VERIFIED_LISTING.eligibilityOther,
        application_deadline: "2099-05-31",
        cycle_year: VERIFIED_LISTING.cycleYear,
        official_url: VERIFIED_LISTING.officialUrl,
        source_name: VERIFIED_LISTING.sourceName,
        deadline_verified_at: VERIFIED_LISTING.deadlineVerifiedAt,
        deadline_note: VERIFIED_LISTING.deadlineNote,
      },
    ];

    const result = await upsertScholarships([VERIFIED_LISTING], {
      autoPublishMachineVerified: true,
    });

    expect(result.autoPublished).toEqual([]);
    expect(result.returnedToReview).toEqual([FINGERPRINT]);
    expect(upsertedRows[0].moderation_status).toBe("pending");
  });
});

describe("without the opt-in nothing changed", () => {
  it("the same machine-verified listing lands pending by default", async () => {
    /*
     * The admin posting form and the manual API route call the writer with no
     * options. If this fails, the admin page's "Nothing on this page can
     * publish a listing" copy has silently become false.
     */
    const result = await upsertScholarships([VERIFIED_LISTING]);

    expect(result.autoPublished).toEqual([]);
    expect(Object.keys(upsertedRows[0])).not.toContain("moderation_status");
  });
});
