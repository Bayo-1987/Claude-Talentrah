/**
 * Editing a scholarship listing from /admin/scholarships (owner row, 8 Oct 2026): the pure half. buildScholarshipEdit turns a parsed edit form and the stored row into the UPDATE
 * and says whether the listing goes back to review.
 *
 *   - a PENDING listing stays pending and its reviewer note is the operator's, as typed;
 *   - a PUBLISHED listing whose content changes goes back to pending, moderated_at is cleared and the note says why and by whom (the same effect the ingest path has, but explicit);
 *   - a published listing saved with NOTHING changed stays published (no needless takedown);
 *   - identity and verification are never edited here: dedup_fingerprint, deadline_verified_at, last_checked_at and moderation_status are not in the update unless the rule above sets them;
 *   - a deadline note on a listing with no verified-deadline stamp is refused at save with approval's own message.
 */
import { describe, expect, it } from "vitest";
import { manualScholarshipSchema } from "@/lib/scholarships/schemas";
import { NOTE_NEEDS_STAMP_MESSAGE } from "@/lib/scholarships/public-deadline-note";
import { PUBLISHED_EDIT_WARNING, buildScholarshipEdit, isEditableStatus } from "@/lib/scholarships/admin-edit";

const NOW = "2026-10-08T08:00:00.000Z";
const form = (over: Record<string, unknown> = {}) =>
  manualScholarshipSchema.parse({
    provider: "QA Provider",
    programName: "QA Programme",
    hostInstitution: "Original host",
    degreeLevels: ["msc"],
    fieldTags: "Engineering",
    fundingType: "full",
    fundingCovers: "Tuition",
    eligibilityNationalities: "Nigerian",
    eligibilityPriorDegree: "",
    eligibilityAge: "",
    eligibilityOther: "Original note",
    applicationDeadline: "",
    cycleYear: "",
    officialUrl: "https://example.org/qa",
    sourceName: "Manual entry",
    deadlineNote: "",
    reviewNote: "",
    ...over,
  });
const stored = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  moderation_status: "pending" as const,
  provider: "QA Provider",
  program_name: "QA Programme",
  host_institution: "Original host",
  degree_levels: ["msc"],
  field_tags: ["Engineering"],
  funding_type: "full",
  funding_covers: ["Tuition"],
  eligibility_nationalities: ["Nigerian"],
  eligibility_prior_degree: null,
  eligibility_age: null,
  eligibility_other: "Original note",
  application_deadline: null,
  cycle_year: null,
  official_url: "https://example.org/qa",
  source_name: "Manual entry",
  deadline_verified_at: null,
  deadline_note: null,
  moderation_note: null,
  dedup_fingerprint: "fp-1",
  ...over,
});
const op = { adminId: "op-1", email: "op@talentrah.test", displayName: "Ada Operator" };

describe("which listings can be edited", () => {
  it("pending and published only", () => {
    expect(isEditableStatus("pending")).toBe(true);
    expect(isEditableStatus("verified")).toBe(true);
    expect(isEditableStatus("rejected")).toBe(false);
    expect(isEditableStatus("anything")).toBe(false);
  });
  it("the warning is the owner's wording", () => {
    expect(PUBLISHED_EDIT_WARNING).toBe("Saving will take this off the site until it's re-approved.");
  });
});

describe("buildScholarshipEdit: a pending listing", () => {
  it("changes the edited fields, stays pending, and never touches identity or verification", () => {
    const r = buildScholarshipEdit({ parsed: form({ hostInstitution: "Edited host" }), existing: stored(), operator: op, now: NOW });
    expect(r.refusal).toBeNull();
    expect(r.update.host_institution).toBe("Edited host");
    expect(r.update).not.toHaveProperty("moderation_status");
    expect(r.update).not.toHaveProperty("dedup_fingerprint");
    expect(r.update).not.toHaveProperty("deadline_verified_at");
    expect(r.update).not.toHaveProperty("last_checked_at");
    expect(r.returnedToReview).toBe(false);
    expect(r.changed).toEqual(["host_institution"]);
    expect(r.update.updated_at).toBe(NOW);
  });

  it("an empty source-name field on a row with no stored source name is not an edit", () => {
    const r = buildScholarshipEdit({ parsed: form(), existing: stored({ source_name: null }), operator: op, now: NOW });
    expect(r.changed).toEqual([]);
  });

  it("carries the operator's reviewer note when one is typed, and leaves the stored note alone when the field is empty", () => {
    expect(buildScholarshipEdit({ parsed: form({ reviewNote: "Checked the source" }), existing: stored(), operator: op, now: NOW }).update.moderation_note).toBe("Checked the source");
    expect(buildScholarshipEdit({ parsed: form(), existing: stored({ moderation_note: "Earlier note" }), operator: op, now: NOW }).update).not.toHaveProperty("moderation_note");
  });
});

