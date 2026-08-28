import { describe, expect, it } from "vitest";
import {
  CONTENT_COLUMNS,
  NON_CONTENT_COLUMNS,
  scholarshipRow,
} from "@/lib/scholarships/ingest";
import { manualScholarshipSchema, toNormalizedScholarship } from "@/lib/scholarships/schemas";
import type { NormalizedScholarship } from "@/lib/scholarships/types";

/**
 * The classification that decides whether a published listing gets re-reviewed.
 *
 * `upsertScholarships` sends a `verified` listing back to `pending` when any
 * CONTENT column changes. A column missing from that list is invisible to the
 * check — its value can be rewritten under a verified badge and nobody is
 * told. That is a silent failure with no symptom at the call site, so it is
 * pinned here rather than left to review.
 */

const LISTING: NormalizedScholarship = {
  provider: "Test Provider",
  programName: "Test Programme",
  hostInstitution: "Test University",
  degreeLevels: ["msc"],
  fieldTags: ["Engineering"],
  fundingType: "full",
  fundingCovers: ["Tuition"],
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

describe("every column the writer writes is classified", () => {
  it("no column is missing from both lists", () => {
    const written = Object.keys(scholarshipRow(LISTING, "fingerprint", "2026-08-28T00:00:00.000Z"));
    const classified = new Set<string>([...CONTENT_COLUMNS, ...NON_CONTENT_COLUMNS]);
    const unclassified = written.filter((column) => !classified.has(column));

    expect(
      unclassified,
      `These columns are written but classified as neither content nor bookkeeping, ` +
        `so a change to them will NOT send a verified listing back for review: ` +
        `${unclassified.join(", ")}. Add each to CONTENT_COLUMNS or NON_CONTENT_COLUMNS ` +
        `in src/lib/scholarships/ingest.ts.`,
    ).toEqual([]);
  });

  it("no column is in both lists", () => {
    const both = CONTENT_COLUMNS.filter((column) =>
      (NON_CONTENT_COLUMNS as readonly string[]).includes(column),
    );
    expect(both).toEqual([]);
  });

  it("moderation_note is written when a review note is supplied, and classified", () => {
    // The one conditional key, so the test above cannot see it unless the
    // fixture supplies one. This is that fixture.
    const withNote = scholarshipRow(
      { ...LISTING, reviewNote: "Checked against the provider's page." },
      "fingerprint",
      "2026-08-28T00:00:00.000Z",
    );
    expect(Object.keys(withNote)).toContain("moderation_note");
    expect(NON_CONTENT_COLUMNS as readonly string[]).toContain("moderation_note");
  });

  it("the freshness stamps are NOT content — they change every run", () => {
    // If either were content, every listing would return to review on every
    // ingest pass, which is the most likely way to get this wrong.
    for (const column of ["last_checked_at", "updated_at"]) {
      expect(CONTENT_COLUMNS as readonly string[]).not.toContain(column);
    }
  });

  it("the fields a seeker acts on ARE content", () => {
    // Stated explicitly rather than left implicit in a long list: these are
    // the ones where a stale "verified" badge costs someone an application.
    for (const column of ["application_deadline", "funding_type", "funding_covers", "official_url"]) {
      expect(CONTENT_COLUMNS as readonly string[]).toContain(column);
    }
  });
});

describe("the manual form cannot set its own moderation status", () => {
  it("moderation_status in the payload is dropped, not honoured", () => {
    const parsed = manualScholarshipSchema.safeParse({
      provider: "Sneaky Provider",
      programName: "Sneaky Programme",
      degreeLevels: ["msc"],
      fundingType: "full",
      officialUrl: "https://example.org/x",
      // The whole point: a caller adding this to the JSON body.
      moderation_status: "verified",
      moderationStatus: "verified",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const row = scholarshipRow(
      toNormalizedScholarship(parsed.data),
      "fingerprint",
      "2026-08-28T00:00:00.000Z",
    );
    expect(Object.keys(row)).not.toContain("moderation_status");
    expect(Object.keys(row)).not.toContain("moderationStatus");
  });

  it("deadlineVerifiedAt is not something the poster can assert", () => {
    /*
     * It records that a human checked the deadline against the official URL.
     * A form submission has not done that, so the poster does not get to claim
     * it — and the schema has no field for it to arrive through.
     */
    const parsed = manualScholarshipSchema.safeParse({
      provider: "Provider Name",
      programName: "Programme Name",
      degreeLevels: ["phd"],
      fundingType: "partial",
      officialUrl: "https://example.org/y",
      deadlineVerifiedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(toNormalizedScholarship(parsed.data).deadlineVerifiedAt).toBeNull();
  });

  it("refuses a non-http official URL", () => {
    // The value is rendered as an href on a public card.
    for (const url of ["javascript:alert(1)", "data:text/html,<script>", "mailto:x@y.z"]) {
      const parsed = manualScholarshipSchema.safeParse({
        provider: "Provider Name",
        programName: "Programme Name",
        degreeLevels: ["msc"],
        fundingType: "full",
        officialUrl: url,
      });
      expect(parsed.success, `${url} was accepted as an official source URL`).toBe(false);
    }

    /*
     * The control, and it is not ceremony: the first draft of this test used a
     * one-character provider name, which the schema refuses on its own. Every
     * URL above was "rejected" and the assertion would have held just as well
     * if the URL check had not existed at all. This line is what proves the
     * payload is otherwise valid, so the scheme is doing the rejecting.
     */
    const control = manualScholarshipSchema.safeParse({
      provider: "Provider Name",
      programName: "Programme Name",
      degreeLevels: ["msc"],
      fundingType: "full",
      officialUrl: "https://example.org/ok",
    });
    expect(control.success, "the control payload is invalid for some OTHER reason").toBe(true);
  });
});