describe("buildScholarshipEdit: a published listing", () => {
  const published = stored({ moderation_status: "verified" });
  it("goes back to pending when its content changes, with moderated_at cleared and the reason naming the fields and the operator", () => {
    const r = buildScholarshipEdit({ parsed: form({ hostInstitution: "Edited host", eligibilityOther: "New note" }), existing: published, operator: op, now: NOW });
    expect(r.returnedToReview).toBe(true);
    expect(r.update.moderation_status).toBe("pending");
    expect(r.update.moderated_at).toBeNull();
    expect(r.update.moderation_note).toBe("Returned for review: host_institution, eligibility_other edited by Ada Operator.");
    expect(r.changed).toEqual(["host_institution", "eligibility_other"]);
  });
  it("keeps a reviewer note the operator typed, after the reason", () => {
    const r = buildScholarshipEdit({ parsed: form({ hostInstitution: "X", reviewNote: "Checked the source" }), existing: published, operator: op, now: NOW });
    expect(r.update.moderation_note).toBe("Returned for review: host_institution edited by Ada Operator. Checked the source");
  });
  it("stays published when saved with nothing changed", () => {
    const r = buildScholarshipEdit({ parsed: form(), existing: published, operator: op, now: NOW });
    expect(r.returnedToReview).toBe(false);
    expect(r.update).not.toHaveProperty("moderation_status");
    expect(r.changed).toEqual([]);
  });
  it("names the operator by email when there is no display name", () => {
    const r = buildScholarshipEdit({ parsed: form({ hostInstitution: "X" }), existing: published, operator: { ...op, displayName: "" }, now: NOW });
    expect(r.update.moderation_note).toContain("op@talentrah.test");
  });
});

describe("buildScholarshipEdit never publishes", () => {
  it("no edit, of a pending or a published listing, changed or not, ever sets moderation_status to verified", () => {
    for (const status of ["pending", "verified"] as const) {
      for (const over of [{}, { hostInstitution: "Edited" }, { eligibilityOther: "Edited note", reviewNote: "x" }]) {
        const r = buildScholarshipEdit({ parsed: form(over), existing: stored({ moderation_status: status }), operator: op, now: NOW });
        expect(r.update.moderation_status, `${status} ${JSON.stringify(over)}`).not.toBe("verified");
      }
    }
  });
});

describe("buildScholarshipEdit: the deadline-note rule is applied at save", () => {
  it("a note on a listing with no verified-deadline date is refused with approval's message, and nothing is built", () => {
    const r = buildScholarshipEdit({ parsed: form({ deadlineNote: "Varies by partner institution" }), existing: stored(), operator: op, now: NOW });
    expect(r.refusal).toEqual({ deadlineNote: [NOTE_NEEDS_STAMP_MESSAGE] });
  });
  it("a note on a listing that HAS a verified-deadline date is allowed, and the stamp is kept", () => {
    const r = buildScholarshipEdit({ parsed: form({ deadlineNote: "Varies by partner institution" }), existing: stored({ deadline_verified_at: "2026-09-01T00:00:00.000Z" }), operator: op, now: NOW });
    expect(r.refusal).toBeNull();
    expect(r.update.deadline_note).toBe("Varies by partner institution");
    expect(r.update).not.toHaveProperty("deadline_verified_at");
  });
  it("clearing a note is always allowed", () => {
    expect(buildScholarshipEdit({ parsed: form({ deadlineNote: "" }), existing: stored({ deadline_note: "old" }), operator: op, now: NOW }).refusal).toBeNull();
  });
});
